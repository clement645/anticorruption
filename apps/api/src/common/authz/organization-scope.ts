import { ForbiddenException } from '@nestjs/common';
import { AuditService } from '../../modules/audit/audit.service';
import { evaluatePolicies } from '../policy/policy.engine';
import { organizationScopeRule } from '../policy/rules';

interface OrgScopeAuditContext {
  auditService: AuditService;
  resourceType: string;
  resourceId: string;
  action: string;
  requestMeta: { ipAddress?: string; userAgent?: string };
}

/**
 * Closes the cross-tenant IDOR identified in the post-launch gap audit
 * (finding F-001): every mutating method on a resource that belongs to one
 * organization must call this immediately after fetching that resource,
 * before performing any state change. Deliberately WRITE-side only — read
 * visibility across organizations (Auditor/Internal Auditor's whole
 * purpose, and plausibly Ministry/County Officer's) is a separate, genuine
 * policy question left to the Phase 2 ABAC work, not assumed here.
 *
 * `Super Administrator` is the one bypass, identified by role name (stable
 * — `Role.isSystem` already marks exactly this role specially in the
 * schema) rather than by permission string, since this role already holds
 * every permission and has no single discriminating one to check instead.
 *
 * A rejection is itself recorded to the immutable audit trail as
 * `AUTHORIZATION_DENIED` — the same event type and the same reasoning
 * `PermissionsGuard` already uses for a plain permission denial (a pattern
 * of cross-org access attempts against one account is exactly the kind of
 * forensic signal the audit trail exists to capture). Logging is
 * fire-and-forget: a logging outage must never become the reason a
 * security decision fails to be enforced, so the throw below happens
 * unconditionally regardless of whether the audit write succeeds.
 */
export async function assertSameOrganization(
  actor: { sub: string; email: string; organizationId: string | null; roles: string[] },
  resourceOrganizationId: string,
  resourceLabel: string,
  auditContext: OrgScopeAuditContext,
): Promise<void> {
  const decision = evaluatePolicies([organizationScopeRule], {
    action: auditContext.action,
    actor,
    resource: { organizationId: resourceOrganizationId },
    stepUpVerified: false,
  });
  if (decision.allowed) {
    return;
  }

  await auditContext.auditService
    .append({
      eventType: 'AUTHORIZATION_DENIED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: auditContext.resourceType,
      resourceId: auditContext.resourceId,
      action: auditContext.action,
      payload: {
        reason: 'cross_organization_access',
        resourceLabel,
        resourceOrganizationId,
        actorOrganizationId: actor.organizationId,
      },
      ipAddress: auditContext.requestMeta.ipAddress,
      userAgent: auditContext.requestMeta.userAgent,
    })
    .catch(() => undefined);

  throw new ForbiddenException(
    `You do not have access to this ${resourceLabel} — it belongs to a different organization`,
  );
}
