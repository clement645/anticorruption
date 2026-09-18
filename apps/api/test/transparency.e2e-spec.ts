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
interface ContractBody {
  id: string;
}
interface ProjectBody {
  id: string;
}
interface EvidenceBody {
  fileHash: string;
}
interface PublicList<T> {
  items: T[];
  total: number;
}
interface PublicProjectDetail {
  milestones: Array<Record<string, unknown>>;
  evidence: Array<Record<string, unknown>>;
}
interface PublicTenderDetail {
  status: string;
  lots: Array<{
    award: { supplierName: string; awardedAmount: string } | null;
  }>;
}
interface PublicSupplier {
  status: string;
}
interface PublicHashVerification {
  found: boolean;
  chainIntact?: boolean;
  anchored?: boolean;
  projectName?: string;
}

/**
 * Exercises Phase 12 (Citizen Transparency Portal): every `/public/*` route
 * is reachable with NO Authorization header at all — the point of this
 * suite is as much "privacy filtering never leaks an internal field" as it
 * is "the feature works". Fixture setup uses an internal, authenticated
 * "full access" user (mirroring every other phase's e2e fixtures); every
 * actual assertion against `/public/*` deliberately omits the Authorization
 * header to prove these routes are genuinely public, not merely permissive.
 */
describe('Citizen Transparency Portal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const fullEmail = 'e2e-transparency-full@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let fullUserId: string;
  let fullToken: string;
  let orgId: string;
  let fullRoleId: string;
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
      where: { code: 'E2E-TRANSPARENCY-ORG' },
      create: {
        code: 'E2E-TRANSPARENCY-ORG',
        name: '[E2E] Transparency Test Ministry',
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

    fullRoleId = await grantRole('[E2E] Transparency Full Access', [
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
      ['contract', 'read'],
      ['contract', 'manage'],
      ['project', 'read'],
      ['project', 'manage'],
      ['evidence', 'upload'],
      ['supplier', 'manage'],
    ]);

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const admin = await prisma.user.upsert({
      where: { email: fullEmail },
      create: {
        email: fullEmail,
        firstName: '[E2E]',
        lastName: 'TransparencyFull',
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
    fullUserId = admin.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: fullEmail, password })
      .expect(200);
    fullToken = (login.body as LoginResponseBody).accessToken;

    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: `E2E-TRANSPARENCY-FY-${Date.now()}`,
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
        name: 'E2E Transparency Fixture Budget',
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Fixture line',
            authorizedAmount: 50_000_000,
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
        name: `E2E Transparency Plan ${Date.now()}`,
      })
      .expect(201);
    planId = (plan.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-plans/${planId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: fullUserId } });
    await prisma.userRole.deleteMany({ where: { userId: fullUserId } });
    await prisma.securityEvent.deleteMany({ where: { userId: fullUserId } });
    await prisma.user.deleteMany({ where: { id: fullUserId } });
    await prisma.rolePermission.deleteMany({ where: { roleId: fullRoleId } });
    await prisma.role.deleteMany({ where: { id: fullRoleId } });
    await app.close();
  });

  /** Drives plan -> ... -> a real AWARDED tender lot, returning both ids. */
  async function createAwardedTender(
    amount = 900_000,
  ): Promise<{ tenderId: string; lotId: string; awardId: string }> {
    const reqResponse = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: orgId,
        allocationId,
        title: `E2E transparency request ${Date.now()}-${Math.random()}`,
        description: 'desc',
        estimatedAmount: amount,
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
        title: `E2E transparency tender ${Date.now()}`,
        description: 'A public-interest road rehabilitation tender',
        closingDate: '2028-06-01',
        lots: [
          { lotNumber: 'L1', description: 'lot1', estimatedAmount: amount },
        ],
      })
      .expect(201);
    const tenderId = (tender.body as TenderBody).id;
    const lotId = (tender.body as TenderBody).lots[0].id;
    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tenderId}/publish`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const supplier = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: `[E2E] Transparency Supplier ${Math.random()}`,
        registrationNumber: `E2E-TRANSPARENCY-SUP-${Date.now()}-${Math.random()}`,
      })
      .expect(201);
    const supplierId = (supplier.body as IdBody).id;

    const bid = await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lotId}/bids`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ supplierId, amount })
      .expect(201);
    const bidId = (bid.body as IdBody).id;

    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tenderId}/close`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/bids/${bidId}/evaluate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ technicalScore: 90, financialScore: 85 })
      .expect(201);
    const award = await request(app.getHttpServer())
      .post(`/api/v1/bids/${bidId}/award`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    return { tenderId, lotId, awardId: (award.body as IdBody).id };
  }

  /** Drives Award -> ACTIVE Contract -> PLANNED Project with one milestone. */
  async function createProjectWithMilestone(): Promise<{
    projectId: string;
    contractId: string;
  }> {
    const { awardId } = await createAwardedTender();
    const contract = await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        awardId,
        contractNumber: `E2E-TRANSPARENCY-CTR-${Date.now()}-${Math.random()}`,
        title: 'E2E Contract',
        value: 900_000,
        startDate: '2027-10-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const contractId = (contract.body as ContractBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/activate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        contractId,
        name: 'E2E Transparency Rural Road',
        description: '20km gravel road upgrade',
        location: 'Kericho County',
        startDate: '2026-09-01',
        plannedEndDate: '2027-03-01',
      })
      .expect(201);
    const projectId = (project.body as ProjectBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/milestones`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        sequenceNumber: 1,
        title: 'Earthworks',
        description: 'Grading and drainage',
        plannedAmount: 100_000,
        plannedDate: '2026-11-01',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/activate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    return { projectId, contractId };
  }

  it('reaches every /public/* route with no Authorization header at all', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/public/projects')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/public/tenders')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/public/suppliers')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/public/budgets')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/public/verify')
      .query({ hash: 'a'.repeat(64) })
      .expect(200);
  });

  it('lists public projects with no internal fields, and the detail view exposes milestones and evidence with no actor identity', async () => {
    const { projectId } = await createProjectWithMilestone();

    const list = await request(app.getHttpServer())
      .get('/api/v1/public/projects')
      .query({ search: 'E2E Transparency Rural Road' })
      .expect(200);
    const listBody = list.body as PublicList<Record<string, unknown>>;
    const match = listBody.items.find((p) => p.id === projectId);
    expect(match).toBeDefined();
    expect(match).not.toHaveProperty('createdById');
    expect(match).not.toHaveProperty('contractId');

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/public/projects/${projectId}`)
      .expect(200);
    const detailBody = detail.body as PublicProjectDetail;
    expect(detailBody.milestones).toHaveLength(1);
    expect(detailBody.milestones[0]).not.toHaveProperty('id');
    expect(detailBody.evidence).toEqual([]);
  });

  it('excludes DRAFT tenders from both the public list and detail view', async () => {
    const { tenderId } = await createAwardedTender();
    // Flip a genuinely awarded tender back to DRAFT directly in the
    // database to prove the filter, the same "simulate a state directly"
    // technique audit.e2e-spec.ts already uses for tamper testing —
    // restored in `finally` since this row's award/contract/project chain
    // is built on top of it and should be left internally consistent.
    await prisma.tender.update({
      where: { id: tenderId },
      data: { status: 'DRAFT' },
    });

    try {
      const list = await request(app.getHttpServer())
        .get('/api/v1/public/tenders')
        .query({ take: 200 })
        .expect(200);
      const listBody = list.body as PublicList<{ id: string }>;
      expect(listBody.items.some((t) => t.id === tenderId)).toBe(false);

      await request(app.getHttpServer())
        .get(`/api/v1/public/tenders/${tenderId}`)
        .expect(404);
    } finally {
      await prisma.tender.update({
        where: { id: tenderId },
        data: { status: 'AWARDED' },
      });
    }
  });

  it("shows a tender's winning award (supplier name and amount) once awarded, with no losing-bid detail", async () => {
    const { tenderId } = await createAwardedTender(500_000);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/public/tenders/${tenderId}`)
      .expect(200);
    const body = detail.body as PublicTenderDetail;
    expect(body.status).toBe('AWARDED');
    expect(body.lots).toHaveLength(1);
    expect(body.lots[0].award).not.toBeNull();
    expect(body.lots[0].award?.awardedAmount).toBe('500000');
    expect(body.lots[0].award?.supplierName).toEqual(expect.any(String));
  });

  it("exposes only a supplier's public-safe fields, correctly reflecting status", async () => {
    const supplier = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: `[E2E] Transparency Privacy Supplier ${Math.random()}`,
        registrationNumber: `E2E-TRANSPARENCY-PRIV-${Date.now()}`,
        email: 'sensitive-contact@example.com',
        phone: '+254700000000',
      })
      .expect(201);
    const supplierId = (supplier.body as IdBody).id;
    // taxIdentifier/contactPersonName/physicalAddress have no create-time
    // API surface at all yet — set directly to still exercise the public
    // DTO's exclusion of them (real defense in depth: even if a future
    // phase adds a way to set these via the API, this test still catches
    // them leaking into the public response).
    await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        taxIdentifier: 'SECRET-TAX-ID',
        contactPersonName: 'A Real Person',
        physicalAddress: '123 Sensitive Street',
      },
    });
    await request(app.getHttpServer())
      .post(`/api/v1/suppliers/${supplierId}/suspend`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/public/suppliers/${supplierId}`)
      .expect(200);
    const body = detail.body as PublicSupplier & Record<string, unknown>;
    expect(body.status).toBe('SUSPENDED');
    expect(body).not.toHaveProperty('email');
    expect(body).not.toHaveProperty('phone');
    expect(body).not.toHaveProperty('taxIdentifier');
    expect(body).not.toHaveProperty('contactPersonName');
    expect(body).not.toHaveProperty('physicalAddress');
  });

  it('lists an approved allocation as public budget data, scoped to the fixture organization', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/public/budgets')
      .query({ organizationId: orgId })
      .expect(200);
    const body = list.body as PublicList<{
      voteCode: string;
      authorizedAmount: string;
    }>;
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.some((line) => line.voteCode === 'V01')).toBe(true);
  });

  it('verifies a real evidence hash publicly — found, anchored, chain intact, with no uploader identity exposed', async () => {
    const { projectId } = await createProjectWithMilestone();
    const contentBase64 = Buffer.from(
      `[E2E] transparency portal verification content ${Date.now()}`,
      'utf8',
    ).toString('base64');

    const upload = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/evidence`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        fileName: 'e2e-transparency-evidence.txt',
        mimeType: 'text/plain',
        fileContentBase64: contentBase64,
      })
      .expect(201);
    const fileHash = (upload.body as EvidenceBody).fileHash;

    const verify = await request(app.getHttpServer())
      .get('/api/v1/public/verify')
      .query({ hash: fileHash })
      .expect(200);
    const body = verify.body as PublicHashVerification &
      Record<string, unknown>;
    expect(body.found).toBe(true);
    expect(body.projectName).toEqual(expect.any(String));
    expect(body.anchored).toBe(true);
    expect(body.chainIntact).toBe(true);
    expect(body).not.toHaveProperty('uploadedById');
    expect(body).not.toHaveProperty('storageKey');
  });

  it('reports found:false for a well-formed but unknown hash, and 400 for a malformed one', async () => {
    const notFound = await request(app.getHttpServer())
      .get('/api/v1/public/verify')
      .query({ hash: 'f'.repeat(64) })
      .expect(200);
    expect((notFound.body as PublicHashVerification).found).toBe(false);

    await request(app.getHttpServer())
      .get('/api/v1/public/verify')
      .query({ hash: 'not-a-valid-hash' })
      .expect(400);

    await request(app.getHttpServer()).get('/api/v1/public/verify').expect(400);
  });

  it(
    'detects tampering with the underlying audit event through the public verification ' +
      'endpoint, without exposing the tampered payload itself',
    async () => {
      const { projectId } = await createProjectWithMilestone();
      const contentBase64 = Buffer.from(
        `[E2E] transparency tamper-detection content ${Date.now()}`,
        'utf8',
      ).toString('base64');
      const upload = await request(app.getHttpServer())
        .post(`/api/v1/projects/${projectId}/evidence`)
        .set('Authorization', `Bearer ${fullToken}`)
        .send({
          fileName: 'e2e-transparency-tamper.txt',
          mimeType: 'text/plain',
          fileContentBase64: contentBase64,
        })
        .expect(201);
      const fileHash = (upload.body as EvidenceBody).fileHash;

      const evidence = await prisma.projectEvidence.findFirst({
        where: { fileHash },
      });
      expect(evidence).not.toBeNull();
      const auditEvent = await prisma.auditEvent.findFirst({
        where: {
          resourceType: 'ProjectEvidence',
          resourceId: evidence!.id,
          eventType: 'EVIDENCE_UPLOADED',
        },
      });
      expect(auditEvent).not.toBeNull();
      const originalPayload = JSON.stringify(auditEvent!.payload);

      await prisma.$executeRaw`UPDATE audit_events SET payload = '{"tampered": true}'::jsonb WHERE id = ${auditEvent!.id}`;

      try {
        const verify = await request(app.getHttpServer())
          .get('/api/v1/public/verify')
          .query({ hash: fileHash })
          .expect(200);
        const body = verify.body as PublicHashVerification;
        expect(body.found).toBe(true);
        expect(body.chainIntact).toBe(false);
      } finally {
        await prisma.$executeRaw`UPDATE audit_events SET payload = ${originalPayload}::jsonb WHERE id = ${auditEvent!.id}`;
      }

      const restored = await request(app.getHttpServer())
        .get('/api/v1/public/verify')
        .query({ hash: fileHash })
        .expect(200);
      expect((restored.body as PublicHashVerification).chainIntact).toBe(true);
    },
  );
});
