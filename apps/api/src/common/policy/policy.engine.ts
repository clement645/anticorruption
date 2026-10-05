export interface PolicyActor {
  sub: string;
  organizationId: string | null;
  roles: string[];
}

export interface PolicyContext {
  action: string;
  actor: PolicyActor;
  resource: { organizationId: string; amount?: number | null };
  stepUpVerified: boolean;
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; rule: string; reason: string };

export interface PolicyRule {
  readonly id: string;
  /** Returns a denial, or null when the rule does not restrict this request. */
  evaluate(ctx: PolicyContext): PolicyDecision | null;
}

/**
 * Deny-overrides evaluation with a default of allow. Rules only ever restrict:
 * adding a rule can never grant access that RBAC did not already grant, and an
 * existing deployment keeps working unchanged until a rule's own condition is
 * configured. First denial wins, so rule order is the order of precedence.
 */
export function evaluatePolicies(
  rules: readonly PolicyRule[],
  ctx: PolicyContext,
): PolicyDecision {
  for (const rule of rules) {
    const decision = rule.evaluate(ctx);
    if (decision && !decision.allowed) {
      return decision;
    }
  }
  return { allowed: true };
}
