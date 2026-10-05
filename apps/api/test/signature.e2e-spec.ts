import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { generateEd25519KeyPair, signEd25519 } from '@bpfmps/crypto';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { signRequest } from './helpers/signing';

interface LoginResponseBody {
  accessToken: string;
}
interface IdBody {
  id: string;
}
interface SigningKeyStatusBody {
  enrolled: boolean;
  keyId?: string;
}
interface BudgetBody {
  id: string;
  status: string;
}
interface AuditEventBody {
  id: string;
  eventType: string;
  actorSignature: string | null;
  actorKeyId: string | null;
}
interface VerifyEventBody {
  checks: {
    actorSignatureValid: boolean | null;
  };
  verified: boolean;
}

/**
 * Per-official digital signatures (section 6) — the DigitalIdentity /
 * SignatureGuard / @RequireSignature() mechanism, exercised end-to-end via
 * its first real wiring: POST /budgets/:id/approve. Covers enrollment,
 * rejection of missing/invalid/expired/replayed signatures, that the audit
 * trail genuinely records and later re-verifies the actor's own signature
 * (distinct from the system chain signature), and that a rotated-out key's
 * PAST signatures remain valid even though it can no longer sign anything
 * new.
 */
describe('Digital Signatures (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const actorEmail = 'e2e-signature-actor@test.bpfmps.local';
  // Gap-audit fix (F-003): approve() now rejects an actor approving a
  // budget they themselves created. This whole file is about the SIGNATURE
  // mechanism on the approve route, not the self-approval guard, so budgets
  // are created/submitted by a separate identity — `actorToken` (the one
  // enrolling/rotating signing keys and signing every approve request
  // under test) never creates what it approves.
  const creatorEmail = 'e2e-signature-creator@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let actorUserId: string;
  let creatorUserId: string;
  let actorToken: string;
  let creatorToken: string;
  let orgId: string;
  let roleId: string;
  let fiscalYearId: string;

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
      where: { code: 'E2E-SIGNATURE-ORG' },
      create: {
        code: 'E2E-SIGNATURE-ORG',
        name: '[E2E] Signature Test Ministry',
        type: 'MINISTRY',
      },
      update: {},
    });
    orgId = org.id;

    const role = await prisma.role.upsert({
      where: { name: '[E2E] Signature Full Access' },
      create: { name: '[E2E] Signature Full Access' },
      update: {},
    });
    roleId = role.id;
    for (const [resource, action] of [
      ['budget', 'manage'],
      ['budget', 'create'],
      ['budget', 'read'],
      ['budget', 'approve'],
      ['audit', 'read'],
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
    const actor = await prisma.user.upsert({
      where: { email: actorEmail },
      create: {
        email: actorEmail,
        firstName: '[E2E]',
        lastName: 'SignatureActor',
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
    actorUserId = actor.id;

    const creator = await prisma.user.upsert({
      where: { email: creatorEmail },
      create: {
        email: creatorEmail,
        firstName: '[E2E]',
        lastName: 'SignatureCreator',
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
    creatorUserId = creator.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: actorEmail, password })
      .expect(200);
    actorToken = (login.body as LoginResponseBody).accessToken;

    const creatorLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: creatorEmail, password })
      .expect(200);
    creatorToken = (creatorLogin.body as LoginResponseBody).accessToken;

    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${actorToken}`)
      .send({
        name: `E2E-SIG-FY-${Date.now()}`,
        startDate: '2027-07-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    fiscalYearId = (fy.body as IdBody).id;
  });

  afterAll(async () => {
    const userIds = [actorUserId, creatorUserId];
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.signatureNonce.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.digitalIdentity.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({ where: { roleId } });
    await prisma.role.delete({ where: { id: roleId } });
    await app.close();
  });

  async function createSubmittedBudget(): Promise<string> {
    const budget = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${creatorToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: `E2E Signature Budget ${Date.now()}-${Math.random()}`,
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Fixture line',
            authorizedAmount: 1000,
          },
        ],
      })
      .expect(201);
    const budgetId = (budget.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/submit`)
      .set('Authorization', `Bearer ${creatorToken}`)
      .expect(200);
    return budgetId;
  }

  it('reports not enrolled before any key is uploaded', async () => {
    const status = await request(app.getHttpServer())
      .get('/api/v1/users/me/signing-key')
      .set('Authorization', `Bearer ${actorToken}`)
      .expect(200);
    expect((status.body as SigningKeyStatusBody).enrolled).toBe(false);
  });

  it('rejects a malformed public key', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/users/me/signing-key')
      .set('Authorization', `Bearer ${actorToken}`)
      .send({ publicKeyPem: 'not-a-real-key' })
      .expect(400);
  });

  it('rejects approval with no signature fields at all', async () => {
    const budgetId = await createSubmittedBudget();
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/approve`)
      .set('Authorization', `Bearer ${actorToken}`)
      .expect(400);
  });

  it('rejects approval when the actor has not enrolled a signing key yet', async () => {
    const budgetId = await createSubmittedBudget();
    const unenrolledKeyPair = generateEd25519KeyPair();
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/approve`)
      .set('Authorization', `Bearer ${actorToken}`)
      .send(
        signRequest(
          'POST',
          `/api/v1/budgets/${budgetId}/approve`,
          unenrolledKeyPair.privateKeyPem,
        ),
      )
      .expect(403);
  });

  describe('once a key is enrolled', () => {
    let keyPair: ReturnType<typeof generateEd25519KeyPair>;
    let enrolledKeyId: string;

    beforeAll(async () => {
      keyPair = generateEd25519KeyPair();
      const response = await request(app.getHttpServer())
        .post('/api/v1/users/me/signing-key')
        .set('Authorization', `Bearer ${actorToken}`)
        .send({ publicKeyPem: keyPair.publicKeyPem })
        .expect(201);
      enrolledKeyId = (response.body as { keyId: string }).keyId;
    });

    it('reports enrolled with the matching keyId', async () => {
      const status = await request(app.getHttpServer())
        .get('/api/v1/users/me/signing-key')
        .set('Authorization', `Bearer ${actorToken}`)
        .expect(200);
      const body = status.body as SigningKeyStatusBody;
      expect(body.enrolled).toBe(true);
      expect(body.keyId).toBe(enrolledKeyId);
    });

    it('rejects a signature made with the wrong private key', async () => {
      const budgetId = await createSubmittedBudget();
      const wrongKeyPair = generateEd25519KeyPair();
      await request(app.getHttpServer())
        .post(`/api/v1/budgets/${budgetId}/approve`)
        .set('Authorization', `Bearer ${actorToken}`)
        .send(
          signRequest(
            'POST',
            `/api/v1/budgets/${budgetId}/approve`,
            wrongKeyPair.privateKeyPem,
          ),
        )
        .expect(403);
    });

    it('rejects a signature timestamped outside the 5-minute window', async () => {
      const budgetId = await createSubmittedBudget();
      const staleFields = signRequest(
        'POST',
        `/api/v1/budgets/${budgetId}/approve`,
        keyPair.privateKeyPem,
      );
      // Re-sign with a timestamp from 10 minutes ago, using the exact same
      // (now stale) timestamp in the canonical payload so the signature
      // itself is valid — only the freshness check should fail.
      const staleTimestamp = new Date(Date.now() - 10 * 60_000).toISOString();
      const path = `/api/v1/budgets/${budgetId}/approve`;
      const canonical = `POST ${path} ${staleTimestamp} ${staleFields.signatureNonce}`;
      const staleSignature = signEd25519(canonical, keyPair.privateKeyPem);

      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${actorToken}`)
        .send({
          signature: staleSignature,
          signatureTimestamp: staleTimestamp,
          signatureNonce: staleFields.signatureNonce,
        })
        .expect(400);
    });

    it('accepts a genuine signature and records it on the audit trail, re-verifiable via /verify', async () => {
      const budgetId = await createSubmittedBudget();
      const path = `/api/v1/budgets/${budgetId}/approve`;

      const approveResponse = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${actorToken}`)
        .send(signRequest('POST', path, keyPair.privateKeyPem))
        .expect(200);
      expect((approveResponse.body as BudgetBody).status).toBe('APPROVED');

      const events = await request(app.getHttpServer())
        .get('/api/v1/audit/events')
        .query({ eventType: 'BUDGET_APPROVED', resourceId: budgetId })
        .set('Authorization', `Bearer ${actorToken}`)
        .expect(200);
      const items = (events.body as { items: AuditEventBody[] }).items;
      const approvedEvent = items.find(
        (e) => e.eventType === 'BUDGET_APPROVED',
      );
      expect(approvedEvent).toBeDefined();
      expect(approvedEvent!.actorSignature).toEqual(expect.any(String));
      expect(approvedEvent!.actorKeyId).toBe(enrolledKeyId);

      const verify = await request(app.getHttpServer())
        .get(`/api/v1/audit/events/${approvedEvent!.id}/verify`)
        .set('Authorization', `Bearer ${actorToken}`)
        .expect(200);
      const verifyBody = verify.body as VerifyEventBody;
      expect(verifyBody.checks.actorSignatureValid).toBe(true);
      expect(verifyBody.verified).toBe(true);
    });

    it('rejects replay of an already-used signature/nonce, even against the same still-approved budget', async () => {
      const budgetId = await createSubmittedBudget();
      const path = `/api/v1/budgets/${budgetId}/approve`;
      const fields = signRequest('POST', path, keyPair.privateKeyPem);

      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${actorToken}`)
        .send(fields)
        .expect(200);

      // Same signature/timestamp/nonce triple, replayed. The guard must
      // catch this as a replay (403) rather than letting it reach the
      // service, which would otherwise return 400 "already approved" —
      // that would be the WRONG reason, masking a real replay.
      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${actorToken}`)
        .send(fields)
        .expect(403);
    });

    it('rotating keys revokes the old key for NEW signatures but never invalidates its PAST ones', async () => {
      // Sign and approve with the original key first, while it's still active.
      const budgetId = await createSubmittedBudget();
      const path = `/api/v1/budgets/${budgetId}/approve`;
      const approveResponse = await request(app.getHttpServer())
        .post(path)
        .set('Authorization', `Bearer ${actorToken}`)
        .send(signRequest('POST', path, keyPair.privateKeyPem))
        .expect(200);
      void approveResponse;

      const events = await request(app.getHttpServer())
        .get('/api/v1/audit/events')
        .query({ eventType: 'BUDGET_APPROVED', resourceId: budgetId })
        .set('Authorization', `Bearer ${actorToken}`)
        .expect(200);
      const priorEventId = (events.body as { items: AuditEventBody[] }).items[0]
        .id;

      // Rotate to a brand-new key.
      const rotatedKeyPair = generateEd25519KeyPair();
      await request(app.getHttpServer())
        .post('/api/v1/users/me/signing-key')
        .set('Authorization', `Bearer ${actorToken}`)
        .send({ publicKeyPem: rotatedKeyPair.publicKeyPem })
        .expect(201);

      // The OLD key can no longer sign anything new.
      const newBudgetId = await createSubmittedBudget();
      const newPath = `/api/v1/budgets/${newBudgetId}/approve`;
      await request(app.getHttpServer())
        .post(newPath)
        .set('Authorization', `Bearer ${actorToken}`)
        .send(signRequest('POST', newPath, keyPair.privateKeyPem))
        .expect(403);

      // ...but the NEW key works immediately.
      await request(app.getHttpServer())
        .post(newPath)
        .set('Authorization', `Bearer ${actorToken}`)
        .send(signRequest('POST', newPath, rotatedKeyPair.privateKeyPem))
        .expect(200);

      // And the signature made with the OLD (now revoked) key, from BEFORE
      // rotation, must still verify as valid — revocation is not
      // retroactive.
      const verify = await request(app.getHttpServer())
        .get(`/api/v1/audit/events/${priorEventId}/verify`)
        .set('Authorization', `Bearer ${actorToken}`)
        .expect(200);
      expect((verify.body as VerifyEventBody).checks.actorSignatureValid).toBe(
        true,
      );
    });
  });
});
