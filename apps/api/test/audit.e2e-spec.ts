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

interface AuditEventBody {
  id: string;
  eventType: string;
  actorEmail: string | null;
  resourceType: string | null;
  resourceId: string | null;
  payloadHash: string;
}

interface ChainVerificationBody {
  valid: boolean;
  totalChecked: number;
  brokenAtSequence?: string;
  reason?: string;
}

/**
 * Exercises the Phase 3 immutable audit trail end-to-end: that real actions
 * (user creation, permission denial) actually append signed, hash-chained
 * events, that the chain verifies as intact, and — the actual point of a
 * tamper-evident ledger — that directly corrupting a row in the database
 * (bypassing the application entirely) is detected by verification.
 */
describe('Audit (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const adminEmail = 'e2e-audit-admin@test.bpfmps.local';
  const noAuditEmail = 'e2e-audit-noperm@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let adminUserId: string;
  let noAuditUserId: string;
  let adminToken: string;
  let noAuditToken: string;
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

    const role = await prisma.role.upsert({
      where: { name: '[E2E] Audit Full Access' },
      create: { name: '[E2E] Audit Full Access' },
      update: {},
    });
    testRoleId = role.id;
    for (const [resource, action] of [
      ['users', 'read'],
      ['users', 'create'],
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

    const admin = await prisma.user.upsert({
      where: { email: adminEmail },
      create: {
        email: adminEmail,
        firstName: '[E2E]',
        lastName: 'AuditAdmin',
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
      where: { email: noAuditEmail },
      create: {
        email: noAuditEmail,
        firstName: '[E2E]',
        lastName: 'NoAudit',
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
    noAuditUserId = noPerm.id;

    const adminLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: adminEmail, password })
      .expect(200);
    adminToken = (adminLogin.body as LoginResponseBody).accessToken;

    const noPermLogin = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: noAuditEmail, password })
      .expect(200);
    noAuditToken = (noPermLogin.body as LoginResponseBody).accessToken;
  });

  afterAll(async () => {
    // Deliberately NOT deleting audit_events here: they are real, permanent
    // links in the shared hash chain (deleting one — or a concurrently
    // interleaved event from another test file — would break the chain's
    // previousHash references for whatever comes after it). Leaving these
    // test-created events in place is consistent with the append-only design
    // this phase exists to enforce, and is harmless in a local dev database.
    const allUserIds = [adminUserId, noAuditUserId, ...createdUserIds];
    await prisma.session.deleteMany({
      where: { userId: { in: allUserIds } },
    });
    await prisma.userRole.deleteMany({ where: { userId: { in: allUserIds } } });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: allUserIds } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: allUserIds } },
    });
    await prisma.rolePermission.deleteMany({
      where: { role: { name: '[E2E] Audit Full Access' } },
    });
    await prisma.role.deleteMany({
      where: { name: '[E2E] Audit Full Access' },
    });
    await app.close();
  });

  it('rejects audit access without the audit:read permission (and records the denial)', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/audit/events')
      .set('Authorization', `Bearer ${noAuditToken}`)
      .expect(403);

    const events = await prisma.auditEvent.findMany({
      where: { actorId: noAuditUserId, eventType: 'AUTHORIZATION_DENIED' },
    });
    expect(events.length).toBeGreaterThan(0);
  });

  it('appends a hash-chained, signed audit event when a user is created', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: 'e2e-audit-created-user@test.bpfmps.local',
        firstName: 'Created',
        lastName: 'ByAudit',
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

    const items = (events.body as { items: AuditEventBody[] }).items;
    const match = items.find((e) => e.resourceId === createdUserId);
    expect(match).toBeDefined();
    expect(match?.actorEmail).toBe(adminEmail);
    expect(match?.payloadHash).toEqual(expect.any(String));

    await prisma.user.delete({ where: { id: createdUserId } });
  });

  it('verifies the whole chain as valid', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/audit/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = response.body as ChainVerificationBody;
    expect(body.valid).toBe(true);
    expect(body.totalChecked).toBeGreaterThan(0);
  });

  it('verifies a single event and all four checks pass', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/audit/events')
      .query({ eventType: 'USER_CREATED', actorId: adminUserId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const items = (list.body as { items: AuditEventBody[] }).items;
    const eventId = items[0].id;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/audit/events/${eventId}/verify`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = response.body as {
      verified: boolean;
      checks: Record<string, boolean>;
    };
    expect(body.verified).toBe(true);
    expect(body.checks.payloadHashValid).toBe(true);
    expect(body.checks.chainLinkValid).toBe(true);
    expect(body.checks.currentHashValid).toBe(true);
    expect(body.checks.signatureValid).toBe(true);
  });

  it('detects direct database tampering with a payload as a broken chain', async () => {
    const target = await prisma.auditEvent.findFirst({
      where: { actorId: adminUserId, eventType: 'USER_CREATED' },
      orderBy: { sequence: 'asc' },
    });
    expect(target).not.toBeNull();
    const originalPayload = JSON.stringify(target!.payload);

    // Simulate an attacker (or a careless administrator) editing a row
    // directly in the database, bypassing the application entirely.
    await prisma.$executeRaw`UPDATE audit_events SET payload = '{"tampered": true}'::jsonb WHERE id = ${target!.id}`;

    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/audit/verify')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const body = response.body as ChainVerificationBody;
      expect(body.valid).toBe(false);
      expect(body.brokenAtSequence).toEqual(expect.any(String));
      expect(body.reason).toBe('payload_hash_mismatch');

      const eventVerify = await request(app.getHttpServer())
        .get(`/api/v1/audit/events/${target!.id}/verify`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const eventBody = eventVerify.body as {
        verified: boolean;
        checks: Record<string, boolean>;
      };
      expect(eventBody.verified).toBe(false);
      expect(eventBody.checks.payloadHashValid).toBe(false);
    } finally {
      // Restore the original payload — this test's row is a real, permanent
      // member of the shared audit chain (other processes / the demo UI may
      // read it), so the simulated tampering must not be left in place.
      await prisma.$executeRaw`UPDATE audit_events SET payload = ${originalPayload}::jsonb WHERE id = ${target!.id}`;
    }

    const restoredVerify = await request(app.getHttpServer())
      .get('/api/v1/audit/verify')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect((restoredVerify.body as ChainVerificationBody).valid).toBe(true);
  });

  /**
   * Phase 11 (Auditor Portal): resourceType/resourceId filtering and the
   * "transaction reconstruction" endpoint. `createdUserIds` collects every
   * user created below so afterAll can clean them up the same way the rest
   * of this file's fixtures are cleaned up — their audit events are real,
   * permanent chain links and are deliberately left in place (see afterAll).
   */
  const createdUserIds: string[] = [];

  async function createTestUser(label: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email: `e2e-audit-${label}-${Date.now()}-${Math.random()}@test.bpfmps.local`,
        firstName: 'Reconstruct',
        lastName: label,
        temporaryPassword: 'TemporaryPassword123!',
        roleIds: [testRoleId],
      })
      .expect(201);
    const id = (response.body as { id: string }).id;
    createdUserIds.push(id);
    return id;
  }

  it('filters /audit/events by resourceType and resourceId, scoped to exactly one resource', async () => {
    const userAId = await createTestUser('filter-a');
    const userBId = await createTestUser('filter-b');

    const response = await request(app.getHttpServer())
      .get('/api/v1/audit/events')
      .query({ resourceType: 'User', resourceId: userAId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const items = (response.body as { items: AuditEventBody[] }).items;

    expect(items.length).toBeGreaterThan(0);
    expect(items.every((e) => e.resourceId === userAId)).toBe(true);
    expect(items.some((e) => e.resourceId === userBId)).toBe(false);
  });

  it('rejects /audit/reconstruct without resourceType/resourceId, and without audit:read', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/audit/reconstruct')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/audit/reconstruct')
      .query({ resourceType: 'User', resourceId: 'irrelevant' })
      .set('Authorization', `Bearer ${noAuditToken}`)
      .expect(403);
  });

  it("reconstructs a resource's full history, each event independently re-verified with a blockchain anchor status composed in", async () => {
    const userId = await createTestUser('reconstruct');

    const response = await request(app.getHttpServer())
      .get('/api/v1/audit/reconstruct')
      .query({ resourceType: 'User', resourceId: userId })
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const body = response.body as {
      resourceType: string;
      resourceId: string;
      totalEvents: number;
      fullyVerified: boolean;
      events: Array<{
        event: AuditEventBody;
        verified: boolean;
        checks: Record<string, boolean>;
        blockchainAnchor: { anchored: boolean };
      }>;
    };

    expect(body.resourceType).toBe('User');
    expect(body.resourceId).toBe(userId);
    expect(body.totalEvents).toBeGreaterThan(0);
    expect(body.fullyVerified).toBe(true);
    expect(body.events.every((e) => e.verified)).toBe(true);
    expect(body.events.every((e) => e.event.resourceId === userId)).toBe(true);
    // Not yet anchored — anchoring is a separate, periodic/manual Phase 4
    // process this test doesn't trigger — but the field must always be
    // present so the UI never has to guess.
    expect(
      body.events.every(
        (e) => typeof e.blockchainAnchor.anchored === 'boolean',
      ),
    ).toBe(true);
  });

  it(
    'detects tampering scoped correctly: a tampered resource reconstructs as ' +
      'unverified, but an unrelated resource reconstructed in the same request ' +
      "window is unaffected — reconstruction isolates by resourceId, it doesn't " +
      "just report the whole chain's health under a resource's name",
    async () => {
      const tamperedUserId = await createTestUser('tampered');
      const cleanUserId = await createTestUser('clean');

      const target = await prisma.auditEvent.findFirst({
        where: { resourceType: 'User', resourceId: tamperedUserId },
        orderBy: { sequence: 'asc' },
      });
      expect(target).not.toBeNull();
      const originalPayload = JSON.stringify(target!.payload);

      await prisma.$executeRaw`UPDATE audit_events SET payload = '{"tampered": true}'::jsonb WHERE id = ${target!.id}`;

      try {
        const tamperedResult = await request(app.getHttpServer())
          .get('/api/v1/audit/reconstruct')
          .query({ resourceType: 'User', resourceId: tamperedUserId })
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        expect(
          (tamperedResult.body as { fullyVerified: boolean }).fullyVerified,
        ).toBe(false);

        const cleanResult = await request(app.getHttpServer())
          .get('/api/v1/audit/reconstruct')
          .query({ resourceType: 'User', resourceId: cleanUserId })
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
        expect(
          (cleanResult.body as { fullyVerified: boolean }).fullyVerified,
        ).toBe(true);
      } finally {
        await prisma.$executeRaw`UPDATE audit_events SET payload = ${originalPayload}::jsonb WHERE id = ${target!.id}`;
      }
    },
  );
});
