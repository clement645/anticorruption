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
  lots: Array<{ id: string }>;
}
interface AlertBody {
  id: string;
  detectorType: string;
  severity: string;
  resourceType: string;
  resourceId: string;
  status: string;
  reviewedById: string | null;
}
interface RiskProfileBody {
  riskLevel: string;
  score: string;
}

/**
 * Exercises Phase 8 (AI Risk Engine): permission gating (including that
 * risk:review is withheld from the Procurement Officer role by design —
 * see seed.ts), the price-anomaly and bid-collusion detectors triggered by
 * TendersService.close(), the split-procurement detector triggered by
 * ProcurementRequestsService.approve(), the supplier-risk detector
 * triggered by PEP-owner-add/document-reject/suspend/blacklist, the
 * review workflow, and two regression tests for real statistical bugs
 * found during this phase's manual smoke testing: leave-one-out z-score
 * masking, and the "n=3 evenly-spaced points always score |z|=3" artifact.
 */
describe('AI Risk Engine (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const fullEmail = 'e2e-risk-full@test.bpfmps.local';
  const procOfficerEmail = 'e2e-risk-proc-officer@test.bpfmps.local';
  const noPermEmail = 'e2e-risk-noperm@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let fullUserId: string;
  let procOfficerUserId: string;
  let noPermUserId: string;
  let fullToken: string;
  let procOfficerToken: string;
  let noPermToken: string;
  let orgId: string;
  let splitOrgId: string;
  let fullRoleId: string;
  let procOfficerRoleId: string;
  let fiscalYearId: string;
  let allocationId: string;
  let planId: string;

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
      where: { code: 'E2E-RISK-ORG' },
      create: {
        code: 'E2E-RISK-ORG',
        name: '[E2E] Risk Test Ministry',
        type: 'MINISTRY',
      },
      update: {},
    });
    orgId = org.id;

    // A second organization, used only by the split-procurement tests, with
    // a run-unique code rather than a fixed/reused one (unlike `orgId`
    // above). Split-procurement detection is scoped by organizationId over
    // a rolling 30-day window that reads whatever requests currently exist
    // for that org — so a *fixed*, reused org code would let one test run's
    // requests (including the "single request already at threshold"
    // fixture) still be sitting inside the window on every subsequent run,
    // permanently poisoning the maxSingle-under-threshold check. Found by
    // running this suite repeatedly in a row (the project's standard
    // stress-testing pass): pass 1 was clean, every pass after consistently
    // failed — a deterministic accumulation bug, not flakiness.
    const splitOrg = await prisma.organization.create({
      data: {
        code: `E2E-RISK-SPLIT-ORG-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: '[E2E] Risk Split-Procurement Test Ministry',
        type: 'MINISTRY',
      },
    });
    splitOrgId = splitOrg.id;

    async function grantRole(roleName: string, grants: [string, string][]) {
      const role = await prisma.role.upsert({
        where: { name: roleName },
        create: { name: roleName },
        update: {},
      });
      for (const [resource, action] of grants) {
        const permission = await prisma.permission.upsert({
          where: { resource_action: { resource, action } },
          create: { resource, action, description: `${resource}:${action}` },
          update: {},
        });
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          create: { roleId: role.id, permissionId: permission.id },
          update: {},
        });
      }
      return role.id;
    }

    fullRoleId = await grantRole('[E2E] Risk Full Access', [
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
      ['supplier', 'manage'],
      ['supplier', 'read'],
      ['supplier', 'read_sensitive'],
      ['supplier', 'verify'],
      ['risk', 'read'],
      ['risk', 'review'],
      ['risk', 'manage'],
    ]);

    // Mirrors the real Procurement Officer grant in seed.ts: read + manage
    // (can trigger a re-scan) but NOT review — proving the conflict-of-
    // interest exclusion is actually enforced, not just documented.
    procOfficerRoleId = await grantRole('[E2E] Risk Proc Officer (no review)', [
      ['procurement', 'read'],
      ['risk', 'read'],
      ['risk', 'manage'],
    ]);

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const full = await prisma.user.upsert({
      where: { email: fullEmail },
      create: {
        email: fullEmail,
        firstName: '[E2E]',
        lastName: 'RiskFull',
        passwordHash,
        status: 'ACTIVE',
        organizationId: orgId,
        roles: { create: { roleId: fullRoleId } },
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    fullUserId = full.id;

    const procOfficer = await prisma.user.upsert({
      where: { email: procOfficerEmail },
      create: {
        email: procOfficerEmail,
        firstName: '[E2E]',
        lastName: 'RiskProcOfficer',
        passwordHash,
        status: 'ACTIVE',
        organizationId: orgId,
        roles: { create: { roleId: procOfficerRoleId } },
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    procOfficerUserId = procOfficer.id;

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

    const fullLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fullEmail, password })
      .expect(200);
    fullToken = (fullLogin.body as LoginResponseBody).accessToken;

    const procOfficerLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: procOfficerEmail, password })
      .expect(200);
    procOfficerToken = (procOfficerLogin.body as LoginResponseBody).accessToken;

    const noPermLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: noPermEmail, password })
      .expect(200);
    noPermToken = (noPermLogin.body as LoginResponseBody).accessToken;

    // Fixtures shared by the procurement-triggered detector tests.
    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: `E2E-RISK-FY-${Date.now()}`,
        startDate: '2027-07-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    fiscalYearId = (fy.body as IdBody).id;

    const budget = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: 'E2E Risk Fixture Budget',
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Fixture line',
            authorizedAmount: 20_000_000,
          },
        ],
      })
      .expect(201);
    const budgetId = (budget.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/submit`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    const allocations = await request(app.getHttpServer())
      .get('/api/v1/allocations')
      .query({ fiscalYearId })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    allocationId = (allocations.body as { items: Array<{ id: string }> })
      .items[0].id;

    const plan = await request(app.getHttpServer())
      .post('/api/v1/procurement-plans')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        organizationId: orgId,
        fiscalYearId,
        name: `E2E Risk Plan ${Date.now()}`,
      })
      .expect(201);
    planId = (plan.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-plans/${planId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
  });

  afterAll(async () => {
    const userIds = [fullUserId, procOfficerUserId, noPermUserId];
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: [fullRoleId, procOfficerRoleId] } },
    });
    await prisma.role.deleteMany({
      where: { id: { in: [fullRoleId, procOfficerRoleId] } },
    });
    await app.close();
  });

  async function createTenderWithBids(
    amounts: number[],
    estimatedAmount = 1_000_000,
  ): Promise<{ tenderId: string; lotId: string }> {
    const reqResponse = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: orgId,
        allocationId,
        title: `E2E risk request ${Date.now()}-${Math.random()}`,
        description: 'desc',
        estimatedAmount,
      })
      .expect(201);
    const requestId = (reqResponse.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const tender = await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/tenders`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        title: `E2E risk tender ${Date.now()}`,
        description: 'desc',
        closingDate: '2028-06-01',
        lots: [{ lotNumber: 'L1', description: 'lot1', estimatedAmount }],
      })
      .expect(201);
    const tenderId = (tender.body as TenderBody).id;
    const lotId = (tender.body as TenderBody).lots[0].id;
    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tenderId}/publish`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    for (const amount of amounts) {
      const supplier = await request(app.getHttpServer())
        .post('/api/v1/suppliers')
        .set('Authorization', `Bearer ${fullToken}`)
        .send({
          name: `[E2E] Bidder ${amount}-${Math.random()}`,
          registrationNumber: `E2E-RISK-BID-${Date.now()}-${Math.random()}`,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/tender-lots/${lotId}/bids`)
        .set('Authorization', `Bearer ${fullToken}`)
        .send({ supplierId: (supplier.body as IdBody).id, amount })
        .expect(201);
    }

    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tenderId}/close`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    return { tenderId, lotId };
  }

  it('rejects risk-alert access without risk:read', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
  });

  it('withholds risk:review from the Procurement Officer-shaped role (conflict of interest)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .set('Authorization', `Bearer ${procOfficerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/risk-alerts/00000000-0000-0000-0000-000000000000/review')
      .set('Authorization', `Bearer ${procOfficerToken}`)
      .send({ status: 'DISMISSED' })
      .expect(403);
  });

  it('flags a genuine price outlier via leave-one-out z-score, not the other bids', async () => {
    const { lotId } = await createTenderWithBids([
      990_001, 990_002, 990_003, 200_000,
    ]);

    const alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({ detectorType: 'PRICE_ANOMALY' })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    const lotAlerts = (alerts.body as AlertBody[]).filter(
      (a) => a.resourceType === 'Bid',
    );

    const bidsResponse = await request(app.getHttpServer())
      .get(`/api/v1/tender-lots/${lotId}/bids`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    const bidIds = (bidsResponse.body as Array<{ id: string }>).map(
      (b) => b.id,
    );
    const flaggedForThisLot = lotAlerts.filter((a) =>
      bidIds.includes(a.resourceId),
    );

    expect(flaggedForThisLot).toHaveLength(1);
    expect(flaggedForThisLot[0].severity).toBe('HIGH');
  });

  it(
    'regression: 3 ordinary, evenly-spaced bids do not falsely trigger price ' +
      'anomaly (leave-one-out z-score with only 2 peers is a degenerate ' +
      'statistic — a real bug found during Phase 8 manual smoke testing)',
    async () => {
      const { lotId } = await createTenderWithBids([990_000, 990_100, 990_200]);

      const bidsResponse = await request(app.getHttpServer())
        .get(`/api/v1/tender-lots/${lotId}/bids`)
        .set('Authorization', `Bearer ${fullToken}`)
        .expect(200);
      const bidIds = (bidsResponse.body as Array<{ id: string }>).map(
        (b) => b.id,
      );

      const alerts = await request(app.getHttpServer())
        .get('/api/v1/risk-alerts')
        .query({ detectorType: 'PRICE_ANOMALY' })
        .set('Authorization', `Bearer ${fullToken}`)
        .expect(200);
      const falsePositives = (alerts.body as AlertBody[]).filter((a) =>
        bidIds.includes(a.resourceId),
      );

      expect(falsePositives).toHaveLength(0);
    },
  );

  it('flags suspiciously uniform bidding as bid collusion', async () => {
    const { lotId } = await createTenderWithBids([990_000, 990_100, 990_200]);

    const alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({
        detectorType: 'BID_COLLUSION',
        resourceType: 'TenderLot',
        resourceId: lotId,
      })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    expect(alerts.body as AlertBody[]).toHaveLength(1);
    expect((alerts.body as AlertBody[])[0].severity).toBe('HIGH');
  });

  it('does not flag collusion for a normally-spread set of bids', async () => {
    const { lotId } = await createTenderWithBids([
      700_000, 950_000, 1_200_000, 1_450_000,
    ]);

    const alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({
        detectorType: 'BID_COLLUSION',
        resourceType: 'TenderLot',
        resourceId: lotId,
      })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    expect(alerts.body as AlertBody[]).toHaveLength(0);
  });

  it('flags a split-procurement pattern once 3 under-threshold requests exceed it combined', async () => {
    for (let i = 0; i < 2; i++) {
      const req = await request(app.getHttpServer())
        .post('/api/v1/procurement-requests')
        .set('Authorization', `Bearer ${fullToken}`)
        .send({
          procurementPlanId: planId,
          organizationId: splitOrgId,
          allocationId,
          title: `E2E split request ${i}-${Date.now()}`,
          description: 'desc',
          estimatedAmount: 400_000,
        })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/procurement-requests/${(req.body as IdBody).id}/submit`)
        .set('Authorization', `Bearer ${fullToken}`)
        .expect(200);
      await request(app.getHttpServer())
        .post(`/api/v1/procurement-requests/${(req.body as IdBody).id}/approve`)
        .set('Authorization', `Bearer ${fullToken}`)
        .expect(200);
    }

    // The 3rd approval is the one that should push the 30-day total (1.2M)
    // over the 1M threshold, with every individual request still under it.
    const thirdReq = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: splitOrgId,
        allocationId,
        title: `E2E split request 3-${Date.now()}`,
        description: 'desc',
        estimatedAmount: 400_000,
      })
      .expect(201);
    const thirdId = (thirdReq.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${thirdId}/submit`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${thirdId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({ detectorType: 'SPLIT_PROCUREMENT', resourceId: thirdId })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    expect((alerts.body as AlertBody[]).length).toBeGreaterThanOrEqual(1);
  });

  it('a single request already at/above the threshold is not "split procurement"', async () => {
    const req = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: splitOrgId,
        allocationId,
        title: `E2E single large request ${Date.now()}`,
        description: 'desc',
        estimatedAmount: 1_500_000,
      })
      .expect(201);
    const id = (req.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${id}/submit`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${id}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({ detectorType: 'SPLIT_PROCUREMENT', resourceId: id })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    expect(alerts.body as AlertBody[]).toHaveLength(0);
  });

  it('assesses supplier risk automatically on a PEP-owner add, and raises an alert once CRITICAL', async () => {
    const supplier = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: '[E2E] Risk Supplier',
        registrationNumber: `E2E-RISK-SUP-${Date.now()}`,
      })
      .expect(201);
    const supplierId = (supplier.body as IdBody).id;

    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/owners`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        fullName: '[E2E] PEP Owner',
        nationalIdOrPassport: '99999999',
        ownershipPercentage: 100,
        isPoliticallyExposedPerson: true,
      })
      .expect(201);

    const afterPep = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/risk-profile`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect((afterPep.body as RiskProfileBody).riskLevel).toBe('MEDIUM');

    let alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({ resourceType: 'Supplier', resourceId: supplierId })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect(alerts.body as AlertBody[]).toHaveLength(0);

    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/blacklist`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const afterBlacklist = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/risk-profile`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect((afterBlacklist.body as RiskProfileBody).riskLevel).toBe('CRITICAL');

    alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({ resourceType: 'Supplier', resourceId: supplierId })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect(alerts.body as AlertBody[]).toHaveLength(1);

    // Re-triggering without any state change must not create a duplicate
    // OPEN alert for the same underlying finding.
    await request(app.getHttpServer())
      .post(`/api/v1/risk-scans/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({ resourceType: 'Supplier', resourceId: supplierId })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect(alerts.body as AlertBody[]).toHaveLength(1);
  });

  it('runs an alert through the full review workflow, and blocks re-review once resolved', async () => {
    const supplier = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: '[E2E] Review Workflow Supplier',
        registrationNumber: `E2E-RISK-REVIEW-${Date.now()}`,
      })
      .expect(201);
    const supplierId = (supplier.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/blacklist`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({ resourceType: 'Supplier', resourceId: supplierId })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    const alertId = (alerts.body as AlertBody[])[0].id;

    await request(app.getHttpServer())
      .post(`/api/v1/risk-alerts/${alertId}/review`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ status: 'UNDER_REVIEW', notes: '[E2E] investigating' })
      .expect(200);

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/risk-alerts/${alertId}/review`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ status: 'CONFIRMED', notes: '[E2E] confirmed' })
      .expect(200);
    expect((confirmed.body as AlertBody).status).toBe('CONFIRMED');
    expect((confirmed.body as AlertBody).reviewedById).not.toBeNull();

    await request(app.getHttpServer())
      .post(`/api/v1/risk-alerts/${alertId}/review`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ status: 'DISMISSED' })
      .expect(400);
  });

  it('manual risk-scan endpoints require risk:manage and 404 on an unknown resource', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/risk-scans/suppliers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/risk-scans/suppliers/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/risk-scans/tenders/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(404);
  });
});
