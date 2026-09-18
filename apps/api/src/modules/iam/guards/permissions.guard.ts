import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedUser } from '../types/jwt-payload.type';
import { AuditService } from '../../audit/audit.service';

/**
 * RBAC enforcement: a route decorated with @RequirePermissions(...) is only
 * reachable if the authenticated user's token carries every listed
 * permission. Runs after JwtAuthGuard (request.user must already be set).
 * Undecorated routes are unaffected (least-privilege applies only where a
 * requirement was explicitly declared — see decorators/permissions.decorator).
 *
 * A denial is itself recorded to the immutable audit trail (section 7:
 * "authorization failures") — a pattern of denials against one account is a
 * meaningful forensic/escalation-attempt signal, distinct from routine
 * authentication telemetry in security_events.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const granted = new Set(user.permissions);
    const hasAll = required.every((permission) => granted.has(permission));

    if (!hasAll) {
      await this.auditService
        .append({
          eventType: 'AUTHORIZATION_DENIED',
          actorId: user.sub,
          actorEmail: user.email,
          organizationId: user.organizationId ?? undefined,
          resourceType: context.getClass().name,
          action: context.getHandler().name,
          payload: {
            requiredPermissions: required,
            grantedPermissions: user.permissions,
            path: request.url,
            method: request.method,
          },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        })
        // Audit logging must never itself become the reason a security
        // decision fails to be enforced — the deny below happens regardless.
        .catch(() => undefined);

      throw new ForbiddenException('Insufficient permissions for this action');
    }

    return true;
  }
}
