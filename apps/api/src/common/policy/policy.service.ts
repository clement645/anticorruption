import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvConfig } from '../../config/env.validation';
import { AuditService } from '../../modules/audit/audit.service';
import {
  evaluatePolicies,
  type PolicyContext,
  type PolicyRule,
} from './policy.engine';
import { highValueApprovalRule } from './rules';

type RequestMeta = { ipAddress?: string; userAgent?: string };

/**
 * Runs the ABAC rule set for a sensitive action. A denial is audited as
 * AUTHORIZATION_DENIED (the same event type the other guards use) before the
 * throw, so every policy refusal is visible on the immutable trail.
 */
@Injectable()
export class PolicyService {
  private readonly rules: PolicyRule[];

  constructor(
    config: ConfigService<EnvConfig, true>,
    private readonly auditService: AuditService,
  ) {
    const threshold = config.get('HIGH_VALUE_APPROVAL_THRESHOLD', { infer: true });
    this.rules = threshold !== undefined ? [highValueApprovalRule(threshold)] : [];
  }

  async enforce(
    ctx: PolicyContext,
    resourceType: string,
    resourceId: string,
    requestMeta: RequestMeta,
  ): Promise<void> {
    const decision = evaluatePolicies(this.rules, ctx);
    if (decision.allowed) {
      return;
    }
    await this.auditService
      .append({
        eventType: 'AUTHORIZATION_DENIED',
        actorId: ctx.actor.sub,
        organizationId: ctx.actor.organizationId ?? undefined,
        resourceType,
        resourceId,
        action: ctx.action,
        payload: { rule: decision.rule, reason: decision.reason, amount: ctx.resource.amount ?? null },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      })
      .catch(() => undefined);
    throw new ForbiddenException(
      'This approval exceeds the high-value threshold and requires a fresh step-up MFA verification — call POST /auth/step-up and retry with the X-Step-Up-Token header',
    );
  }
}
