import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AnchoringService } from '../src/modules/blockchain/anchoring.service';

interface LoginResponseBody {
  accessToken: string;
}

interface AnchorRunResult {
  anchoredCount: number;
  transactionId?: string;
  blockId?: string;
}

interface AuditEventBody {
  id: string;
  blockchainTxRef: string | null;
}

interface VerifyEventBody {
  verified: boolean;
  blockchainAnchor: {
    anchored: boolean;
    found?: boolean;
    chainLinkValid?: boolean;
    transaction?: { id: string };
  };
}

interface TransactionVerifyBody {
  found: boolean;
  chainLinkValid?: boolean;
  block?: { id: string };
}

/**
 * Exercises the Phase 4 blockchain integrity layer end-to-end: that
 * anchoring actually rolls up real audit events, that the resulting
 * transaction/block verify as intact, that the audit+blockchain composed
 * verification (GET /audit/events/:id/verify) reflects it correctly, and —
 * the actual point of this layer — that direct SQL tampering with a block is
 * detected.
 */
describe('Blockchain (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let anchoringService: AnchoringService;

  const adminEmail = 'e2e-chain-admin@test.bpfmps.local';
  const noPermEmail = 'e2e-chain-noperm@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let adminUserId: string;
  let noPermUserId: string;
  let adminToken: string;
  let noPermToken: string;
  let testRoleId: string;

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
    anchoringService = app.get(AnchoringService);

    const role = await prisma.role.upsert({
      where: { name: '[E2E] Blockchain Full Access' },
      create: { name: '[E2E] Blockchain Full Access' },
      update: {},
    });
    testRoleId = role.id;
    for (const [resource, action] of [
      ['users', 'create'],
      ['audit', 'read'],
      ['blockchain', 'read'],
      ['blockchain', 'anchor'],
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
        lastName: 'ChainAdmin',
        passwordHash,
        status: 'ACTIVE',
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
    // audit_events and blockchain_anchors/transactions are append-only by
    // design — not deleted here, same rationale as audit.e2e-spec.ts.
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
    await prisma.rolePermission.deleteMany({
      where: { role: { name: '[E2E] Blockchain Full Access' } },
    });
    await prisma.role.deleteMany({
      where: { name: '[E2E] Blockchain Full Access' },
    });
    await app.close();
  });

  it('rejects blockchain access without blockchain:read', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/blockchain/health')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
  });

  it('reports a healthy adapter', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/blockchain/health')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((response.body as { healthy: boolean }).healthy).toBe(true);
  });

  it('anchors a real audit event and the composed verification reflects it', async () => {
    // A fixed email here (rather than a per-run unique one, as elsewhere in
    // this test suite) previously meant a single interrupted run could leave
    // an orphaned user row that permanently 409'd every future run — a real
    // bug found during Phase 7's stress-testing pass, not a Phase 4 issue.
    // See IMPLEMENTATION_PLAN.md Phase 7 "Notable engineering decisions".
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `e2e-chain-created-user-${Date.now()}@test.bpfmps.local`,
        firstName: 'Created',
        lastName: 'ByChainTest',
        temporaryPassword: 'TemporaryPassword123!',
        roleIds: [testRoleId],
      })
      .expect(201);
    const createdUserId = (createResponse.body as { id: string }).id;

    const events = await request(app.getHttpServer())
      .get('/api/v1/audit/events')
      .query({ eventType: 'USER_CREATED', actorId: adminUserId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const target = (events.body as { items: AuditEventBody[] }).items.find(
      (e) => e.blockchainTxRef === null,
    );
    expect(target).toBeDefined();

    const beforeVerify = await request(app.getHttpServer())
      .get(`/api/v1/audit/events/${target!.id}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(
      (beforeVerify.body as VerifyEventBody).blockchainAnchor.anchored,
    ).toBe(false);

    // POST /blockchain/anchor rolls up the globally oldest
    // BLOCKCHAIN_ANCHOR_BATCH_SIZE unanchored events, not specifically this
    // test's event — under this suite's full parallel run, several other
    // spec files are concurrently writing their own audit events to the
    // same table, so a single call is not guaranteed to reach this specific
    // target within one batch (a real, by-design batch-size limit, not a
    // bug: the same reasoning the "never re-anchors" test below already
    // applies to not asserting an exact global count). Repeating the call
    // until the target is anchored (or a small attempt budget is
    // exhausted) mirrors how the scheduled interval job actually catches up
    // a backlog in production, instead of assuming one call always
    // suffices — found via Phase 8's repeated full-suite stress-testing
    // pass, where this test failed intermittently once enough other spec
    // files' concurrent audit events were competing for the same batch.
    let anchored = false;
    for (let attempt = 0; attempt < 10 && !anchored; attempt++) {
      const anchorResponse = await request(app.getHttpServer())
        .post('/api/v1/blockchain/anchor')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const anchorResult = anchorResponse.body as AnchorRunResult;
      expect(anchorResult.anchoredCount).toBeGreaterThanOrEqual(0);

      const check = await request(app.getHttpServer())
        .get(`/api/v1/audit/events/${target!.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      anchored = (check.body as VerifyEventBody).blockchainAnchor.anchored;
    }
    expect(anchored).toBe(true);

    const afterVerify = await request(app.getHttpServer())
      .get(`/api/v1/audit/events/${target!.id}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const afterBody = afterVerify.body as VerifyEventBody;
    expect(afterBody.blockchainAnchor.anchored).toBe(true);
    expect(afterBody.blockchainAnchor.found).toBe(true);
    expect(afterBody.blockchainAnchor.chainLinkValid).toBe(true);

    await prisma.user.delete({ where: { id: createdUserId } });
  });

  it('never re-anchors (or overwrites the anchor reference of) an already-anchored event', async () => {
    // Deliberately does NOT assert a global anchoredCount of exactly 0: other
    // e2e spec files run concurrently in separate Jest workers against this
    // same shared database and legitimately generate their own unrelated
    // audit events (e.g. iam.e2e-spec.ts's own RBAC-denial tests) — asserting
    // an exact global count here would be a flaky assumption about state this
    // test doesn't own. What actually matters, and what this checks, is the
    // real invariant: an event that already has a blockchainTxRef must never
    // have that reference changed by a later anchoring run.
    const events = await request(app.getHttpServer())
      .get('/api/v1/audit/events')
      .query({ eventType: 'USER_CREATED', actorId: adminUserId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const alreadyAnchored = (
      events.body as { items: AuditEventBody[] }
    ).items.find((e) => e.blockchainTxRef !== null);
    expect(alreadyAnchored).toBeDefined();
    const originalTxRef = alreadyAnchored!.blockchainTxRef;

    await request(app.getHttpServer())
      .post('/api/v1/blockchain/anchor')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const refetched = await request(app.getHttpServer())
      .get(`/api/v1/audit/events/${alreadyAnchored!.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((refetched.body as AuditEventBody).blockchainTxRef).toBe(
      originalTxRef,
    );
  });

  it('verifies a transaction directly via the blockchain endpoint', async () => {
    // Force one more anchor so we have a fresh transaction id to query, since
    // the previous test intentionally left nothing to anchor. Generating the
    // audit event through a real denied request (rather than hand-rolling a
    // row via Prisma) keeps it a genuine, correctly hash-chained link in the
    // shared audit chain — a fabricated row with an arbitrary hash would
    // permanently break chain verification for every other reader of
    // audit_events, since these rows are never deleted.
    await request(app.getHttpServer())
      .get('/api/v1/blockchain/health')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);

    const runResult = await anchoringService.runOnce();
    expect(runResult.transactionId).toEqual(expect.any(String));

    const response = await request(app.getHttpServer())
      .get(`/api/v1/blockchain/transactions/${runResult.transactionId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const body = response.body as TransactionVerifyBody;
    expect(body.found).toBe(true);
    expect(body.chainLinkValid).toBe(true);
  });

  it('detects direct database tampering with a block as a broken chain link', async () => {
    const runResult = await anchoringService.runOnce();
    // If there was nothing left to anchor, fall back to the most recent block.
    const block = runResult.blockId
      ? await prisma.blockchainAnchor.findUnique({
          where: { id: runResult.blockId },
        })
      : await prisma.blockchainAnchor.findFirst({
          orderBy: { sequence: 'desc' },
        });
    expect(block).not.toBeNull();

    const originalRootHash = block!.rootHash;
    await prisma.blockchainAnchor.update({
      where: { id: block!.id },
      data: { rootHash: 'tampered-root-hash' },
    });

    try {
      const laterEvent = await prisma.blockchainTransaction.findFirst({
        where: { blockId: block!.id },
      });
      const response = await request(app.getHttpServer())
        .get(`/api/v1/blockchain/transactions/${laterEvent!.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect((response.body as TransactionVerifyBody).chainLinkValid).toBe(
        false,
      );
    } finally {
      await prisma.blockchainAnchor.update({
        where: { id: block!.id },
        data: { rootHash: originalRootHash },
      });
    }
  });
});
