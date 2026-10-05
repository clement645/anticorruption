import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import type { EnvConfig } from '../src/config/env.validation';
import {
  enrollTotp,
  issueStepUpToken,
  freshTotpCode,
} from './helpers/step-up';

interface LoginResponseBody {
  accessToken?: string;
  mfaRequired?: boolean;
  mfaToken?: string;
}
interface StepUpResponseBody {
  stepUpToken: string;
  expiresIn: number;
}
interface ErrorResponseBody {
  message: string | string[];
}

/**
 * Step-up MFA (post-launch, item 5): a fresh MFA challenge required on top
 * of an already-valid access token before performing a handful of
 * genuinely high-stakes actions. Exercised here against
 * `PATCH /users/:id` (@RequireStepUp(), alongside `users:update`) since it
 * needs far lighter fixtures than the other protected route
 * (`payment-requests/:id/execute`, covered as part of the normal payment
 * flow in contracts.e2e-spec.ts). Covers: no header, wrong code, MFA not
 * enabled, a step-up token belonging to a DIFFERENT user, an expired
 * token, and the valid end-to-end flow.
 */
describe('Step-up MFA (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'SomeTestPassword123!';
  const adminAEmail = 'e2e-stepup-admin-a@test.bpfmps.local';
  const adminBEmail = 'e2e-stepup-admin-b@test.bpfmps.local';
  const noMfaEmail = 'e2e-stepup-nomfa@test.bpfmps.local';
  const targetEmail = 'e2e-stepup-target@test.bpfmps.local';

  let adminAUserId: string;
  let adminBUserId: string;
  let noMfaUserId: string;
  let targetUserId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const role = await prisma.role.upsert({
      where: { name: '[E2E] Step-Up Users Admin' },
      create: { name: '[E2E] Step-Up Users Admin' },
      update: {},
    });
    const permission = await prisma.permission.upsert({
      where: { resource_action: { resource: 'users', action: 'update' } },
      create: { resource: 'users', action: 'update', description: 'update' },
      update: {},
    });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: role.id, permissionId: permission.id },
      },
      create: { roleId: role.id, permissionId: permission.id },
      update: {},
    });

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    async function upsertUser(
      email: string,
      lastName: string,
      roleId?: string,
    ) {
      const user = await prisma.user.upsert({
        where: { email },
        create: {
          email,
          firstName: '[E2E]',
          lastName,
          passwordHash,
          status: 'ACTIVE',
          ...(roleId ? { roles: { create: { roleId } } } : {}),
        },
        update: {
          passwordHash,
          status: 'ACTIVE',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      return user.id;
    }

    adminAUserId = await upsertUser(adminAEmail, 'StepUpAdminA', role.id);
    adminBUserId = await upsertUser(adminBEmail, 'StepUpAdminB', role.id);
    noMfaUserId = await upsertUser(noMfaEmail, 'StepUpNoMfa', role.id);
    targetUserId = await upsertUser(targetEmail, 'StepUpTarget');
  });

  afterAll(async () => {
    const userIds = [adminAUserId, adminBUserId, noMfaUserId, targetUserId];
    await prisma.mfaMethod.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.role.deleteMany({
      where: { name: '[E2E] Step-Up Users Admin' },
    });
    await app.close();
  });

  // Once a user has TOTP enrolled, plain email/password login no longer
  // returns an accessToken directly — it returns { mfaRequired, mfaToken }
  // and a second call to /auth/mfa/verify is required, same as any other
  // MFA-enrolled account since Phase 2. totpSecrets tracks which of this
  // spec's fixture users have been enrolled so login() can complete that
  // second step transparently.
  const totpSecrets = new Map<string, string>();
  // Gap-audit fix: MfaService now rejects a replayed TOTP code within its
  // own 30s step. A test that both re-logs-in (mfa/verify, one fresh code)
  // AND issues a step-up token (a second fresh code) back to back can need
  // to wait out a whole extra TOTP window. An access token (15min TTL)
  // comfortably outlives this file's run, so it's cached per email and
  // reused — login() only ever pays the mfa/verify fresh-code cost once
  // per user, never on every call, leaving each test's own explicit
  // step-up issuance as the one fresh-code need that's actually under
  // test.
  const cachedTokens = new Map<string, string>();

  async function login(email: string): Promise<string> {
    const cached = cachedTokens.get(email);
    if (cached) {
      return cached;
    }

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const body = res.body as LoginResponseBody;
    if (!body.mfaRequired) {
      const token = body.accessToken as string;
      cachedTokens.set(email, token);
      return token;
    }

    const secret = totpSecrets.get(email);
    if (!secret) {
      throw new Error(`MFA required for ${email} but no TOTP secret cached`);
    }
    const verify = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: body.mfaToken, code: await freshTotpCode(secret) })
      .expect(200);
    const token = (verify.body as LoginResponseBody).accessToken as string;
    cachedTokens.set(email, token);
    return token;
  }

  it('rejects a step-up-protected update with no X-Step-Up-Token header at all', async () => {
    const token = await login(adminAEmail);

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/users/${targetUserId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'ACTIVE' })
      .expect(403);

    expect((res.body as ErrorResponseBody).message).toMatch(/step-up/i);
  });

  it('rejects issuing a step-up token for an account without MFA enabled', async () => {
    const token = await login(noMfaEmail);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000000' })
      .expect(403);

    expect((res.body as ErrorResponseBody).message).toMatch(
      /MFA must be enabled/i,
    );
  });

  it('rejects issuing a step-up token given a wrong TOTP code', async () => {
    const token = await login(adminAEmail);
    totpSecrets.set(adminAEmail, await enrollTotp(app.getHttpServer(), token));

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000000' })
      .expect(403);

    expect((res.body as ErrorResponseBody).message).toMatch(
      /Invalid MFA code/i,
    );
  });

  it('issues a step-up token given a fresh valid TOTP code, and it authorizes the update', async () => {
    // adminA already has MFA enrolled, from the previous test — login()
    // transparently completes the mfa/verify step using the cached secret.
    const token = await login(adminAEmail);
    const secret = totpSecrets.get(adminAEmail) as string;

    const stepUp = await request(app.getHttpServer())
      .post('/api/v1/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: await freshTotpCode(secret) })
      .expect(200);
    const body = stepUp.body as StepUpResponseBody;
    expect(body.stepUpToken).toBeTruthy();
    expect(body.expiresIn).toBeGreaterThan(0);

    const update = await request(app.getHttpServer())
      .patch(`/api/v1/users/${targetUserId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', body.stepUpToken)
      .send({ status: 'ACTIVE' })
      .expect(200);
    expect((update.body as { status: string }).status).toEqual('ACTIVE');
  });

  it('rejects a step-up token belonging to a DIFFERENT user, even with valid permissions', async () => {
    const tokenA = await login(adminAEmail);
    const tokenB = await login(adminBEmail);
    const secretB = await enrollTotp(app.getHttpServer(), tokenB);
    totpSecrets.set(adminBEmail, secretB);
    const stepUpTokenB = await issueStepUpToken(
      app.getHttpServer(),
      tokenB,
      secretB,
    );

    // adminA presents adminB's genuinely valid step-up token — must be
    // rejected, since StepUpGuard checks the token's `sub` against the
    // AUTHENTICATED caller, not just "is this token valid for someone".
    const res = await request(app.getHttpServer())
      .patch(`/api/v1/users/${targetUserId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('X-Step-Up-Token', stepUpTokenB)
      .send({ status: 'SUSPENDED' })
      .expect(403);

    expect((res.body as ErrorResponseBody).message).toMatch(/step-up/i);
  });

  it('rejects an expired step-up token', async () => {
    const token = await login(adminAEmail);
    const jwt = app.get(JwtService);
    const config = app.get<ConfigService<EnvConfig, true>>(ConfigService);
    const expiredToken = jwt.sign(
      { sub: adminAUserId, purpose: 'step_up' },
      {
        secret: config.get('STEP_UP_TOKEN_SECRET', { infer: true }),
        expiresIn: '-10s',
      },
    );

    const res = await request(app.getHttpServer())
      .patch(`/api/v1/users/${targetUserId}`)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Step-Up-Token', expiredToken)
      .send({ status: 'ACTIVE' })
      .expect(403);

    expect((res.body as ErrorResponseBody).message).toMatch(/step-up/i);
  });

  // Gap-audit regression: MfaService.verifyCode() must reject a TOTP code
  // whose 30s step was already consumed for this user, even though the code
  // is still cryptographically valid for that window. Submitting the SAME
  // code twice within one step is the exact replay this guards against.
  it('rejects replaying the same TOTP code within its own 30-second step', async () => {
    const token = await login(adminAEmail);
    const secret = totpSecrets.get(adminAEmail) as string;
    const code = await freshTotpCode(secret);

    await request(app.getHttpServer())
      .post('/api/v1/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ code })
      .expect(200);

    const replay = await request(app.getHttpServer())
      .post('/api/v1/auth/step-up')
      .set('Authorization', `Bearer ${token}`)
      .send({ code })
      .expect(403);
    expect((replay.body as ErrorResponseBody).message).toMatch(
      /Invalid MFA code/i,
    );
  });
});
