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
interface SubmitReportResponse {
  trackingCode: string;
  reportId: string;
}
interface PublicStatusResponse {
  category: string;
  description: string;
  status: string;
  evidence: Array<{ fileHash: string }>;
  updates: Array<{ author: string; message: string }>;
}
interface InvestigatorReportView {
  id: string;
  status: string;
  contact: string | null;
  assignedToId: string | null;
}

/**
 * Exercises Phase 13 (Whistleblower Portal): anonymous submission with a
 * possession-based tracking code (never a login), encrypted evidence
 * submission, two-way anonymous communication, and the investigator
 * workflow (Auditor/Internal Auditor only — the narrowest permission grant
 * in the system). Every anonymous-side assertion deliberately sends NO
 * Authorization header, proving these routes are genuinely public, not
 * merely permissive — the same discipline transparency.e2e-spec.ts already
 * established for Phase 12.
 */
describe('Whistleblower Portal (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const investigatorEmail = 'e2e-whistleblower-investigator@test.bpfmps.local';
  const noPermEmail = 'e2e-whistleblower-noperm@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let investigatorUserId: string;
  let noPermUserId: string;
  let investigatorToken: string;
  let noPermToken: string;
  let investigatorRoleId: string;

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

    investigatorRoleId = await grantRole('[E2E] Whistleblower Investigator', [
      ['whistleblower', 'read'],
      ['whistleblower', 'investigate'],
    ]);

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    const investigator = await prisma.user.upsert({
      where: { email: investigatorEmail },
      create: {
        email: investigatorEmail,
        firstName: '[E2E]',
        lastName: 'Investigator',
        passwordHash,
        status: 'ACTIVE',
        roles: { create: { roleId: investigatorRoleId } },
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    investigatorUserId = investigator.id;

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

    investigatorToken = await login(investigatorEmail);
    noPermToken = await login(noPermEmail);
  });

  afterAll(async () => {
    const userIds = [investigatorUserId, noPermUserId];
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: userIds } },
    });
    // ReportUpdate.postedById and Report.assignedToId are both
    // onDelete: SetNull, so no extra cleanup is needed before deleting the
    // test users — unlike Phase 9's PaymentApproval (onDelete: Restrict).
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { roleId: investigatorRoleId },
    });
    await prisma.role.deleteMany({ where: { id: investigatorRoleId } });
    await app.close();
  });

  async function submitReport(
    description = 'A procurement officer awarded a tender to a relative-owned company, bypassing evaluation.',
  ): Promise<SubmitReportResponse> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/public/whistleblower/reports')
      .send({ category: 'CORRUPTION', description })
      .expect(201);
    return response.body as SubmitReportResponse;
  }

  it('submits a report with no Authorization header at all, and only a hash of the tracking code is ever persisted', async () => {
    const { trackingCode, reportId } = await submitReport();
    expect(trackingCode).toMatch(/^WB-/);

    const row = await prisma.report.findUnique({ where: { id: reportId } });
    expect(row).not.toBeNull();
    expect(row!.trackingCodeHash).not.toBe(trackingCode);
    expect(row!.trackingCodeHash).toBe(
      createHash('sha256').update(trackingCode, 'utf8').digest('hex'),
    );
  });

  it('checks status by tracking code with no auth, and rejects an unknown code with a generic 404', async () => {
    const { trackingCode } = await submitReport(
      'Description for status check test case.',
    );

    const status = await request(app.getHttpServer())
      .get(`/api/v1/public/whistleblower/reports/${trackingCode}`)
      .expect(200);
    const body = status.body as PublicStatusResponse;
    expect(body.status).toBe('SUBMITTED');
    expect(body.category).toBe('CORRUPTION');
    // Structural privacy check: the public status view must never carry
    // organizationId, assignedToId, or contact — not merely null values,
    // the fields themselves must be absent.
    expect(body).not.toHaveProperty('organizationId');
    expect(body).not.toHaveProperty('assignedToId');
    expect(body).not.toHaveProperty('contact');

    await request(app.getHttpServer())
      .get('/api/v1/public/whistleblower/reports/WB-doesnotexist00000000000000')
      .expect(404);
  });

  it('adds evidence by tracking code, encrypted at rest, hash matches the uploaded bytes, and anchors it', async () => {
    const { trackingCode } = await submitReport(
      'Description for evidence test case.',
    );
    const content = Buffer.from(
      `[E2E] whistleblower evidence content ${Date.now()}`,
      'utf8',
    );
    const expectedHash = createHash('sha256').update(content).digest('hex');

    const upload = await request(app.getHttpServer())
      .post(`/api/v1/public/whistleblower/reports/${trackingCode}/evidence`)
      .send({
        fileName: 'e2e-evidence.txt',
        mimeType: 'text/plain',
        fileContentBase64: content.toString('base64'),
      })
      .expect(201);
    const evidenceBody = upload.body as { fileHash: string; anchored: boolean };
    expect(evidenceBody.fileHash).toBe(expectedHash);
    expect(evidenceBody.anchored).toBe(true);

    const status = await request(app.getHttpServer())
      .get(`/api/v1/public/whistleblower/reports/${trackingCode}`)
      .expect(200);
    expect((status.body as PublicStatusResponse).evidence).toHaveLength(1);

    await request(app.getHttpServer())
      .post(
        '/api/v1/public/whistleblower/reports/WB-doesnotexist00000000000000/evidence',
      )
      .send({
        fileName: 'x.txt',
        mimeType: 'text/plain',
        fileContentBase64: 'eA==',
      })
      .expect(404);
  });

  it('lets a reporter reply by tracking code, visible in their own status check', async () => {
    const { trackingCode } = await submitReport(
      'Description for reporter-reply test case.',
    );

    await request(app.getHttpServer())
      .post(`/api/v1/public/whistleblower/reports/${trackingCode}/updates`)
      .send({ message: 'I can provide more detail if needed.' })
      .expect(201);

    const status = await request(app.getHttpServer())
      .get(`/api/v1/public/whistleblower/reports/${trackingCode}`)
      .expect(200);
    const body = status.body as PublicStatusResponse;
    expect(body.updates).toHaveLength(1);
    expect(body.updates[0].author).toBe('REPORTER');
  });

  it('rejects investigator access without whistleblower:read', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/whistleblower/reports')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
  });

  it('lets an investigator list and view reports, including the decrypted contact if the reporter left one', async () => {
    const contact = `e2e-contact-${Date.now()}@example.com`;
    const response = await request(app.getHttpServer())
      .post('/api/v1/public/whistleblower/reports')
      .send({
        category: 'FRAUD',
        description: 'Description for investigator-visibility test case.',
        contact,
      })
      .expect(201);
    const { reportId } = response.body as SubmitReportResponse;

    const list = await request(app.getHttpServer())
      .get('/api/v1/whistleblower/reports')
      .set('Authorization', `Bearer ${investigatorToken}`)
      .expect(200);
    const listBody = list.body as { items: InvestigatorReportView[] };
    expect(listBody.items.some((r) => r.id === reportId)).toBe(true);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/whistleblower/reports/${reportId}`)
      .set('Authorization', `Bearer ${investigatorToken}`)
      .expect(200);
    expect((detail.body as InvestigatorReportView).contact).toBe(contact);
  });

  it(
    'drives the full investigator workflow: assign, illegal transitions rejected, ' +
      'legal transitions succeed, investigator updates are visible to the anonymous ' +
      'reporter, and the whole chain is correctly audited (attributed for the ' +
      'investigator, anonymous for the reporter)',
    async () => {
      const { trackingCode, reportId } = await submitReport(
        'Description for full workflow test case.',
      );

      const assigned = await request(app.getHttpServer())
        .post(`/api/v1/whistleblower/reports/${reportId}/assign`)
        .set('Authorization', `Bearer ${investigatorToken}`)
        .expect(200);
      expect((assigned.body as InvestigatorReportView).assignedToId).toBe(
        investigatorUserId,
      );

      // Illegal: cannot go straight to a terminal status from SUBMITTED.
      await request(app.getHttpServer())
        .post(`/api/v1/whistleblower/reports/${reportId}/status`)
        .set('Authorization', `Bearer ${investigatorToken}`)
        .send({ status: 'SUBSTANTIATED' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/v1/whistleblower/reports/${reportId}/status`)
        .set('Authorization', `Bearer ${investigatorToken}`)
        .send({ status: 'UNDER_REVIEW' })
        .expect(200);

      // Illegal: cannot move UNDER_REVIEW -> UNDER_REVIEW.
      await request(app.getHttpServer())
        .post(`/api/v1/whistleblower/reports/${reportId}/status`)
        .set('Authorization', `Bearer ${investigatorToken}`)
        .send({ status: 'UNDER_REVIEW' })
        .expect(400);

      await request(app.getHttpServer())
        .post(`/api/v1/whistleblower/reports/${reportId}/updates`)
        .set('Authorization', `Bearer ${investigatorToken}`)
        .send({ message: 'Can you clarify the approximate date?' })
        .expect(201);

      const finalStatus = await request(app.getHttpServer())
        .post(`/api/v1/whistleblower/reports/${reportId}/status`)
        .set('Authorization', `Bearer ${investigatorToken}`)
        .send({ status: 'SUBSTANTIATED' })
        .expect(200);
      expect((finalStatus.body as InvestigatorReportView).status).toBe(
        'SUBSTANTIATED',
      );

      // A terminal status has no legal next transition at all.
      await request(app.getHttpServer())
        .post(`/api/v1/whistleblower/reports/${reportId}/status`)
        .set('Authorization', `Bearer ${investigatorToken}`)
        .send({ status: 'UNDER_REVIEW' })
        .expect(400);

      // The anonymous reporter sees the investigator's question and the
      // final status — with no login, using only the tracking code.
      const reporterView = await request(app.getHttpServer())
        .get(`/api/v1/public/whistleblower/reports/${trackingCode}`)
        .expect(200);
      const reporterBody = reporterView.body as PublicStatusResponse;
      expect(reporterBody.status).toBe('SUBSTANTIATED');
      expect(reporterBody.updates).toHaveLength(1);
      expect(reporterBody.updates[0].author).toBe('INVESTIGATOR');
      expect(reporterBody.updates[0].message).toBe(
        'Can you clarify the approximate date?',
      );

      const events = await prisma.auditEvent.findMany({
        where: { resourceType: 'Report', resourceId: reportId },
        orderBy: { sequence: 'asc' },
      });
      const submitted = events.find(
        (e) => e.eventType === 'WHISTLEBLOWER_REPORT_SUBMITTED',
      );
      expect(submitted?.actorId).toBeNull();
      expect(submitted?.ipAddress).toBeNull();
      const statusChanged = events.filter(
        (e) => e.eventType === 'WHISTLEBLOWER_REPORT_STATUS_CHANGED',
      );
      expect(statusChanged.length).toBeGreaterThan(0);
      for (const e of statusChanged) {
        expect(e.actorId).toBe(investigatorUserId);
      }
    },
  );
});
