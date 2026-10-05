import { evaluatePolicies, type PolicyContext } from './policy.engine';
import { highValueApprovalRule, organizationScopeRule } from './rules';

const base: PolicyContext = {
  action: 'budget:approve',
  actor: { sub: 'u1', organizationId: 'org-a', roles: ['Approving Officer'] },
  resource: { organizationId: 'org-a', amount: 1000 },
  stepUpVerified: false,
};

describe('policy engine', () => {
  it('allows when no rule restricts the request (default allow)', () => {
    expect(evaluatePolicies([], base)).toEqual({ allowed: true });
  });

  it('first denial wins, in rule order', () => {
    const deny = (id: string) => ({
      id,
      evaluate: () => ({ allowed: false as const, rule: id, reason: 'x' }),
    });
    const decision = evaluatePolicies([deny('first'), deny('second')], base);
    expect(decision).toMatchObject({ allowed: false, rule: 'first' });
  });
});

describe('organizationScopeRule', () => {
  it('denies an actor acting on another organization', () => {
    const ctx = { ...base, resource: { organizationId: 'org-b' } };
    expect(evaluatePolicies([organizationScopeRule], ctx)).toMatchObject({
      allowed: false,
      reason: 'cross_organization_access',
    });
  });

  it('allows the same organization, and the Super Administrator bypass', () => {
    expect(evaluatePolicies([organizationScopeRule], base)).toEqual({ allowed: true });
    const admin = {
      ...base,
      actor: { ...base.actor, roles: ['Super Administrator'] },
      resource: { organizationId: 'org-b' },
    };
    expect(evaluatePolicies([organizationScopeRule], admin)).toEqual({ allowed: true });
  });
});

describe('highValueApprovalRule', () => {
  const rule = highValueApprovalRule(5000);

  it('requires step-up for approvals strictly above the threshold', () => {
    const big = { ...base, resource: { organizationId: 'org-a', amount: 5001 } };
    expect(evaluatePolicies([rule], big)).toMatchObject({
      allowed: false,
      reason: 'step_up_required_for_high_value_approval',
    });
    expect(evaluatePolicies([rule], { ...big, stepUpVerified: true })).toEqual({ allowed: true });
  });

  it('does not restrict amounts at or below the threshold, or non-approval actions', () => {
    const atLimit = { ...base, resource: { organizationId: 'org-a', amount: 5000 } };
    expect(evaluatePolicies([rule], atLimit)).toEqual({ allowed: true });
    const otherAction = {
      ...base,
      action: 'budget:submit',
      resource: { organizationId: 'org-a', amount: 999999 },
    };
    expect(evaluatePolicies([rule], otherAction)).toEqual({ allowed: true });
  });
});
