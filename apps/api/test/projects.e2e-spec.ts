import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createHash } from 'node:crypto';
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
interface ContractBody {
  id: string;
  status: string;
  organizationId: string;
}
interface ProjectBody {
  id: string;
  status: string;
  organizationId: string;
  actualEndDate: string | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
}
interface MilestoneBody {
  id: string;
  status: string;
  sequenceNumber: number;
}
interface EvidenceBody {
  id: string;
  fileHash: string;
  fileSizeBytes: number;
  blockchainTxRef: string | null;
  latitude: number | null;
  longitude: number | null;
  gpsAccuracyMeters: number | null;
  capturedAt: string | null;
}
interface RiskAlertBody {
  id: string;
  detectorType: string;
  severity: string;
  resourceType: string;
  resourceId: string;
}
interface EvidenceDownloadBody {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  hashVerified: boolean;
}

/**
 * Exercises Phase 10 (Project Verification): the Contract -> Project ->
 * Milestone -> Inspection lifecycle (including the FAILED/NEEDS_REVISION
 * rework path and auto-completion once every milestone reaches VERIFIED),
 * organizationId derived server-side from the Contract rather than accepted
 * as client input, the Project Manager (project:manage) vs Engineer
 * (project:inspect) separation of duties, and the evidence vault — real
 * encrypted storage, a real SHA-256 cross-check against node:crypto, and
 * hash verification on download.
 */
describe('Project Verification (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const fullEmail = 'e2e-projects-full@test.bpfmps.local';
  const approverEmail = 'e2e-projects-approver@test.bpfmps.local';
  const pmEmail = 'e2e-projects-pm@test.bpfmps.local';
  const engEmail = 'e2e-projects-eng@test.bpfmps.local';
  const noPermEmail = 'e2e-projects-noperm@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let fullUserId: string;
  let approverUserId: string;
  let pmUserId: string;
  let engUserId: string;
  let noPermUserId: string;
  let fullToken: string;
  let fullPrivateKeyPem: string;
  // Gap-audit fix (F-003): budget/procurement-request approval now rejects
  // self-approval, so fixture setup needs a distinct approver identity from
  // whoever created the budget/request — fullToken can no longer do both.
  let approverToken: string;
  let pmToken: string;
  let engToken: string;
  let noPermToken: string;
  let orgId: string;
  let fullRoleId: string;
  let approverRoleId: string;
  let pmRoleId: string;
  let engRoleId: string;
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
      where: { code: 'E2E-PROJECTS-ORG' },
      create: {
        code: 'E2E-PROJECTS-ORG',
        name: '[E2E] Projects Test Ministry',
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

    // Enough of the upstream chain (budget -> procurement -> award ->
    // contract) to reach an ACTIVE Contract, plus full project:* so fixture
    // setup itself never depends on the two role-scoped test users below.
    fullRoleId = await grantRole('[E2E] Projects Full Access', [
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
      ['project', 'inspect'],
      ['evidence', 'upload'],
      ['risk', 'read'],
    ]);

    approverRoleId = await grantRole('[E2E] Projects Approver', [
      ['budget', 'approve'],
      ['budget', 'read'],
      ['procurement', 'approve'],
      ['procurement', 'read'],
    ]);

    pmRoleId = await grantRole('[E2E] Projects Manager', [
      ['project', 'read'],
      ['project', 'manage'],
      ['evidence', 'upload'],
    ]);

    engRoleId = await grantRole('[E2E] Projects Engineer', [
      ['project', 'read'],
      ['project', 'inspect'],
      ['evidence', 'upload'],
    ]);

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    async function upsertUser(email: string, lastName: string, roleId: string) {
      const user = await prisma.user.upsert({
        where: { email },
        create: {
          email,
          firstName: '[E2E]',
          lastName,
          passwordHash,
          status: 'ACTIVE',
          organizationId: orgId,
          roles: { create: { roleId } },
        },
        update: {
          passwordHash,
          status: 'ACTIVE',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      return user.id;
    }

    fullUserId = await upsertUser(fullEmail, 'ProjectsFull', fullRoleId);
    approverUserId = await upsertUser(
      approverEmail,
      'ProjectsApprover',
      approverRoleId,
    );
    pmUserId = await upsertUser(pmEmail, 'ProjectsPM', pmRoleId);
    engUserId = await upsertUser(engEmail, 'ProjectsEngineer', engRoleId);

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

    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return (res.body as LoginResponseBody).accessToken;
    }

    fullToken = await login(fullEmail);
    approverToken = await login(approverEmail);
    pmToken = await login(pmEmail);
    engToken = await login(engEmail);
    noPermToken = await login(noPermEmail);

    const fullKeyPair = generateEd25519KeyPair();
    fullPrivateKeyPem = fullKeyPair.privateKeyPem;
    await request(app.getHttpServer())
      .post('/api/v1/users/me/signing-key')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ publicKeyPem: fullKeyPair.publicKeyPem })
      .expect(201);

    // budget:approve is @RequireSignature() — the approver needs their own
    // enrolled key too.
    const approverKeyPair = generateEd25519KeyPair();
    const approverPrivateKeyPem = approverKeyPair.privateKeyPem;
    await request(app.getHttpServer())
      .post('/api/v1/users/me/signing-key')
      .set('Authorization', `Bearer ${approverToken}`)
      .send({ publicKeyPem: approverKeyPair.publicKeyPem })
      .expect(201);

    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: `E2E-PROJECTS-FY-${Date.now()}`,
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
        name: 'E2E Projects Fixture Budget',
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
      .set('Authorization', `Bearer ${approverToken}`)
      .send(
        signRequest(
          'POST',
          `/api/v1/budgets/${budgetId}/approve`,
          approverPrivateKeyPem,
        ),
      )
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
        name: `E2E Projects Plan ${Date.now()}`,
      })
      .expect(201);
    planId = (plan.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-plans/${planId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
  });

  afterAll(async () => {
    const userIds = [
      fullUserId,
      approverUserId,
      pmUserId,
      engUserId,
      noPermUserId,
    ];
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: {
        roleId: { in: [fullRoleId, approverRoleId, pmRoleId, engRoleId] },
      },
    });
    await prisma.role.deleteMany({
      where: { id: { in: [fullRoleId, approverRoleId, pmRoleId, engRoleId] } },
    });
    await app.close();
  });

  /** Drives a full plan -> ... -> award chain and returns the resulting awardId. */
  async function createAward(amount = 900_000): Promise<string> {
    const reqResponse = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: orgId,
        allocationId,
        title: `E2E projects request ${Date.now()}-${Math.random()}`,
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
      .set('Authorization', `Bearer ${approverToken}`)
      .expect(200);

    const tender = await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/tenders`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        title: `E2E projects tender ${Date.now()}`,
        description: 'desc',
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
        name: `[E2E] Projects Supplier ${Math.random()}`,
        registrationNumber: `E2E-PROJECTS-SUP-${Date.now()}-${Math.random()}`,
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
    return (award.body as IdBody).id;
  }

  /** Drives Award -> ACTIVE Contract, returning the contract id. */
  async function createActiveContract(amount = 900_000): Promise<string> {
    const awardId = await createAward(amount);
    const contract = await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        awardId,
        contractNumber: `E2E-PROJ-CTR-${Date.now()}-${Math.random()}`,
        title: 'E2E Contract',
        value: amount,
        startDate: '2027-10-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const contractId = (contract.body as ContractBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/activate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    return contractId;
  }

  /**
   * Creates a Project (as the PM) against a fresh ACTIVE contract, left in
   * PLANNED status — milestones must be added (see `addMilestone`) BEFORE
   * `activateProject` is called, since MilestonesService.create() only
   * allows adding milestones to a PLANNED project (the milestone list is
   * frozen at activation — see the comment on that guard).
   */
  async function createPlannedProject(siteCoords?: {
    siteLatitude: number;
    siteLongitude: number;
  }): Promise<{
    projectId: string;
    contractId: string;
    organizationId: string;
  }> {
    const contractId = await createActiveContract();
    const project = await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        contractId,
        name: 'E2E Rural Road Rehabilitation',
        description: '20km gravel road upgrade',
        location: 'Kericho County',
        ...siteCoords,
        startDate: '2026-09-01',
        plannedEndDate: '2027-03-01',
      })
      .expect(201);
    const body = project.body as ProjectBody;
    return {
      projectId: body.id,
      contractId,
      organizationId: body.organizationId,
    };
  }

  async function activateProject(projectId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/activate`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
  }

  async function addMilestone(
    projectId: string,
    sequenceNumber: number,
  ): Promise<string> {
    const milestone = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/milestones`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        sequenceNumber,
        title: `Phase ${sequenceNumber}`,
        description: `Work package ${sequenceNumber}`,
        plannedAmount: 100_000,
        plannedDate: '2027-01-01',
      })
      .expect(201);
    return (milestone.body as MilestoneBody).id;
  }

  /** Drives an already-created, PENDING milestone through start -> complete -> a PASSED inspection. */
  async function verifyMilestone(milestoneId: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/start`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/complete`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/inspections`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({ outcome: 'PASSED', findings: '[E2E] compliant' })
      .expect(201);
  }

  /** Creates an activated project with one already-VERIFIED milestone, returning both ids. */
  async function createActiveProjectWithVerifiedMilestone(): Promise<{
    projectId: string;
    milestoneId: string;
  }> {
    const { projectId } = await createPlannedProject();
    const milestoneId = await addMilestone(projectId, 1);
    await activateProject(projectId);
    await verifyMilestone(milestoneId);
    return { projectId, milestoneId };
  }

  it('rejects project access without project:read', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
  });

  it('derives organizationId server-side from the Contract, not from client input', async () => {
    const contractId = await createActiveContract(500_000);
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        contractId,
        // A malicious/incorrect organizationId in the request body must be
        // ignored entirely — CreateProjectDto doesn't even accept the
        // field (forbidNonWhitelisted), but the deeper guarantee is that
        // ProjectsService.create() never reads it from the DTO at all.
        organizationId: 'not-a-real-org-id',
        name: 'E2E derivation check',
        description: 'desc',
        startDate: '2026-09-01',
        plannedEndDate: '2027-03-01',
      })
      .expect(400); // forbidNonWhitelisted rejects the unknown field outright
  });

  it('requires the Contract to be ACTIVE before a project can be raised against it', async () => {
    const awardId = await createAward(200_000);
    const draftContract = await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        awardId,
        contractNumber: `E2E-DRAFT-CTR-${Date.now()}`,
        title: 'Still draft',
        value: 200_000,
        startDate: '2027-10-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const contractId = (draftContract.body as ContractBody).id;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        contractId,
        name: 'Too early',
        description: 'desc',
        startDate: '2026-09-01',
        plannedEndDate: '2027-03-01',
      })
      .expect(400);
  });

  it('rejects a second project against a contract that already has one', async () => {
    const { contractId } = await createPlannedProject();
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        contractId,
        name: 'Duplicate project',
        description: 'desc',
        startDate: '2026-09-01',
        plannedEndDate: '2027-03-01',
      })
      .expect(409);
  });

  it('an Engineer cannot create or manage a project (project:manage withheld)', async () => {
    const contractId = await createActiveContract(210_000);
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        contractId,
        name: 'x',
        description: 'x',
        startDate: '2026-09-01',
        plannedEndDate: '2027-03-01',
      })
      .expect(403);
  });

  it('rejects a duplicate milestone sequenceNumber within the same project', async () => {
    const { projectId } = await createPlannedProject();
    await addMilestone(projectId, 1);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/milestones`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        sequenceNumber: 1,
        title: 'Duplicate sequence',
        description: 'x',
        plannedAmount: 1,
        plannedDate: '2026-11-01',
      })
      .expect(409);
  });

  it('rejects adding a milestone once the project has been activated (the list is frozen)', async () => {
    const { projectId } = await createPlannedProject();
    await addMilestone(projectId, 1);
    await activateProject(projectId);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/milestones`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        sequenceNumber: 2,
        title: 'Too late',
        description: 'x',
        plannedAmount: 1,
        plannedDate: '2026-11-01',
      })
      .expect(400);
  });

  it('rejects an inspection before the milestone is COMPLETED', async () => {
    const { projectId } = await createPlannedProject();
    const milestoneId = await addMilestone(projectId, 1);
    await activateProject(projectId);

    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/inspections`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({ outcome: 'PASSED', findings: 'too early' })
      .expect(400);
  });

  it('a Project Manager cannot record an inspection, and an Engineer cannot mark a milestone complete (separation of duties)', async () => {
    const { projectId } = await createPlannedProject();
    const milestoneId = await addMilestone(projectId, 1);
    await activateProject(projectId);
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/start`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);

    // Engineer lacks project:manage.
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/complete`)
      .set('Authorization', `Bearer ${engToken}`)
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/complete`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);

    // PM lacks project:inspect.
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/inspections`)
      .set('Authorization', `Bearer ${pmToken}`)
      .send({ outcome: 'PASSED', findings: 'x' })
      .expect(403);
  });

  it('a FAILED/NEEDS_REVISION inspection sends the milestone back to IN_PROGRESS for rework, and a subsequent PASSED verifies it', async () => {
    const { projectId } = await createPlannedProject();
    const milestoneId = await addMilestone(projectId, 1);
    await activateProject(projectId);
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/start`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/complete`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);

    const failed = await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/inspections`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        outcome: 'FAILED',
        findings: '[E2E] Drainage slope insufficient, needs rework',
      })
      .expect(201);
    expect(failed.status).toBe(201);

    const afterFail = await request(app.getHttpServer())
      .get(`/api/v1/milestones/${milestoneId}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    expect((afterFail.body as MilestoneBody).status).toBe('IN_PROGRESS');

    // Rework and resubmit.
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/complete`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/milestones/${milestoneId}/inspections`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({ outcome: 'PASSED', findings: '[E2E] Rework verified' })
      .expect(201);

    const afterPass = await request(app.getHttpServer())
      .get(`/api/v1/milestones/${milestoneId}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    expect((afterPass.body as MilestoneBody).status).toBe('VERIFIED');
  });

  it('auto-completes the project once every milestone reaches VERIFIED, and not before', async () => {
    const { projectId } = await createPlannedProject();
    // Both milestones must be defined before activation — the whole point
    // of this test is to prove the auto-complete check isn't fooled by a
    // milestone list that could still grow (see the regression this guards
    // against: a project used to auto-complete after milestone 1 alone
    // reached VERIFIED, because milestone 2 hadn't been created yet at
    // that point and "every existing milestone is VERIFIED" was trivially
    // true).
    const milestone1Id = await addMilestone(projectId, 1);
    const milestone2Id = await addMilestone(projectId, 2);
    await activateProject(projectId);

    await verifyMilestone(milestone1Id);

    const midway = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    expect((midway.body as ProjectBody).status).toBe('IN_PROGRESS');

    await verifyMilestone(milestone2Id);

    const final = await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${pmToken}`)
      .expect(200);
    const body = final.body as ProjectBody;
    expect(body.status).toBe('COMPLETED');
    expect(body.actualEndDate).toBeTruthy();
  });

  it('uploads evidence with a real SHA-256 cross-check, stores it encrypted, anchors it, and verifies the hash on download', async () => {
    const { projectId } = await createPlannedProject();
    const contentBase64 = Buffer.from(
      '[E2E] genuine inspection photo bytes for the earthworks milestone',
      'utf8',
    ).toString('base64');
    const expectedHash = createHash('sha256')
      .update(Buffer.from(contentBase64, 'base64'))
      .digest('hex');

    const upload = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/evidence`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        fileName: 'earthworks-inspection.txt',
        mimeType: 'text/plain',
        fileContentBase64: contentBase64,
      })
      .expect(201);
    const evidence = upload.body as EvidenceBody;
    expect(evidence.fileHash).toBe(expectedHash);
    expect(evidence.blockchainTxRef).toBeTruthy();

    const download = await request(app.getHttpServer())
      .get(`/api/v1/evidence/${evidence.id}/download`)
      .set('Authorization', `Bearer ${engToken}`)
      .expect(200);
    const downloadBody = download.body as EvidenceDownloadBody;
    expect(downloadBody.hashVerified).toBe(true);
    expect(downloadBody.contentBase64).toBe(contentBase64);
  });

  // Gap-audit regression (path traversal): a client-supplied fileName is
  // sanitized before it's interpolated into the object-storage key. The
  // original name is preserved as metadata; only the storage key must be
  // free of traversal segments and stay inside this project's own prefix.
  it('neutralizes path-traversal sequences in a client fileName when building the storage key', async () => {
    const { projectId } = await createPlannedProject();

    const upload = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/evidence`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        fileName: '../../../other-project/secret.txt',
        mimeType: 'text/plain',
        fileContentBase64: Buffer.from('traversal probe').toString('base64'),
      })
      .expect(201);
    const evidenceId = (upload.body as EvidenceBody & { id: string }).id;

    const row = await prisma.projectEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
      select: { storageKey: true, fileName: true },
    });
    expect(row.fileName).toBe('../../../other-project/secret.txt');
    expect(row.storageKey.startsWith(`evidence/${projectId}/`)).toBe(true);
    expect(row.storageKey).not.toContain('..');
    expect(row.storageKey.slice(`evidence/${projectId}/`.length)).not.toContain(
      '/',
    );
  });

  it('rejects evidence upload without evidence:upload, and inspectionId must belong to the same project', async () => {
    const { projectId } = await createPlannedProject();

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/evidence`)
      .set('Authorization', `Bearer ${noPermToken}`)
      .send({
        fileName: 'x.txt',
        mimeType: 'text/plain',
        fileContentBase64: Buffer.from('x').toString('base64'),
      })
      .expect(403);

    // An inspection from a totally unrelated project.
    const { milestoneId: otherMilestoneId } =
      await createActiveProjectWithVerifiedMilestone();
    const inspections = await request(app.getHttpServer())
      .get(`/api/v1/milestones/${otherMilestoneId}/inspections`)
      .set('Authorization', `Bearer ${engToken}`)
      .expect(200);
    const otherInspectionId = (inspections.body as Array<{ id: string }>)[0].id;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/evidence`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        fileName: 'x.txt',
        mimeType: 'text/plain',
        fileContentBase64: Buffer.from('x').toString('base64'),
        inspectionId: otherInspectionId,
      })
      .expect(400);
  });

  it('stores GPS-tagged evidence and raises no alert when captured at the declared site', async () => {
    // Kericho town, Kenya — plausible coordinates for the fixture's own
    // "Kericho County" location string.
    const { projectId } = await createPlannedProject({
      siteLatitude: -0.3676,
      siteLongitude: 35.2861,
    });

    const upload = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/evidence`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        fileName: 'onsite-photo.jpg',
        mimeType: 'image/jpeg',
        fileContentBase64: Buffer.from('[E2E] onsite photo bytes').toString(
          'base64',
        ),
        latitude: -0.368,
        longitude: 35.2865,
        gpsAccuracyMeters: 12.5,
        capturedAt: '2026-09-15T09:30:00.000Z',
      })
      .expect(201);
    const evidence = upload.body as EvidenceBody;
    expect(evidence.latitude).toBeCloseTo(-0.368);
    expect(evidence.longitude).toBeCloseTo(35.2865);
    expect(evidence.gpsAccuracyMeters).toBeCloseTo(12.5);
    expect(evidence.capturedAt).toBe('2026-09-15T09:30:00.000Z');

    const alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({ resourceType: 'ProjectEvidence', resourceId: evidence.id })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect((alerts.body as RiskAlertBody[]).length).toBe(0);
  });

  it('raises an EVIDENCE_LOCATION_MISMATCH alert (never blocking the upload) when evidence GPS is far from the declared site', async () => {
    // Site declared in Kericho; evidence "captured" in Nairobi — roughly
    // 180km away, comfortably past the default 500m margin and its 10x
    // HIGH-severity escalation.
    const { projectId } = await createPlannedProject({
      siteLatitude: -0.3676,
      siteLongitude: 35.2861,
    });

    const upload = await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/evidence`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        fileName: 'suspicious-photo.jpg',
        mimeType: 'image/jpeg',
        fileContentBase64: Buffer.from(
          '[E2E] photo bytes from somewhere else entirely',
        ).toString('base64'),
        latitude: -1.2921,
        longitude: 36.8219,
      })
      .expect(201); // never blocked — a risk alert, not a rejection

    const evidence = upload.body as EvidenceBody;

    const alerts = await request(app.getHttpServer())
      .get('/api/v1/risk-alerts')
      .query({ resourceType: 'ProjectEvidence', resourceId: evidence.id })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    const alertList = alerts.body as RiskAlertBody[];
    expect(alertList).toHaveLength(1);
    expect(alertList[0].detectorType).toBe('EVIDENCE_LOCATION_MISMATCH');
    expect(alertList[0].severity).toBe('HIGH');
  });

  it('rejects evidence upload with latitude but no longitude (and vice versa)', async () => {
    const { projectId } = await createPlannedProject();

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${projectId}/evidence`)
      .set('Authorization', `Bearer ${engToken}`)
      .send({
        fileName: 'x.txt',
        mimeType: 'text/plain',
        fileContentBase64: Buffer.from('x').toString('base64'),
        latitude: -0.368,
      })
      .expect(400);
  });

  it('rejects creating a project with siteLatitude but no siteLongitude', async () => {
    const contractId = await createActiveContract();

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${pmToken}`)
      .send({
        contractId,
        name: 'E2E Bad Coords Project',
        description: 'should be rejected',
        siteLatitude: -0.3676,
        startDate: '2026-09-01',
        plannedEndDate: '2027-03-01',
      })
      .expect(400);
  });
});
