import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_STEP_UP_KEY } from '../decorators/require-step-up.decorator';
import { StepUpService } from '../services/step-up.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../types/jwt-payload.type';

const STEP_UP_HEADER = 'x-step-up-token';

/**
 * Enforces @RequireStepUp() routes. Runs after JwtAuthGuard/PermissionsGuard
 * (request.user is already set). On success, stashes `stepUpVerified: true`
 * on the request so the controller can note it in the resulting audit event
 * — the same "guard verifies, controller/service records" split the
 * digital-signature guard (item 1) already established.
 */
@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly stepUpService: StepUpService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_STEP_UP_KEY,
      [context.getHandler(), context.getClass()],
    );
    const request = context
      .switchToHttp()
      .getRequest<
        Request & { user?: AuthenticatedUser; stepUpVerified?: boolean }
      >();
    const user = request.user;

    const token = request.headers[STEP_UP_HEADER];
    const tokenString = Array.isArray(token) ? token[0] : token;

    if (!required) {
      // Optional verification: a valid token presented on an unprotected route
      // only sets the flag for policy rules to read — it never grants access.
      if (user && tokenString && this.stepUpService.verify(tokenString, user.sub)) {
        request.stepUpVerified = true;
      }
      return true;
    }

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    if (!tokenString || !this.stepUpService.verify(tokenString, user.sub)) {
      await this.auditService
        .append({
          eventType: 'STEP_UP_MFA_REQUIRED',
          actorId: user.sub,
          actorEmail: user.email,
          organizationId: user.organizationId ?? undefined,
          resourceType: context.getClass().name,
          action: context.getHandler().name,
          payload: { path: request.originalUrl },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        })
        .catch(() => undefined);
      throw new ForbiddenException(
        'This action requires a fresh step-up MFA verification — call POST /auth/step-up and retry with the X-Step-Up-Token header',
      );
    }

    request.stepUpVerified = true;
    return true;
  }
}
