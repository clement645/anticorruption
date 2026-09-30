import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { enrollTotp, issueStepUpToken } from './helpers/step-up';

interface LoginResponseBody {
  accessToken: string;
  expiresIn: number;
}

interface MeResponseBody {
  sub: string;
  email: string;
  permissions: string[];
}

interface ErrorResponseBody {
  message: string;
}

function extractRefreshCookie(response: request.Response): string {
  const setCookie = response.headers['set-cookie'] as unknown as
    string[] | undefined;
  const cookie = setCookie?.find((c) => c.startsWith('bpfmps_refresh_token='));
  if (!cookie) {
    throw new Error('Expected a bpfmps_refresh_token cookie in the response');
  }
  return cookie.split(';')[0];
}

/**
 * Exercises the real Phase 2 IAM stack end-to-end against the local
 * PostgreSQL instance: login, RBAC enforcement, refresh-token rotation and
 * reuse detection, and account lockout. Test fixtures are created and torn
 * down per-suite so this never touches the demo seed data.
 */
describe('IAM (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const testEmailReader = 'e2e-reader@test.bpfmps.local';
  const testEmailNoPerms = 'e2e-noperms@test.bpfmps.local';
  const testEmailAdmin = 'e2e-admin@test.bpfmps.local';
  // Dedicated no-permissions account for the admin-endpoint 403 checks below —
  // testEmailNoPerms gets deliberately locked out by the lockout test earlier
  // in this file, so reusing it here would make those later logins fail with
  // 403 (locked) rather than the 403 (forbidden) the test is actually checking.
  const testEmailNoPermsAdmin = 'e2e-noperms-admin@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let readerUserId: string;
  let noPermsUserId: string;
  let noPermsAdminUserId: string;
  let adminUserId: string;
  let targetRoleAId: string;
  let targetRoleBId: string;
  const createdUserIds: string[] = [];

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
      where: { name: '[E2E] Users Reader' },
      create: { name: '[E2E] Users Reader' },
      update: {},
    });
    const permission = await prisma.permission.upsert({
      where: { resource_action: { resource: 'users', action: 'read' } },
      create: {
        resource: 'users',
        action: 'read',
        description: 'View user accounts',
      },
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

    const reader = await prisma.user.upsert({
      where: { email: testEmailReader },
      create: {
        email: testEmailReader,
        firstName: '[E2E]',
        lastName: 'Reader',
        passwordHash,
        status: 'ACTIVE',
        roles: { create: { roleId: role.id } },
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    readerUserId = reader.id;

    const noPerms = await prisma.user.upsert({
      where: { email: testEmailNoPerms },
      create: {
        email: testEmailNoPerms,
        firstName: '[E2E]',
        lastName: 'NoPerms',
        passwordHash,
        status: 'ACTIVE',
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    noPermsUserId = noPerms.id;

    const noPermsAdmin = await prisma.user.upsert({
      where: { email: testEmailNoPermsAdmin },
      create: {
        email: testEmailNoPermsAdmin,
        firstName: '[E2E]',
        lastName: 'NoPermsAdmin',
        passwordHash,
        status: 'ACTIVE',
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    noPermsAdminUserId = noPermsAdmin.id;

    const adminRole = await prisma.role.upsert({
      where: { name: '[E2E] Users Admin' },
      create: { name: '[E2E] Users Admin' },
      update: {},
    });
    for (const action of ['read', 'create', 'update']) {
      const perm = await prisma.permission.upsert({
        where: { resource_action: { resource: 'users', action } },
        create: { resource: 'users', action, description: action },
        update: {},
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id },
        },
        create: { roleId: adminRole.id, permissionId: perm.id },
        update: {},
      });
    }

    const admin = await prisma.user.upsert({
      where: { email: testEmailAdmin },
      create: {
        email: testEmailAdmin,
        firstName: '[E2E]',
        lastName: 'Admin',
        passwordHash,
        status: 'ACTIVE',
        roles: { create: { roleId: adminRole.id } },
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    adminUserId = admin.id;

    const targetRoleA = await prisma.role.upsert({
      where: { name: '[E2E] Target Role A' },
      create: { name: '[E2E] Target Role A' },
      update: {},
    });
    targetRoleAId = targetRoleA.id;
    const targetRoleB = await prisma.role.upsert({
      where: { name: '[E2E] Target Role B' },
      create: { name: '[E2E] Target Role B' },
      update: {},
    });
    targetRoleBId = targetRoleB.id;
  });

  afterAll(async () => {
    const allUserIds = [
      readerUserId,
      noPermsUserId,
      noPermsAdminUserId,
      adminUserId,
      ...createdUserIds,
    ].filter((id): id is string => Boolean(id));
    await prisma.session.deleteMany({
      where: { userId: { in: allUserIds } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: allUserIds } },
    });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: allUserIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: allUserIds } },
    });
    await prisma.rolePermission.deleteMany({
      where: {
        role: {
          name: {
            in: [
              '[E2E] Users Reader',
              '[E2E] Users Admin',
              '[E2E] Target Role A',
              '[E2E] Target Role B',
            ],
          },
        },
      },
    });
    await prisma.role.deleteMany({
      where: {
        name: {
          in: [
            '[E2E] Users Reader',
            '[E2E] Users Admin',
            '[E2E] Target Role A',
            '[E2E] Target Role B',
          ],
        },
      },
    });
    await app.close();
  });

  it('rejects requests with no access token', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
  });

  it('rejects login with an unknown email', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.bpfmps.local', password })
      .expect(401);
  });

  it('rejects login with a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmailReader, password: 'wrong-password' })
      .expect(401);
  });

  it('logs in and returns a JWT carrying the correct permissions', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmailReader, password })
      .expect(200);

    const loginBody = response.body as LoginResponseBody;
    expect(loginBody.accessToken).toEqual(expect.any(String));

    const me = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${loginBody.accessToken}`)
      .expect(200);

    expect((me.body as MeResponseBody).permissions).toContain('users:read');
  });

  it('enforces RBAC: a user without users:read cannot list users', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmailNoPerms, password })
      .expect(200);
    const loginBody = login.body as LoginResponseBody;

    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${loginBody.accessToken}`)
      .expect(403);
  });

  it('allows a user with users:read to list users', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmailReader, password })
      .expect(200);
    const loginBody = login.body as LoginResponseBody;

    await request(app.getHttpServer())
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${loginBody.accessToken}`)
      .expect(200);
  });

  it('rotates the refresh token and detects reuse of a rotated-out token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmailReader, password })
      .expect(200);

    const originalCookie = extractRefreshCookie(login);

    const firstRefresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(200);

    const rotatedCookie = extractRefreshCookie(firstRefresh);
    expect(rotatedCookie).not.toEqual(originalCookie);

    // Replaying the pre-rotation cookie must now be rejected...
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', originalCookie)
      .expect(401);

    // ...and, as a precaution, the whole chain (including the token that
    // replaced it) is revoked too.
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotatedCookie)
      .expect(401);
  });

  it('locks the account out after repeated failed logins', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testEmailNoPerms, password: 'wrong-password' });
    }

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: testEmailNoPerms, password })
      .expect(403);

    expect((response.body as ErrorResponseBody).message).toMatch(/locked/i);
  });

  describe('admin user management (users:create / users:update)', () => {
    // PATCH /users/:id is @RequireStepUp() (post-launch) — loginAsAdmin()
    // enrolls TOTP once (cached in adminTotpSecret) and hands back a fresh
    // step-up token on every call, since a step-up token issued against an
    // earlier access token would still verify (it's keyed on user id, not
    // token identity) but a new one costs nothing to generate here.
    let adminTotpSecret: string | undefined;
    async function loginAsAdmin(): Promise<{
      token: string;
      stepUpToken: string;
    }> {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testEmailAdmin, password })
        .expect(200);
      const body = login.body as {
        accessToken?: string;
        mfaRequired?: boolean;
        mfaToken?: string;
      };

      let token: string;
      if (body.mfaRequired) {
        // Once enrolled below, every SUBSEQUENT plain login for this admin
        // requires the second MFA-verify step, same as any other
        // MFA-enrolled account since Phase 2.
        const verify = await request(app.getHttpServer())
          .post('/api/v1/auth/mfa/verify')
          .send({
            mfaToken: body.mfaToken,
            code: authenticator.generate(adminTotpSecret as string),
          })
          .expect(200);
        token = (verify.body as LoginResponseBody).accessToken;
      } else {
        token = body.accessToken as string;
      }

      if (!adminTotpSecret) {
        adminTotpSecret = await enrollTotp(app.getHttpServer(), token);
      }
      const stepUpToken = await issueStepUpToken(
        app.getHttpServer(),
        token,
        adminTotpSecret,
      );
      return { token, stepUpToken };
    }

    it('rejects user creation from an actor without users:create', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testEmailNoPermsAdmin, password })
        .expect(200);
      const token = (login.body as LoginResponseBody).accessToken;

      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'e2e-blocked@test.bpfmps.local',
          firstName: 'Blocked',
          lastName: 'User',
          temporaryPassword: 'SomeTempPassword123!',
          roleIds: [targetRoleAId],
        })
        .expect(403);
    });

    it('allows an admin to create a user with an assigned role', async () => {
      const { token } = await loginAsAdmin();

      const response = await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'e2e-created@test.bpfmps.local',
          firstName: 'Created',
          lastName: 'User',
          temporaryPassword: 'SomeTempPassword123!',
          roleIds: [targetRoleAId],
        })
        .expect(201);

      const created = response.body as { id: string; email: string };
      expect(created.email).toEqual('e2e-created@test.bpfmps.local');
      createdUserIds.push(created.id);

      const list = await request(app.getHttpServer())
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const listBody = list.body as {
        items: Array<{ id: string; roles: Array<{ id: string }> }>;
      };
      const found = listBody.items.find((u) => u.id === created.id);
      expect(found?.roles.map((r) => r.id)).toEqual([targetRoleAId]);
    });

    it('rejects a duplicate email with 409', async () => {
      const { token } = await loginAsAdmin();

      await request(app.getHttpServer())
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${token}`)
        .send({
          email: 'e2e-created@test.bpfmps.local',
          firstName: 'Dupe',
          lastName: 'User',
          temporaryPassword: 'SomeTempPassword123!',
          roleIds: [targetRoleAId],
        })
        .expect(409);
    });

    it('rejects update from an actor without users:update', async () => {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: testEmailNoPermsAdmin, password })
        .expect(200);
      const token = (login.body as LoginResponseBody).accessToken;

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${readerUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'SUSPENDED' })
        .expect(403);
    });

    it("allows an admin to replace a user's roles entirely", async () => {
      const { token, stepUpToken } = await loginAsAdmin();
      const targetId = createdUserIds[0];

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Step-Up-Token', stepUpToken)
        .send({ roleIds: [targetRoleBId] })
        .expect(200);

      const updated = response.body as { roles: Array<{ id: string }> };
      expect(updated.roles.map((r) => r.id)).toEqual([targetRoleBId]);
    });

    it('allows an admin to suspend another user', async () => {
      const { token, stepUpToken } = await loginAsAdmin();
      const targetId = createdUserIds[0];

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Step-Up-Token', stepUpToken)
        .send({ status: 'SUSPENDED' })
        .expect(200);

      expect((response.body as { status: string }).status).toEqual('SUSPENDED');
    });

    it('rejects an update with a missing/invalid step-up token, even with users:update', async () => {
      const { token } = await loginAsAdmin();
      const targetId = createdUserIds[0];

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${targetId}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'ACTIVE' })
        .expect(403);
    });

    it('blocks an admin from changing their own account status', async () => {
      const { token, stepUpToken } = await loginAsAdmin();

      await request(app.getHttpServer())
        .patch(`/api/v1/users/${adminUserId}`)
        .set('Authorization', `Bearer ${token}`)
        .set('X-Step-Up-Token', stepUpToken)
        .send({ status: 'SUSPENDED' })
        .expect(403);
    });

    it('returns 404 when updating a non-existent user', async () => {
      const { token, stepUpToken } = await loginAsAdmin();

      await request(app.getHttpServer())
        .patch('/api/v1/users/00000000-0000-4000-8000-000000000000')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Step-Up-Token', stepUpToken)
        .send({ status: 'SUSPENDED' })
        .expect(404);
    });
  });
});
