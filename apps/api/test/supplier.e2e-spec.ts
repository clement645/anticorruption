import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
interface OwnerBody {
  id: string;
  ownershipPercentage: string;
}
interface DocumentBody {
  id: string;
  fileHash: string;
  status: string;
}
interface RiskProfileBody {
  id: string;
  riskLevel: string;
  score: string;
}
interface SupplierBody {
  id: string;
  status: string;
}
interface TenderBody {
  id: string;
  lots: Array<{ id: string }>;
}

/**
 * Exercises Phase 7 (Supplier Management): the extended profile fields,
 * beneficial-owner disclosure with its application-layer 100% cap, document
 * upload with server-computed SHA-256 hashing + verify/reject, append-only
 * risk assessment history, the ACTIVE/SUSPENDED/BLACKLISTED status state
 * machine, RBAC-gated visibility (supplier:read vs supplier:read_sensitive),
 * and the real integration point with Phase 6: a non-ACTIVE supplier is
 * actually blocked from bidding, not just flagged.
 */
describe('Supplier Management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const fullEmail = 'e2e-supplier-full@test.bpfmps.local';
  const limitedEmail = 'e2e-supplier-limited@test.bpfmps.local';
  const noPermEmail = 'e2e-supplier-noperm@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let fullUserId: string;
  let limitedUserId: string;
  let noPermUserId: string;
  let fullToken: string;
  let limitedToken: string;
  let noPermToken: string;
  let orgId: string;
  let fullRoleId: string;
  let limitedRoleId: string;

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
      where: { code: 'E2E-SUPPLIER-ORG' },
      create: {
        code: 'E2E-SUPPLIER-ORG',
        name: '[E2E] Supplier Test Ministry',
        type: 'MINISTRY',
      },
      update: {},
    });
    orgId = org.id;

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

    fullRoleId = await grantRole('[E2E] Supplier Full Access', [
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
      ['supplier', 'read'],
      ['supplier', 'read_sensitive'],
      ['supplier', 'manage'],
      ['supplier', 'verify'],
    ]);

    // Deliberately WITHOUT supplier:read_sensitive or supplier:manage — this
    // is what proves visibility is actually RBAC-gated, not just documented.
    limitedRoleId = await grantRole('[E2E] Supplier Basic Read', [
      ['supplier', 'read'],
    ]);

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const full = await prisma.user.upsert({
      where: { email: fullEmail },
      create: {
        email: fullEmail,
        firstName: '[E2E]',
        lastName: 'SupplierFull',
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

    const limited = await prisma.user.upsert({
      where: { email: limitedEmail },
      create: {
        email: limitedEmail,
        firstName: '[E2E]',
        lastName: 'SupplierLimited',
        passwordHash,
        status: 'ACTIVE',
        organizationId: orgId,
        roles: { create: { roleId: limitedRoleId } },
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    limitedUserId = limited.id;

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

    const limitedLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: limitedEmail, password })
      .expect(200);
    limitedToken = (limitedLogin.body as LoginResponseBody).accessToken;

    const noPermLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: noPermEmail, password })
      .expect(200);
    noPermToken = (noPermLogin.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    const userIds = [fullUserId, limitedUserId, noPermUserId];
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: [fullRoleId, limitedRoleId] } },
    });
    await prisma.role.deleteMany({
      where: { id: { in: [fullRoleId, limitedRoleId] } },
    });
    await app.close();
  });

  async function createSupplier(): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: '[E2E] Supplier Mgmt Co',
        registrationNumber: `E2E-SM-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      .expect(201);
    return (response.body as IdBody).id;
  }

  it('rejects supplier access without supplier:read', async () => {
    const supplierId = await createSupplier();
    await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/profile`)
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
  });

  it('updates and reads the extended supplier profile', async () => {
    const supplierId = await createSupplier();

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        businessType: 'LIMITED_COMPANY',
        taxIdentifier: 'P0512345X',
        county: 'Nairobi',
        contactPersonName: 'Jane Doe',
      })
      .expect(200);
    expect(updated.body).toMatchObject({
      businessType: 'LIMITED_COMPANY',
      county: 'Nairobi',
    });

    // supplier:read (without :manage) can view but not update.
    await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/profile`)
      .set('Authorization', `Bearer ${limitedToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/suppliers/${supplierId}`)
      .set('Authorization', `Bearer ${limitedToken}`)
      .send({ county: 'Mombasa' })
      .expect(403);
  });

  it('enforces the 100% beneficial-ownership cap and RBAC-gates owner visibility', async () => {
    const supplierId = await createSupplier();

    const owner1 = await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/owners`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        fullName: '[E2E] Owner One',
        nationalIdOrPassport: '11111111',
        ownershipPercentage: 60,
        isPoliticallyExposedPerson: true,
      })
      .expect(201);
    expect((owner1.body as OwnerBody).ownershipPercentage).toBe('60');

    // 60 + 50 = 110 > 100 — rejected.
    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/owners`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        fullName: '[E2E] Owner Two',
        nationalIdOrPassport: '22222222',
        ownershipPercentage: 50,
      })
      .expect(400);

    // 60 + 40 = 100 — accepted.
    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/owners`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        fullName: '[E2E] Owner Two',
        nationalIdOrPassport: '22222222',
        ownershipPercentage: 40,
      })
      .expect(201);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/owners`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect(list.body as OwnerBody[]).toHaveLength(2);

    // supplier:read alone (no :read_sensitive) cannot see beneficial owners.
    await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/owners`)
      .set('Authorization', `Bearer ${limitedToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(
        `/api/v1/suppliers/${supplierId}/owners/${(owner1.body as OwnerBody).id}/remove`,
      )
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(201);

    const afterRemove = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/owners`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect(afterRemove.body as OwnerBody[]).toHaveLength(1);
  });

  it(
    'the ownership-total cap is an application-layer check only, and does not hold ' +
      'under genuine concurrent adds — a documented, accepted gap (see THREAT_MODEL.md ' +
      'Phase 7), not an asserted guarantee',
    async () => {
      const supplierId = await createSupplier();

      const attempts = [70, 70, 70].map((percentage, index) =>
        request(app.getHttpServer())
          .post(`/api/v1/suppliers/${supplierId}/owners`)
          .set('Authorization', `Bearer ${fullToken}`)
          .send({
            fullName: `[E2E] Concurrent Owner ${index}`,
            nationalIdOrPassport: `RACE-${index}`,
            ownershipPercentage: percentage,
          }),
      );
      const results = await Promise.all(attempts);
      const succeeded = results.filter((r) => r.status === 201).length;

      // Each individual add is <=100 read-then-write with no lock between
      // the read and the write, so more than one of three concurrent 70%
      // adds can succeed — this assertion documents that real behavior
      // rather than asserting the (currently false) safe outcome.
      expect(succeeded).toBeGreaterThanOrEqual(1);

      const list = await request(app.getHttpServer())
        .get(`/api/v1/suppliers/${supplierId}/owners`)
        .set('Authorization', `Bearer ${fullToken}`)
        .expect(200);
      const total = (list.body as OwnerBody[]).reduce(
        (sum, o) => sum + Number(o.ownershipPercentage),
        0,
      );
      if (succeeded > 1) {
        expect(total).toBeGreaterThan(100);
      }
    },
  );

  it('uploads a document with a server-computed hash and runs it through verify/reject', async () => {
    const supplierId = await createSupplier();

    const content = Buffer.from(
      '[E2E] fake tax compliance certificate content',
    );
    const expectedHash = createHash('sha256').update(content).digest('hex');

    const uploaded = await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/documents`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        documentType: 'TAX_COMPLIANCE_CERTIFICATE',
        fileName: 'tax-cert.txt',
        mimeType: 'text/plain',
        fileContentBase64: content.toString('base64'),
      })
      .expect(201);
    const doc = uploaded.body as DocumentBody;
    expect(doc.fileHash).toBe(expectedHash);
    expect(doc.status).toBe('PENDING');

    // supplier:read alone cannot see documents.
    await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/documents`)
      .set('Authorization', `Bearer ${limitedToken}`)
      .expect(403);

    const verified = await request(app.getHttpServer())
      .post(`/api/v1/supplier-documents/${doc.id}/verify`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(201);
    expect((verified.body as DocumentBody).status).toBe('VERIFIED');

    // Already VERIFIED — cannot verify or reject again.
    await request(app.getHttpServer())
      .post(`/api/v1/supplier-documents/${doc.id}/verify`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/supplier-documents/${doc.id}/reject`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ reason: 'too late' })
      .expect(400);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/documents`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        documentType: 'CR12',
        fileName: 'cr12.txt',
        mimeType: 'text/plain',
        fileContentBase64: Buffer.from('[E2E] second doc').toString('base64'),
      })
      .expect(201);
    const rejected = await request(app.getHttpServer())
      .post(
        `/api/v1/supplier-documents/${(second.body as DocumentBody).id}/reject`,
      )
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ reason: '[E2E] illegible scan' })
      .expect(201);
    expect((rejected.body as DocumentBody).status).toBe('REJECTED');
  });

  it('records append-only risk assessments; "current" is the most recent', async () => {
    const supplierId = await createSupplier();

    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/risk-profile`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        riskLevel: 'HIGH',
        score: 72.5,
        factors: ['politically_exposed_owner'],
        notes: '[E2E] first assessment',
      })
      .expect(201);

    const second = await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/risk-profile`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ riskLevel: 'LOW', score: 10, factors: [] })
      .expect(201);

    const current = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/risk-profile`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect((current.body as RiskProfileBody).id).toBe(
      (second.body as RiskProfileBody).id,
    );

    const history = await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/risk-profile/history`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect(history.body as RiskProfileBody[]).toHaveLength(2);

    // RBAC: supplier:read alone cannot see the risk profile.
    await request(app.getHttpServer())
      .get(`/api/v1/suppliers/${supplierId}/risk-profile`)
      .set('Authorization', `Bearer ${limitedToken}`)
      .expect(403);
  });

  it('enforces the ACTIVE→SUSPENDED→ACTIVE / ACTIVE→BLACKLISTED (terminal) state machine', async () => {
    const supplierId = await createSupplier();

    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/reactivate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(400); // already ACTIVE, nothing to reactivate from

    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/suspend`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/suspend`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(400); // already SUSPENDED

    const reactivated = await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/reactivate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect((reactivated.body as SupplierBody).status).toBe('ACTIVE');

    const blacklisted = await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/blacklist`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect((blacklisted.body as SupplierBody).status).toBe('BLACKLISTED');

    // BLACKLISTED is a one-way door — no reactivate path back (see
    // SupplierProfileService.blacklist doc comment).
    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/reactivate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/blacklist`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(400);
  });

  it('a SUSPENDED supplier is actually blocked from bidding — not just flagged', async () => {
    const supplierId = await createSupplier();

    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: `E2E-SUP-FY-${Date.now()}`,
        startDate: '2027-07-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const fiscalYearId = (fy.body as IdBody).id;

    const budget = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: 'E2E Supplier Fixture Budget',
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
    const allocationId = (allocations.body as { items: Array<{ id: string }> })
      .items[0].id;

    const plan = await request(app.getHttpServer())
      .post('/api/v1/procurement-plans')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        organizationId: orgId,
        fiscalYearId,
        name: `E2E Supplier Plan ${Date.now()}`,
      })
      .expect(201);
    const planId = (plan.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-plans/${planId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const procRequest = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: orgId,
        allocationId,
        title: 'E2E supplier-status request',
        description: 'desc',
        estimatedAmount: 50_000,
      })
      .expect(201);
    const requestId = (procRequest.body as IdBody).id;
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
        title: 'E2E supplier-status tender',
        description: 'desc',
        closingDate: '2028-06-01',
        lots: [
          { lotNumber: 'L1', description: 'lot1', estimatedAmount: 50_000 },
        ],
      })
      .expect(201);
    const tenderId = (tender.body as TenderBody).id;
    const lotId = (tender.body as TenderBody).lots[0].id;
    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tenderId}/publish`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    // Bidding works while ACTIVE.
    await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lotId}/bids`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ supplierId, amount: 45_000 })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/suspend`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const otherSupplierId = await createSupplier();

    const rejectedBid = await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lotId}/bids`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ supplierId, amount: 46_000 })
      .expect(400);
    expect((rejectedBid.body as { message: string }).message).toContain(
      'not eligible to bid',
    );

    // A different, still-ACTIVE supplier bidding on the same lot for the
    // first time is unaffected — suspension is scoped to the one supplier,
    // not the lot.
    await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lotId}/bids`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ supplierId: otherSupplierId, amount: 47_000 })
      .expect(201);
  });
});
