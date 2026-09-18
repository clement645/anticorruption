import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

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
  const password = 'E2ETestPassword123!';

  let readerUserId: string;
  let noPermsUserId: string;

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
  });

  afterAll(async () => {
    await prisma.session.deleteMany({
      where: { userId: { in: [readerUserId, noPermsUserId] } },
    });
    await prisma.userRole.deleteMany({
      where: { userId: { in: [readerUserId, noPermsUserId] } },
    });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: [readerUserId, noPermsUserId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [readerUserId, noPermsUserId] } },
    });
    await prisma.rolePermission.deleteMany({
      where: { role: { name: '[E2E] Users Reader' } },
    });
    await prisma.role.deleteMany({ where: { name: '[E2E] Users Reader' } });
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
});
