import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { CreateRoleDto, UpdateRoleDto } from '../dto/role.dto';

type RoleActor = {
  sub: string;
  email: string;
  organizationId: string | null;
  roles: string[];
  permissions: string[];
};
type RequestMeta = { ipAddress?: string; userAgent?: string };

const roleInclude = {
  permissions: { include: { permission: true } },
} as const;

@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list() {
    return this.prisma.role.findMany({
      include: roleInclude,
      orderBy: { name: 'asc' },
    });
  }

  async create(dto: CreateRoleDto, actor: RoleActor, requestMeta: RequestMeta) {
    const permissionIds = await this.resolvePermissionIds(dto.permissions);
    await this.assertNoEscalation(dto.permissions, actor, requestMeta, null);

    try {
      const role = await this.prisma.role.create({
        data: {
          name: dto.name,
          description: dto.description,
          permissions: {
            create: permissionIds.map((permissionId) => ({ permissionId })),
          },
        },
        include: roleInclude,
      });
      await this.audit(actor, requestMeta, 'ROLE_CREATED', role.id, 'create', {
        roleName: role.name,
        permissions: dto.permissions,
      });
      return role;
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code?: string }).code === 'P2002'
      ) {
        throw new ConflictException('A role with this name already exists');
      }
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateRoleDto,
    actor: RoleActor,
    requestMeta: RequestMeta,
  ) {
    const existing = await this.prisma.role.findUnique({
      where: { id },
      include: roleInclude,
    });
    if (!existing) {
      throw new NotFoundException('Role not found');
    }
    if (existing.isSystem) {
      await this.denyAndAudit(actor, requestMeta, id, 'system_role_protected');
      throw new ForbiddenException('System roles cannot be modified');
    }
    if (actor.roles.includes(existing.name)) {
      await this.denyAndAudit(actor, requestMeta, id, 'own_role_denied');
      throw new ForbiddenException('You cannot modify a role you hold yourself');
    }
    const permissionIds = dto.permissions
      ? await this.resolvePermissionIds(dto.permissions)
      : null;
    if (dto.permissions) {
      await this.assertNoEscalation(dto.permissions, actor, requestMeta, id);
    }

    const data: Prisma.RoleUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            roleId: id,
            permissionId,
          })),
        });
      }
      return tx.role.update({ where: { id }, data, include: roleInclude });
    });

    await this.audit(actor, requestMeta, 'ROLE_UPDATED', id, 'update', {
      roleName: updated.name,
      previousPermissions: existing.permissions.map(
        (rp) => `${rp.permission.resource}:${rp.permission.action}`,
      ),
      permissions: dto.permissions ?? null,
    });
    return updated;
  }

  async remove(id: string, actor: RoleActor, requestMeta: RequestMeta) {
    const existing = await this.prisma.role.findUnique({
      where: { id },
      include: { _count: { select: { userAssignments: true } } },
    });
    if (!existing) {
      throw new NotFoundException('Role not found');
    }
    if (existing.isSystem) {
      await this.denyAndAudit(actor, requestMeta, id, 'system_role_protected');
      throw new ForbiddenException('System roles cannot be deleted');
    }
    if (actor.roles.includes(existing.name)) {
      await this.denyAndAudit(actor, requestMeta, id, 'own_role_denied');
      throw new ForbiddenException('You cannot delete a role you hold yourself');
    }
    if (existing._count.userAssignments > 0) {
      throw new ConflictException(
        'Unassign this role from all users before deleting it',
      );
    }

    await this.prisma.role.delete({ where: { id } });
    await this.audit(actor, requestMeta, 'ROLE_DELETED', id, 'delete', {
      roleName: existing.name,
    });
  }

  /**
   * Anti-escalation guard: a caller may only grant permissions they already
   * hold. Super Administrator holds every permission, so it is not special-cased.
   */
  private async assertNoEscalation(
    requested: string[],
    actor: RoleActor,
    requestMeta: RequestMeta,
    roleId: string | null,
  ): Promise<void> {
    const held = new Set(actor.permissions);
    const notHeld = requested.filter((key) => !held.has(key));
    if (notHeld.length === 0) {
      return;
    }
    await this.denyAndAudit(
      actor,
      requestMeta,
      roleId,
      'permission_escalation_denied',
      { notHeld },
    );
    throw new ForbiddenException(
      `You cannot grant permissions you do not hold: ${notHeld.join(', ')}`,
    );
  }

  private async resolvePermissionIds(keys: string[]): Promise<string[]> {
    const unique = Array.from(new Set(keys));
    const rows = await this.prisma.permission.findMany({
      where: {
        OR: unique.map((key) => {
          const [resource, action] = key.split(':');
          return { resource, action };
        }),
      },
    });
    if (rows.length !== unique.length) {
      const known = new Set(rows.map((r) => `${r.resource}:${r.action}`));
      const unknown = unique.filter((key) => !known.has(key));
      throw new BadRequestException(
        `Unknown permissions: ${unknown.join(', ')}`,
      );
    }
    return rows.map((r) => r.id);
  }

  private async denyAndAudit(
    actor: RoleActor,
    requestMeta: RequestMeta,
    roleId: string | null,
    reason: string,
    extra: Prisma.InputJsonObject = {},
  ): Promise<void> {
    await this.auditService
      .append({
        eventType: 'AUTHORIZATION_DENIED',
        actorId: actor.sub,
        actorEmail: actor.email,
        organizationId: actor.organizationId ?? undefined,
        resourceType: 'Role',
        resourceId: roleId ?? undefined,
        action: 'manage',
        payload: { reason, ...extra },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      })
      .catch(() => undefined);
  }

  private async audit(
    actor: RoleActor,
    requestMeta: RequestMeta,
    eventType: string,
    roleId: string,
    action: string,
    payload: Prisma.InputJsonObject,
  ): Promise<void> {
    await this.auditService.append({
      eventType,
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Role',
      resourceId: roleId,
      action,
      payload,
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });
  }
}
