import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateEd25519KeyPair } from '@bpfmps/crypto';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { signRequest } from './helpers/signing';
import { enrollTotp, issueStepUpToken } from './helpers/step-up';

const THRESHOLD = 1000;

interface LoginResponseBody {
  accessToken: string;
}
interface IdBody {
  id: string;
}
interface ErrorResponseBody {
  message: string | string[];
}

/**
 * ABAC high-value approval rule, end to end. The threshold is a deployment
 * setting, so it is supplied through the environment for this spec only and
 * restored afterwards. Above the threshold an approval needs a fresh step-up
 * token; at or below it, nothing changes.
 */
describe('ABAC high-value approval (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const previousThreshold = process.env.HIGH_VALUE_APPROVAL_THRESHOLD;

  const password = 'E2ETestPassword123!';
  const creatorEmail = 'e2e-policy-creator@test.bpfmps.local';
  const approverEmail = 'e2e-policy-approver@test.bpfmps.local';
  const roleName = '[E2E] Policy Budget Officer';

  let creatorUserId: string;
  let approverUserId: string;
  let creatorToken: string;
  let approverToken: string;
  let approverSecret: string;
  let approverKeyPem: string;
  let stepUpToken: string;
  let orgId: string;
  let fiscalYearId: string;

  async function createSubmittedBudget(amount: number): Promise<string> {
    const budget = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: `E2E Policy Budget ${amount}-${Date.now()}`,
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Policy fixture line',
            authorizedAmount: amount,
          },
        ],
      })
      .expect(201);
    const id = (budget.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${id}/submit`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .expect(200);
    return id;
  }

  beforeAll(async () => {
    process.env.HIGH_VALUE_APPROVAL_THRESHOLD = String(THRESHOLD);
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

    const org = await prisma.organization.upsert({
      where: { code: 'E2E-POLICY-ORG' },
      create: { code: 'E2E-POLICY-ORG', name: '[E2E] Policy Ministry', type: 'MINISTRY' },
      update: {},
    });
    orgId = org.id;

    const role = await prisma.role.upsert({
      where: { name: roleName },
      create: { name: roleName },
      update: {},
    });
    for (const [resource, action] of [
      ['budget', 'manage'],
      ['budget', 'create'],
      ['budget', 'read'],
      ['budget', 'approve'],
    ]) {
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

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    for (const [email, lastName] of [
      [creatorEmail, 'PolicyCreator'],
      [approverEmail, 'PolicyApprover'],
    ] as const) {
      const user = await prisma.user.upsert({
        where: { email },
        create: {
          email,
          firstName: '[E2E]',
          lastName,
          passwordHash,
          status: 'ACTIVE',
          organizationId: orgId,
          roles: { create: { roleId: role.id } },
        },
        update: { passwordHash, status: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
      });
      if (email === creatorEmail) creatorUserId = user.id;
      else approverUserId = user.id;
    }

    const creatorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: creatorEmail, password })
      .expect(200);
    creatorToken = (creatorLogin.body as LoginResponseBody).accessToken;

    const approverLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: approverEmail, password })
      .expect(200);
    approverToken = (approverLogin.body as LoginResponseBody).accessToken;

    const keyPair = generateEd25519KeyPair();
    approverKeyPem = keyPair.privateKeyPem;
    await request(app.getHttpServer())
      .post('/api/v1/users/me/signing-key')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ publicKeyPem: keyPair.publicKeyPem })
      .expect(201);

    approverSecret = await enrollTotp(app.getHttpServer(), approverToken);
    stepUpToken = await issueStepUpToken(app.getHttpServer(), approverToken, approverSecret);

    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({ name: `E2E-POLICY-FY-${Date.now()}`, startDate: '2027-07-01', endDate: '2028-06-30' })
      .expect(201);
    fiscalYearId = (fy.body as IdBody).id;
  });

  afterAll(async () => {
    const userIds = [creatorUserId, approverUserId];
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.digitalIdentity.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.mfaMethod.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityEvent.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (role) {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.role.delete({ where: { id: role.id } });
    }
    if (previousThreshold === undefined) delete process.env.HIGH_VALUE_APPROVAL_THRESHOLD;
    else process.env.HIGH_VALUE_APPROVAL_THRESHOLD = previousThreshold;
    await app.close();
  });

  it('denies a high-value approval without step-up, and audits the denial', async () => {
    const budgetId = await createSubmittedBudget(THRESHOLD * 5);
    const path = `/api/v1/budgets/${budgetId}/approve`;

    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${approverToken}`)
      .send(signRequest('POST', path, approverKeyPem))
      .expect(403);
    expect((response.body as ErrorResponseBody).message).toMatch(/step-up/i);

    const denial = await prisma.auditEvent.findFirst({
      where: { eventType: 'AUTHORIZATION_DENIED', resourceId: budgetId },
    });
    expect(denial).not.toBeNull();
    expect((denial!.payload as { rule: string }).rule).toBe('high-value-approval-step-up');
  });

  it('allows the same high-value approval once a fresh step-up token is presented', async () => {
    const budgetId = await createSubmittedBudget(THRESHOLD * 5);
    const path = `/api/v1/budgets/${budgetId}/approve`;

    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${approverToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send(signRequest('POST', path, approverKeyPem))
      .expect(200);
    expect((response.body as { status: string }).status).toBe('APPROVED');
  });

  it('leaves approvals at or below the threshold unchanged', async () => {
    const budgetId = await createSubmittedBudget(THRESHOLD);
    const path = `/api/v1/budgets/${budgetId}/approve`;

    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${approverToken}`)
      .send(signRequest('POST', path, approverKeyPem))
      .expect(200);
  });
});
