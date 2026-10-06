import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { freshTotpCode } from './helpers/step-up';

interface LoginResponseBody {
  accessToken?: string;
  mfaRequired?: boolean;
  mfaToken?: string;
}

/**
 * Authenticator enrollment from the Security Center: status, setup, enable,
 * and the guard that stops setup from silently switching an active
 * authenticator off.
 */
describe('Authenticator MFA enrollment (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const email = 'e2e-mfa-enroll@test.bpfmps.local';
  const password = 'E2ETestPassword123!';
  let userId: string;
  let enrolledSecret = '';

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

    const user = await prisma.user.upsert({
      where: { email },
      create: {
        email,
        firstName: '[E2E]',
        lastName: 'MfaEnroll',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        status: 'ACTIVE',
      },
      update: {
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    userId = user.id;
    await prisma.mfaMethod.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.securityEvent.deleteMany({ where: { userId } });
    await prisma.mfaMethod.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await app.close();
  });

  async function login(): Promise<LoginResponseBody> {
    return (
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200)
    ).body as LoginResponseBody;
  }

  it('reports MFA disabled before enrollment, and login does not require a second factor', async () => {
    const body = await login();
    expect(body.mfaRequired).toBeFalsy();
    const status = await request(app.getHttpServer())
      .get('/api/v1/users/me/security')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect(status.body).toEqual({ mfaEnabled: false });
  });

  it('enrolls an authenticator, shows backup codes once, and then requires MFA at login', async () => {
    const token = (await login()).accessToken as string;

    const setup = await request(app.getHttpServer())
      .post('/api/v1/users/me/mfa/totp/setup')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const { secret, otpauthUrl } = setup.body as { secret: string; otpauthUrl: string };
    expect(otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    enrolledSecret = secret;

    const enable = await request(app.getHttpServer())
      .post('/api/v1/users/me/mfa/totp/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: await freshTotpCode(secret) })
      .expect(201);
    expect((enable.body as { backupCodes: string[] }).backupCodes).toHaveLength(10);

    const status = await request(app.getHttpServer())
      .get('/api/v1/users/me/security')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body).toEqual({ mfaEnabled: true });

    expect((await login()).mfaRequired).toBe(true);
  });

  it('refuses to re-run setup on an enabled account, so MFA cannot be switched off without a code', async () => {
    const challenge = await login();
    expect(challenge.mfaRequired).toBe(true);
    const verify = await request(app.getHttpServer())
      .post('/api/v1/auth/mfa/verify')
      .send({ mfaToken: challenge.mfaToken, code: await freshTotpCode(enrolledSecret) })
      .expect(200);
    const token = (verify.body as LoginResponseBody).accessToken as string;

    // A stolen access token alone must not be enough to disable the second factor.
    await request(app.getHttpServer())
      .post('/api/v1/users/me/mfa/totp/setup')
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    const stillEnabled = await prisma.mfaMethod.findUniqueOrThrow({
      where: { userId_type: { userId, type: 'TOTP' } },
    });
    expect(stillEnabled.enabled).toBe(true);
  });
});
