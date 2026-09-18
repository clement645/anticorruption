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
}

interface FiscalYearBody {
  id: string;
}

interface BudgetBody {
  id: string;
  status: string;
  lines: Array<{ id: string; code: string }>;
}

interface AllocationBody {
  id: string;
  authorizedAmount: string;
  committedAmount: string;
  spentAmount: string;
  availableAmount: string;
  status: string;
}

interface CommitmentBody {
  id: string;
  status: string;
}

interface AdjustmentBody {
  id: string;
  status: string;
}

/**
 * Exercises the Phase 5 budget module end-to-end: the full
 * create→submit→approve→allocate→commit→spend→adjust workflow, strict
 * budget state transitions, and — the actual point of commitment-control
 * accounting — that an allocation's balance can never be over-committed,
 * including under genuine concurrent load.
 */
describe('Budget (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const adminEmail = 'e2e-budget-admin@test.bpfmps.local';
  const noPermEmail = 'e2e-budget-noperm@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let adminUserId: string;
  let noPermUserId: string;
  let adminToken: string;
  let noPermToken: string;
  let orgId: string;
  let roleId: string;

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

    const org = await prisma.organization.upsert({
      where: { code: 'E2E-BUDGET-ORG' },
      create: {
        code: 'E2E-BUDGET-ORG',
        name: '[E2E] Budget Test Ministry',
        type: 'MINISTRY',
      },
      update: {},
    });
    orgId = org.id;

    const role = await prisma.role.upsert({
      where: { name: '[E2E] Budget Full Access' },
      create: { name: '[E2E] Budget Full Access' },
      update: {},
    });
    roleId = role.id;
    for (const [resource, action] of [
      ['budget', 'manage'],
      ['budget', 'read'],
      ['budget', 'create'],
      ['budget', 'approve'],
      ['budget', 'commit'],
      ['budget', 'spend'],
      ['budget', 'adjust'],
    ]) {
      const permission = await prisma.permission.upsert({
        where: { resource_action: { resource, action } },
        create: { resource, action, description: `${resource}:${action}` },
        update: {},
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: {
        email: adminEmail,
        firstName: '[E2E]',
        lastName: 'BudgetAdmin',
        passwordHash,
        status: 'ACTIVE',
        organizationId: orgId,
        roles: { create: { roleId: role.id } },
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    adminUserId = admin.id;

    const noPerm = await prisma.user.upsert({
      where: { email: noPermEmail },
      create: {
        email: noPermEmail,
        firstName: '[E2E]',
        lastName: 'NoPerm',
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
    noPermUserId = noPerm.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as LoginResponseBody).accessToken;

    const noPermLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: noPermEmail, password })
      .expect(200);
    noPermToken = (noPermLogin.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    await prisma.session.deleteMany({
      where: { userId: { in: [adminUserId, noPermUserId] } },
    });
    await prisma.userRole.deleteMany({ where: { userId: adminUserId } });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: [adminUserId, noPermUserId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [adminUserId, noPermUserId] } },
    });
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.role.delete({ where: { id: roleId } });
    await app.close();
  });

  it('rejects budget access without budget:read', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/budgets')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
  });

  it('runs the full create → submit → approve → allocate workflow with strict state transitions', async () => {
    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `E2E-FY-${Date.now()}`,
        startDate: '2027-07-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const fiscalYearId = (fy.body as FiscalYearBody).id;

    const budgetResponse = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: 'E2E Test Budget',
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Test line one',
            authorizedAmount: 100000,
          },
          {
            code: 'BL02',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Test line two',
            authorizedAmount: 50000,
          },
        ],
      })
      .expect(201);
    const budget = budgetResponse.body as BudgetBody;
    expect(budget.status).toBe('DRAFT');
    expect(budget.lines).toHaveLength(2);

    // Cannot approve a DRAFT budget directly — must go through PENDING_APPROVAL.
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/submit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Cannot submit an already-submitted budget.
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/submit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    const approveResponse = await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((approveResponse.body as BudgetBody).status).toBe('APPROVED');

    // Cannot approve twice.
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budget.id}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    const allocations = await request(app.getHttpServer())
      .get('/api/v1/allocations')
      .query({ organizationId: orgId, fiscalYearId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const items = (allocations.body as { items: AllocationBody[] }).items;
    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items.every((a) => a.status === 'ACTIVE')).toBe(true);
  });

  it('enforces commitment control: cannot commit or spend beyond the available balance', async () => {
    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `E2E-FY-CC-${Date.now()}`,
        startDate: '2027-07-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const fiscalYearId = (fy.body as FiscalYearBody).id;

    const budget = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: 'E2E Commitment Control Budget',
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Single line',
            authorizedAmount: 1000,
          },
        ],
      })
      .expect(201);
    const budgetId = (budget.body as BudgetBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/submit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const allocations = await request(app.getHttpServer())
      .get('/api/v1/allocations')
      .query({ organizationId: orgId, fiscalYearId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const allocationId = (allocations.body as { items: AllocationBody[] })
      .items[0].id;

    // Commit exactly the full authorized amount.
    const commitResponse = await request(app.getHttpServer())
      .post(`/api/v1/allocations/${allocationId}/commitments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 1000, description: 'Full commitment' })
      .expect(201);
    const commitmentId = (commitResponse.body as CommitmentBody).id;

    // A second commitment of even 1 unit must be rejected — nothing available.
    await request(app.getHttpServer())
      .post(`/api/v1/allocations/${allocationId}/commitments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 1, description: 'Should fail' })
      .expect(409);

    // Expenditure exceeding the commitment amount is rejected.
    await request(app.getHttpServer())
      .post(`/api/v1/commitments/${commitmentId}/expenditures`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 1001, description: 'Too much' })
      .expect(400);

    // A partial, valid expenditure succeeds and frees the unused remainder.
    await request(app.getHttpServer())
      .post(`/api/v1/commitments/${commitmentId}/expenditures`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amount: 800, description: 'Partial spend' })
      .expect(201);

    const afterSpend = await request(app.getHttpServer())
      .get(`/api/v1/allocations/${allocationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const afterSpendBody = afterSpend.body as AllocationBody;
    expect(afterSpendBody.committedAmount).toBe('0');
    expect(afterSpendBody.spentAmount).toBe('800');
    expect(afterSpendBody.availableAmount).toBe('200');

    // A DECREASE adjustment that would cut below already-spent must be rejected.
    const badAdjustment = await request(app.getHttpServer())
      .post(`/api/v1/allocations/${allocationId}/adjustments`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'DECREASE', amount: 900, reason: 'Would go below spent' })
      .expect(201);
    await request(app.getHttpServer())
      .post(
        `/api/v1/adjustments/${(badAdjustment.body as AdjustmentBody).id}/approve`,
      )
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
  });

  it('never allows concurrent commitments to over-commit an allocation', async () => {
    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `E2E-FY-CONC-${Date.now()}`,
        startDate: '2027-07-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const fiscalYearId = (fy.body as FiscalYearBody).id;

    const budget = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: 'E2E Concurrency Budget',
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Concurrency test line',
            authorizedAmount: 1000,
          },
        ],
      })
      .expect(201);
    const budgetId = (budget.body as BudgetBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/submit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const allocations = await request(app.getHttpServer())
      .get('/api/v1/allocations')
      .query({ organizationId: orgId, fiscalYearId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const allocationId = (allocations.body as { items: AllocationBody[] })
      .items[0].id;

    // 10 concurrent commitment requests of 200 each against an allocation of
    // 1000 — at most 5 can succeed. If the row-lock were missing, more than
    // 5 could succeed (a classic lost-update race), overshooting the ceiling.
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/allocations/${allocationId}/commitments`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ amount: 200, description: 'Concurrent commitment' }),
      ),
    );

    const succeeded = results.filter((r) => r.status === 201);
    const rejected = results.filter((r) => r.status === 409);
    expect(succeeded).toHaveLength(5);
    expect(rejected).toHaveLength(5);

    const finalAllocation = await request(app.getHttpServer())
      .get(`/api/v1/allocations/${allocationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const finalBody = finalAllocation.body as AllocationBody;
    expect(finalBody.committedAmount).toBe('1000');
    expect(finalBody.availableAmount).toBe('0');
  });
});
