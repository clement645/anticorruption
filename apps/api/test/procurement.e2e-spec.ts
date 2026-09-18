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
interface IdBody {
  id: string;
}
interface TenderBody {
  id: string;
  status: string;
  lots: Array<{ id: string; lotNumber: string }>;
}
interface BidBody {
  id: string;
  status: string;
}
interface AllocationBody {
  committedAmount: string;
  availableAmount: string;
}
interface RequestBody {
  status: string;
  commitmentId: string | null;
}

/**
 * Exercises the Phase 6 procurement module end-to-end: the full
 * plan→request→tender→lots→bids→evaluation→award workflow, its strict state
 * transitions, the Budget↔Procurement integration (approving a request
 * really creates a budget Commitment via Phase 5's row-locked
 * AllocationsService), and — the actual point of the unique-constraint
 * design on Award — that a lot can never be awarded twice, including under
 * genuine concurrent load.
 */
describe('Procurement (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const adminEmail = 'e2e-proc-admin@test.bpfmps.local';
  const noPermEmail = 'e2e-proc-noperm@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let adminUserId: string;
  let noPermUserId: string;
  let adminToken: string;
  let noPermToken: string;
  let orgId: string;
  let roleId: string;
  let fiscalYearId: string;
  let allocationId: string;
  let planId: string;
  let supplierAId: string;
  let supplierBId: string;

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
      where: { code: 'E2E-PROC-ORG' },
      create: {
        code: 'E2E-PROC-ORG',
        name: '[E2E] Procurement Test Ministry',
        type: 'MINISTRY',
      },
      update: {},
    });
    orgId = org.id;

    const role = await prisma.role.upsert({
      where: { name: '[E2E] Procurement Full Access' },
      create: { name: '[E2E] Procurement Full Access' },
      update: {},
    });
    roleId = role.id;
    for (const [resource, action] of [
      ['budget', 'manage'],
      ['budget', 'read'],
      ['budget', 'create'],
      ['budget', 'approve'],
      ['budget', 'commit'],
      ['procurement', 'manage'],
      ['procurement', 'read'],
      ['procurement', 'create'],
      ['procurement', 'approve'],
      ['procurement', 'publish'],
      ['procurement', 'bid'],
      ['procurement', 'evaluate'],
      ['procurement', 'award'],
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
        lastName: 'ProcAdmin',
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

    // Fixtures: an approved budget → allocation, an approved procurement
    // plan, and two suppliers — everything each test needs to create its own
    // request/tender against, without re-deriving this scaffolding per test.
    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: `E2E-PROC-FY-${Date.now()}`,
        startDate: '2027-07-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    fiscalYearId = (fy.body as IdBody).id;

    const budget = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: 'E2E Procurement Fixture Budget',
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Fixture line',
            authorizedAmount: 1_000_000,
          },
        ],
      })
      .expect(201);
    const budgetId = (budget.body as IdBody).id;
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
      .query({ fiscalYearId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    allocationId = (allocations.body as { items: Array<{ id: string }> })
      .items[0].id;

    const plan = await request(app.getHttpServer())
      .post('/api/v1/procurement-plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        organizationId: orgId,
        fiscalYearId,
        name: `E2E Plan ${Date.now()}`,
      })
      .expect(201);
    planId = (plan.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-plans/${planId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const supplierA = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '[E2E] Supplier A',
        registrationNumber: `E2E-REG-A-${Date.now()}`,
      })
      .expect(201);
    supplierAId = (supplierA.body as IdBody).id;

    const supplierB = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: '[E2E] Supplier B',
        registrationNumber: `E2E-REG-B-${Date.now()}`,
      })
      .expect(201);
    supplierBId = (supplierB.body as IdBody).id;
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

  it('rejects procurement access without procurement:read', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
  });

  it('creating a request against a non-approved plan is rejected', async () => {
    const draftPlan = await request(app.getHttpServer())
      .post('/api/v1/procurement-plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        organizationId: orgId,
        fiscalYearId,
        name: `E2E Draft Plan ${Date.now()}`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        procurementPlanId: (draftPlan.body as IdBody).id,
        organizationId: orgId,
        allocationId,
        title: 'Should fail',
        description: 'Plan not approved',
        estimatedAmount: 1000,
      })
      .expect(400);
  });

  it('runs the full plan→request→tender→bid→evaluate→award workflow, integrating with the budget commitment', async () => {
    // --- Request ---
    const reqResponse = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: orgId,
        allocationId,
        title: 'E2E procurement request',
        description: 'Two-lot tender',
        estimatedAmount: 100_000,
      })
      .expect(201);
    const requestId = (reqResponse.body as IdBody).id;

    // Cannot create a tender against a DRAFT request.
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/tenders`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'x',
        description: 'x',
        closingDate: '2027-08-01',
        lots: [{ lotNumber: 'L1', description: 'x', estimatedAmount: 1000 }],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const beforeApproval = await request(app.getHttpServer())
      .get(`/api/v1/allocations/${allocationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const committedBefore = (beforeApproval.body as AllocationBody)
      .committedAmount;

    // --- Approve request: this is the Budget↔Procurement integration point ---
    const approvedRequest = await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const approvedBody = approvedRequest.body as RequestBody;
    expect(approvedBody.status).toBe('APPROVED');
    expect(approvedBody.commitmentId).toEqual(expect.any(String));

    const afterApproval = await request(app.getHttpServer())
      .get(`/api/v1/allocations/${allocationId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const afterBody = afterApproval.body as AllocationBody;
    expect(Number(afterBody.committedAmount)).toBe(
      Number(committedBefore) + 100_000,
    );

    // --- Tender with two lots ---
    const tenderResponse = await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/tenders`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'E2E tender',
        description: 'Two lots',
        closingDate: '2027-08-01',
        lots: [
          {
            lotNumber: 'LOT-1',
            description: 'First lot',
            estimatedAmount: 60_000,
          },
          {
            lotNumber: 'LOT-2',
            description: 'Second lot',
            estimatedAmount: 40_000,
          },
        ],
      })
      .expect(201);
    const tender = tenderResponse.body as TenderBody;
    expect(tender.status).toBe('DRAFT');
    expect(tender.lots).toHaveLength(2);
    const [lot1, lot2] = tender.lots;

    // Cannot submit a bid against a DRAFT (unpublished) tender.
    await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lot1.id}/bids`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplierId: supplierAId, amount: 55_000 })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tender.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // --- Bids: two suppliers on lot 1, one on lot 2 ---
    const bidA1 = await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lot1.id}/bids`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplierId: supplierAId, amount: 58_000 })
      .expect(201);
    const bidB1 = await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lot1.id}/bids`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplierId: supplierBId, amount: 55_000 })
      .expect(201);
    const bidA2 = await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lot2.id}/bids`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplierId: supplierAId, amount: 38_000 })
      .expect(201);

    // A supplier cannot submit a second bid for the same lot.
    await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lot1.id}/bids`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplierId: supplierAId, amount: 59_000 })
      .expect(409);

    // Cannot evaluate before the tender closes.
    await request(app.getHttpServer())
      .post(`/api/v1/bids/${(bidA1.body as IdBody).id}/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ technicalScore: 80, financialScore: 80 })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tender.id}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Cannot submit a bid after closing.
    await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lot1.id}/bids`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplierId: supplierBId, amount: 1 })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/bids/${(bidA1.body as IdBody).id}/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ technicalScore: 85, financialScore: 88 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bids/${(bidB1.body as IdBody).id}/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ technicalScore: 70, financialScore: 95 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bids/${(bidA2.body as IdBody).id}/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ technicalScore: 90, financialScore: 90 })
      .expect(201);

    // Award lot 1 to supplier A's bid; supplier B's competing bid must flip to REJECTED.
    await request(app.getHttpServer())
      .post(`/api/v1/bids/${(bidA1.body as IdBody).id}/award`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const lot1Bids = await request(app.getHttpServer())
      .get(`/api/v1/tender-lots/${lot1.id}/bids`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const lot1BidStatuses = (lot1Bids.body as BidBody[]).reduce<
      Record<string, string>
    >((acc, b) => ({ ...acc, [b.id]: b.status }), {});
    expect(lot1BidStatuses[(bidA1.body as IdBody).id]).toBe('AWARDED');
    expect(lot1BidStatuses[(bidB1.body as IdBody).id]).toBe('REJECTED');

    // Tender is not yet fully awarded — lot 2 still open.
    const midTender = await request(app.getHttpServer())
      .get(`/api/v1/tenders/${tender.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((midTender.body as TenderBody).status).toBe('CLOSED');

    await request(app.getHttpServer())
      .post(`/api/v1/bids/${(bidA2.body as IdBody).id}/award`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const finalTender = await request(app.getHttpServer())
      .get(`/api/v1/tenders/${tender.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((finalTender.body as TenderBody).status).toBe('AWARDED');
  });

  it('never awards the same lot twice, including under concurrent requests', async () => {
    const reqResponse = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: orgId,
        allocationId,
        title: 'E2E concurrency request',
        description: 'Single-lot tender for the award race test',
        estimatedAmount: 10_000,
      })
      .expect(201);
    const requestId = (reqResponse.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const tenderResponse = await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/tenders`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'E2E race tender',
        description: 'Single lot',
        closingDate: '2027-08-01',
        lots: [
          {
            lotNumber: 'ONLY-LOT',
            description: 'Only lot',
            estimatedAmount: 10_000,
          },
        ],
      })
      .expect(201);
    const tender = tenderResponse.body as TenderBody;
    const lotId = tender.lots[0].id;

    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tender.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const bid = await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lotId}/bids`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ supplierId: supplierAId, amount: 9_500 })
      .expect(201);
    const bidId = (bid.body as IdBody).id;

    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tender.id}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/bids/${bidId}/evaluate`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ technicalScore: 80, financialScore: 80 })
      .expect(201);

    // Fire 5 genuinely concurrent award attempts at the same evaluated bid.
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app.getHttpServer())
          .post(`/api/v1/bids/${bidId}/award`)
          .set('Authorization', `Bearer ${adminToken}`),
      ),
    );

    const succeeded = results.filter((r) => r.status === 200);
    const failed = results.filter((r) => r.status !== 200);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(4);
    for (const r of failed) {
      expect([400, 409]).toContain(r.status);
    }

    const awardCount = await prisma.award.count({
      where: { tenderLotId: lotId },
    });
    expect(awardCount).toBe(1);
  });
});
