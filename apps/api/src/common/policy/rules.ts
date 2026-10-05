import type { PolicyContext, PolicyDecision, PolicyRule } from './policy.engine';

const CROSS_ORG_ROLE = 'Super Administrator';

/**
 * F-001 as a rule: an actor may only act on resources of their own
 * organization. Super Administrator is the one documented cross-org bypass.
 */
export const organizationScopeRule: PolicyRule = {
  id: 'organization-scope',
  evaluate(ctx: PolicyContext): PolicyDecision | null {
    if (ctx.actor.roles.includes(CROSS_ORG_ROLE)) {
      return null;
    }
    if (ctx.actor.organizationId === ctx.resource.organizationId) {
      return null;
    }
    return {
      allowed: false,
      rule: 'organization-scope',
      reason: 'cross_organization_access',
    };
  },
};

/**
 * Approvals above a configured amount must be backed by a fresh step-up MFA
 * verification. Disabled (no rule registered) when no threshold is configured.
 */
export function highValueApprovalRule(thresholdAmount: number): PolicyRule {
  return {
    id: 'high-value-approval-step-up',
    evaluate(ctx: PolicyContext): PolicyDecision | null {
      if (!ctx.action.endsWith(':approve')) {
        return null;
      }
      const amount = ctx.resource.amount ?? 0;
      if (amount <= thresholdAmount || ctx.stepUpVerified) {
        return null;
      }
      return {
        allowed: false,
        rule: 'high-value-approval-step-up',
        reason: 'step_up_required_for_high_value_approval',
      };
    },
  };
}
