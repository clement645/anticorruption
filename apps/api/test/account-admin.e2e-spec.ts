import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { enrollTotp, freshTotpCode, issueStepUpToken } from './helpers/step-up';

interface LoginBody {
  accessToken?: string;
  mfaRequired?: boolean;
  mfaToken?: string;
  passwordChangeRequired?: boolean;
  changeToken?: string;
}

function refreshCookie(res: request.Response): string {
  const cookies = (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
  const found = cookies.find((c) => c.startsWith('bpfmps_refresh_token='));
  if (!found) throw new Error('no refresh cookie');
  return found.split(';')[0];
}

/**
 * Admin account operations: listing MFA and forced-change status, one-time
 * password resets that force a change at next sign-in, admin MFA reset, and
 * session revocation on suspension. Every admin action needs step-up and is
 * refused against the administrator's own account.
 */
describe('Account administration (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const password = 'E2ETestPassword123!';
  const adminEmail = 'e2e-acct-admin@test.bpfmps.local';
  const targetEmail = 'e2e-acct-target@test.bpfmps.local';
  const limitedEmail = 'e2e-acct-limited@test.bpfmps.local';
  const roleName = '[E2E] Account Admin';
  const limitedRoleName = '[E2E] Account Limited';

  let adminUserId: string;
  let targetUserId: string;
  let limitedUserId: string;
  let adminToken: string;
  let adminStepUp: string;
  let adminSecret: string;
  let limitedToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    prisma = app.get(PrismaService);

    // Start from a clean slate: a previous interrupted run can leave a user without its role.
    const staleIds = (
      await prisma.user.findMany({
        where: { email: { in: [adminEmail, targetEmail, limitedEmail] } },
        select: { id: true },
      })
    ).map((u) => u.id);
    if (staleIds.length > 0) {
      await prisma.session.deleteMany({ where: { userId: { in: staleIds } } });
      await prisma.mfaMethod.deleteMany({ where: { userId: { in: staleIds } } });
      await prisma.userRole.deleteMany({ where: { userId: { in: staleIds } } });
      await prisma.securityEvent.deleteMany({ where: { userId: { in: staleIds } } });
      await prisma.user.deleteMany({ where: { id: { in: staleIds } } });
    }

    const hash = await argon2.hash(password, { type: argon2.argon2id });
    const grant = async (name: string, keys: [string, string][]) => {
      const role = await prisma.role.upsert({ where: { name }, create: { name }, update: {} });
      for (const [resource, action] of keys) {
        const permission = await prisma.permission.upsert({
          where: { resource_action: { resource, action } },
          create: { resource, action, description: `${resource}:${action}` },
          update: {},
        });
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
          create: { roleId: role.id, permissionId: permission.id },
          update: {},
        });
      }
      return role.id;
    };
    const adminRoleId = await grant(roleName, [
      ['users', 'read'],
      ['users', 'update'],
      ['users', 'reset_password'],
      ['users', 'reset_mfa'],
    ]);
    const limitedRoleId = await grant(limitedRoleName, [['users', 'update']]);

    const upsertUser = async (email: string, lastName: string, roleId?: string) =>
      (
        await prisma.user.upsert({
          where: { email },
          create: {
            email,
            firstName: '[E2E]',
            lastName,
            passwordHash: hash,
            status: 'ACTIVE',
            ...(roleId ? { roles: { create: { roleId } } } : {}),
          },
          update: {
            passwordHash: hash,
            status: 'ACTIVE',
            mustChangePassword: false,
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        })
      ).id;

    adminUserId = await upsertUser(adminEmail, 'AcctAdmin', adminRoleId);
    targetUserId = await upsertUser(targetEmail, 'AcctTarget');
    limitedUserId = await upsertUser(limitedEmail, 'AcctLimited', limitedRoleId);
    for (const id of [adminUserId, targetUserId, limitedUserId]) {
      await prisma.mfaMethod.deleteMany({ where: { userId: id } });
      await prisma.session.deleteMany({ where: { userId: id } });
    }

    adminToken = ((await login(adminEmail)).accessToken) as string;
    adminSecret = await enrollTotp(app.getHttpServer(), adminToken);
    adminStepUp = await issueStepUpToken(app.getHttpServer(), adminToken, adminSecret);
    limitedToken = ((await login(limitedEmail)).accessToken) as string;
  });

  afterAll(async () => {
    const userIds = [adminUserId, targetUserId, limitedUserId];
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.digitalIdentity.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.mfaMethod.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    for (const name of [roleName, limitedRoleName]) {
      const role = await prisma.role.findUnique({ where: { name } });
      if (role) {
        await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
        await prisma.role.delete({ where: { id: role.id } });
      }
    }
    await app.close();
  });

  async function login(email: string, pw = password) {
    return (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: pw })
        .expect(200)
    ).body as LoginBody;
  }

  it('lists MFA and forced-change status for every user', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/users?take=100')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const row = (list.body as { items: Array<Record<string, unknown>> }).items.find(
      (u) => u.id === targetUserId,
    );
    expect(row).toBeDefined();
    expect(row).toMatchObject({ mfaEnabled: false, mustChangePassword: false });
  });

  it('a one-time password reset forces a change, then the new password works', async () => {
    const reset = await request(app.getHttpServer())
      .post(`/api/v1/users/${targetUserId}/password/reset`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Step-Up-Token', adminStepUp)
      .expect(200);
    const temporaryPassword = (reset.body as { temporaryPassword: string }).temporaryPassword;
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(12);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password })
      .expect(401);

    const forced = await login(targetEmail, temporaryPassword);
    expect(forced.passwordChangeRequired).toBe(true);
    expect(forced.accessToken).toBeUndefined();

    const newPassword = 'BrandNewPassphrase9!';
    await request(app.getHttpServer())
      .post('/api/v1/auth/password/change')
      .send({ changeToken: forced.changeToken, newPassword })
      .expect(204);

    expect((await login(targetEmail, newPassword)).accessToken).toBeTruthy();
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password: temporaryPassword })
      .expect(401);
  });

  it('refuses an administrator resetting their own password', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/users/${adminUserId}/password/reset`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Step-Up-Token', adminStepUp)
      .expect(403);
  });

  it('needs the reset permission, not just users:update', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/users/${targetUserId}/password/reset`)
      .set('Authorization', `Bearer ${limitedToken}`)
      .set('X-Step-Up-Token', adminStepUp)
      .expect(403);
  });

  it('an MFA reset removes the authenticator so sign-in no longer asks for a code', async () => {
    const targetToken = ((await login(targetEmail, 'BrandNewPassphrase9!')).accessToken) as string;
    const secret = await enrollTotp(app.getHttpServer(), targetToken);
    expect((await login(targetEmail, 'BrandNewPassphrase9!')).mfaRequired).toBe(true);

    await request(app.getHttpServer())
      .post(`/api/v1/users/${targetUserId}/mfa/reset`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Step-Up-Token', adminStepUp)
      .expect(204);

    const after = await login(targetEmail, 'BrandNewPassphrase9!');
    expect(after.mfaRequired).toBeFalsy();
    expect(after.accessToken).toBeTruthy();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(await freshTotpCode(secret)).toMatch(/^\d{6}$/);
  });

  it('suspending an account revokes its live refresh sessions', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: targetEmail, password: 'BrandNewPassphrase9!' })
      .expect(200);
    const cookie = refreshCookie(res);

    await request(app.getHttpServer())
      .patch(`/api/v1/users/${targetUserId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('X-Step-Up-Token', adminStepUp)
      .send({ status: 'SUSPENDED' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(401);
  });
});
