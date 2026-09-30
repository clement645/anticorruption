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
interface ScorecardBody {
  userId: string;
  firstName: string;
  lastName: string;
  roles: string[];
  totalActions: number;
  budgetsApproved: { count: number; totalAmount: string };
  procurementRequestsApproved: { count: number; totalAmount: string };
  awardsMade: {
    count: number;
    totalAmount: string;
    distinctSuppliers: number;
    vendorDiversityRatio: number | null;
  };
  riskFlaggedActionCount: number;
  complianceRate: number | null;
}

/**
 * Public, named per-official accountability scorecards (post-launch item 4)
 * — a deliberate, user-confirmed exception to the Transparency Portal's
 * "no individual identity, anywhere" rule. See accountability.types.ts and
 * SECURITY.md § Public Accountability Scorecards for the full reasoning.
 */
describe('Public Accountability Scorecards (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const officerEmail = 'e2e-accountability-officer@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let officerUserId: string;
  let officerToken: string;
  let orgId: string;
  let roleId: string;
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
      where: { code: 'E2E-ACCOUNTABILITY-ORG' },
      create: {
        code: 'E2E-ACCOUNTABILITY-ORG',
        name: '[E2E] Accountability Test Ministry',
        type: 'MINISTRY',
      },
      update: {},
    });
    orgId = org.id;

    const role = await prisma.role.upsert({
      where: { name: '[E2E] Accountability Full Access' },
      create: { name: '[E2E] Accountability Full Access' },
      update: {},
    });
    roleId = role.id;
    for (const [resource, action] of [
      ['budget', 'manage'],
      ['budget', 'create'],
      ['budget', 'read'],
      ['budget', 'approve'],
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
    const officer = await prisma.user.upsert({
      where: { email: officerEmail },
      create: {
        email: officerEmail,
        firstName: '[E2E]',
        lastName: 'AccountabilityOfficer',
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
    officerUserId = officer.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: officerEmail, password })
      .expect(200);
    officerToken = (login.body as LoginResponseBody).accessToken;

    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        name: `E2E-ACCOUNTABILITY-FY-${Date.now()}`,
        startDate: '2027-07-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    fiscalYearId = (fy.body as IdBody).id;

    const budget = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: `E2E Accountability Budget ${Date.now()}`,
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Fixture line',
            authorizedAmount: 5_000_000,
          },
        ],
      })
      .expect(201);
    const budgetId = (budget.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/submit`)
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);

    // budget:approve is @RequireSignature() — enroll a key for this officer
    // (same test helper pattern used throughout the suite).
    const keyPair = generateEd25519KeyPair();
    await request(app.getHttpServer())
      .post('/api/v1/users/me/signing-key')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ publicKeyPem: keyPair.publicKeyPem })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/approve`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send(
        signRequest(
          'POST',
          `/api/v1/budgets/${budgetId}/approve`,
          keyPair.privateKeyPem,
        ),
      )
      .expect(200);

    const allocations = await request(app.getHttpServer())
      .get('/api/v1/allocations')
      .query({ organizationId: orgId, fiscalYearId })
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);
    allocationId = (allocations.body as { items: Array<{ id: string }> })
      .items[0].id;

    const plan = await request(app.getHttpServer())
      .post('/api/v1/procurement-plans')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        organizationId: orgId,
        fiscalYearId,
        name: `E2E Accountability Plan ${Date.now()}`,
      })
      .expect(201);
    planId = (plan.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-plans/${planId}/approve`)
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: officerUserId } });
    await prisma.digitalIdentity.deleteMany({
      where: { userId: officerUserId },
    });
    await prisma.userRole.deleteMany({ where: { userId: officerUserId } });
    await prisma.securityEvent.deleteMany({ where: { userId: officerUserId } });
    await prisma.user.delete({ where: { id: officerUserId } });
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.role.deleteMany({ where: { id: roleId } });
    await app.close();
  });

  it('is unauthenticated (public) and reflects the budget approval performed during setup', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/public/accountability/officials')
      .expect(200);
    const items = (list.body as { items: ScorecardBody[] }).items;
    const mine = items.find((i) => i.userId === officerUserId);
    expect(mine).toBeDefined();
    expect(mine!.budgetsApproved.count).toBeGreaterThanOrEqual(1);
    // No award made yet at this point in the suite.
    expect(mine!.awardsMade.count).toBe(0);
  });

  it('reflects a real award once the officer awards a tender lot, including vendor diversity', async () => {
    const reqResponse = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: orgId,
        allocationId,
        title: `E2E accountability request ${Date.now()}`,
        description: 'desc',
        estimatedAmount: 900_000,
      })
      .expect(201);
    const requestId = (reqResponse.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);

    const tender = await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/tenders`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        title: `E2E accountability tender ${Date.now()}`,
        description: 'desc',
        closingDate: '2028-06-01',
        lots: [
          { lotNumber: 'L1', description: 'lot1', estimatedAmount: 900_000 },
        ],
      })
      .expect(201);
    const tenderId = (tender.body as TenderBody).id;
    const lotId = (tender.body as TenderBody).lots[0].id;
    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tenderId}/publish`)
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);

    const supplier = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${officerToken}`)
      .send({
        name: `[E2E] Accountability Supplier ${Math.random()}`,
        registrationNumber: `E2E-ACCOUNTABILITY-SUP-${Date.now()}-${Math.random()}`,
      })
      .expect(201);
    const supplierId = (supplier.body as IdBody).id;

    const bid = await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lotId}/bids`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ supplierId, amount: 900_000 })
      .expect(201);
    const bidId = (bid.body as IdBody).id;

    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tenderId}/close`)
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/bids/${bidId}/evaluate`)
      .set('Authorization', `Bearer ${officerToken}`)
      .send({ technicalScore: 90, financialScore: 85 })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/bids/${bidId}/award`)
      .set('Authorization', `Bearer ${officerToken}`)
      .expect(200);

    const scorecard = await request(app.getHttpServer())
      .get(`/api/v1/public/accountability/officials/${officerUserId}`)
      .expect(200);
    const body = scorecard.body as ScorecardBody;

    expect(body.firstName).toBe('[E2E]');
    expect(body.lastName).toBe('AccountabilityOfficer');
    expect(body.budgetsApproved.count).toBeGreaterThanOrEqual(1);
    expect(body.procurementRequestsApproved.count).toBeGreaterThanOrEqual(1);
    expect(body.awardsMade.count).toBeGreaterThanOrEqual(1);
    expect(body.awardsMade.distinctSuppliers).toBeGreaterThanOrEqual(1);
    expect(body.awardsMade.vendorDiversityRatio).toBe(1);
    expect(body.totalActions).toBeGreaterThanOrEqual(3);
    expect(body.complianceRate).not.toBeNull();

    const list = await request(app.getHttpServer())
      .get('/api/v1/public/accountability/officials')
      .expect(200);
    const listIds = (list.body as { items: ScorecardBody[] }).items.map(
      (i) => i.userId,
    );
    expect(listIds).toContain(officerUserId);
  });

  it('returns 404 for a user id that does not exist', async () => {
    await request(app.getHttpServer())
      .get(
        '/api/v1/public/accountability/officials/00000000-0000-4000-8000-000000000000',
      )
      .expect(404);
  });
});
