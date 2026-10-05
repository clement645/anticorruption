import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { enrollTotp, issueStepUpToken } from './helpers/step-up';

interface LoginResponseBody {
  accessToken: string;
}
interface RoleBody {
  id: string;
  name: string;
}
interface ErrorResponseBody {
  message: string | string[];
}

/**
 * Phase 1 roadmap Phase 2 slice: the Roles/Permissions management API. The
 * guardrails under test are the anti-escalation rules — a caller can never
 * grant a permission they don't hold, can never touch system roles, and can
 * never edit a role they hold themselves — plus step-up on every mutation.
 */
describe('Roles management (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const managerEmail = 'e2e-roles-manager@test.bpfmps.local';
  const password = 'E2ETestPassword123!';
  const managerRoleName = '[E2E] Roles Manager';
  const createdRoleNames = ['[E2E] Created Role', '[E2E] Assigned Role'];

  let managerUserId: string;
  let managerRoleId: string;
  let managerToken: string;
  let managerSecret: string;
  let stepUpToken: string;

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
      where: { name: managerRoleName },
      create: { name: managerRoleName },
      update: {},
    });
    managerRoleId = role.id;
    for (const [resource, action] of [
      ['roles', 'read'],
      ['roles', 'manage'],
      ['budget', 'read'],
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
    const manager = await prisma.user.upsert({
      where: { email: managerEmail },
      create: {
        email: managerEmail,
        firstName: '[E2E]',
        lastName: 'RolesManager',
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
    managerUserId = manager.id;

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: managerEmail, password })
      .expect(200);
    managerToken = (login.body as LoginResponseBody).accessToken;

    managerSecret = await enrollTotp(app.getHttpServer(), managerToken);
    stepUpToken = await issueStepUpToken(
      app.getHttpServer(),
      managerToken,
      managerSecret,
    );
  });

  afterAll(async () => {
    await prisma.session.deleteMany({ where: { userId: managerUserId } });
    await prisma.digitalIdentity.deleteMany({
      where: { userId: managerUserId },
    });
    await prisma.mfaMethod.deleteMany({ where: { userId: managerUserId } });
    await prisma.userRole.deleteMany({ where: { userId: managerUserId } });
    await prisma.securityEvent.deleteMany({
      where: { userId: managerUserId },
    });
    await prisma.user.deleteMany({ where: { id: managerUserId } });
    await prisma.role.deleteMany({
      where: { name: { in: [managerRoleName, ...createdRoleNames] } },
    });
    await app.close();
  });

  it('lists every permission to a caller with roles:read', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/roles/permissions')
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);
    const keys = (response.body as Array<{ resource: string; action: string }>).map(
      (p) => `${p.resource}:${p.action}`,
    );
    expect(keys).toEqual(expect.arrayContaining(['roles:manage', 'budget:read']));
  });

  it('creates a role out of permissions the caller holds, and audits it', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({
        name: createdRoleNames[0],
        description: 'E2E role',
        permissions: ['budget:read', 'roles:read'],
      })
      .expect(201);
    const created = response.body as RoleBody;
    expect(created.name).toBe(createdRoleNames[0]);

    const event = await prisma.auditEvent.findFirst({
      where: { eventType: 'ROLE_CREATED', resourceId: created.id },
    });
    expect(event).not.toBeNull();
    expect(event!.actorId).toBe(managerUserId);
  });

  it('refuses to grant a permission the caller does not hold, and audits the denial', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({
        name: '[E2E] Escalation Attempt',
        permissions: ['budget:approve'],
      })
      .expect(403);
    expect((response.body as ErrorResponseBody).message).toMatch(
      /do not hold.*budget:approve/i,
    );

    const denial = await prisma.auditEvent.findFirst({
      where: {
        eventType: 'AUTHORIZATION_DENIED',
        actorId: managerUserId,
        action: 'manage',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(denial).not.toBeNull();
    expect((denial!.payload as { reason: string }).reason).toBe(
      'permission_escalation_denied',
    );
  });

  it('refuses to modify a system role, even with roles:manage', async () => {
    const superAdmin = await prisma.role.findUniqueOrThrow({
      where: { name: 'Super Administrator' },
    });
    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${superAdmin.id}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({ description: 'tampered' })
      .expect(403);
  });

  it('refuses to edit a role the caller holds themselves', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/roles/${managerRoleId}`)
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({ permissions: ['roles:read'] })
      .expect(403);
  });

  it('rejects an unknown permission key and a duplicate role name', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({ name: '[E2E] Bogus', permissions: ['no_such:permission'] })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({ name: createdRoleNames[0], permissions: ['budget:read'] })
      .expect(409);
  });

  it('will not delete a role that is still assigned to a user', async () => {
    const assigned = await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('X-Step-Up-Token', stepUpToken)
      .send({ name: createdRoleNames[1], permissions: ['budget:read'] })
      .expect(201);
    const assignedId = (assigned.body as RoleBody).id;

    const holder = await prisma.user.create({
      data: {
        email: 'e2e-roles-holder@test.bpfmps.local',
        firstName: '[E2E]',
        lastName: 'RoleHolder',
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        status: 'ACTIVE',
        roles: { create: { roleId: assignedId } },
      },
    });

    try {
      await request(app.getHttpServer())
        .delete(`/api/v1/roles/${assignedId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .set('X-Step-Up-Token', stepUpToken)
        .expect(409);
    } finally {
      await prisma.userRole.deleteMany({ where: { userId: holder.id } });
      await prisma.user.delete({ where: { id: holder.id } });
    }
  });

  it('requires step-up on every mutation', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/roles')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: '[E2E] No Step-Up', permissions: ['budget:read'] })
      .expect(403);
  });
});
