-- Defense-in-depth backstop (see schema.prisma comments on SupplierOwner and
-- SupplierRiskProfile): per-row bounds are enforced at the database even if a
-- future code path forgets to validate them. The 0-100 sum ACROSS an owner's
-- sibling rows (total ownership should not exceed 100%) is deliberately an
-- application-layer check, not a CHECK constraint — Postgres CHECK
-- constraints cannot see sibling rows, and enforcing a real cross-row
-- invariant here would need the same row-locking approach as Phase 5's
-- allocations, which is not justified for a non-financial, low-concurrency
-- disclosure field (see THREAT_MODEL.md Phase 7 residual risk).
ALTER TABLE "supplier_owners"
  ADD CONSTRAINT "supplier_owners_percentage_check"
  CHECK ("ownershipPercentage" >= 0 AND "ownershipPercentage" <= 100);

ALTER TABLE "supplier_risk_profiles"
  ADD CONSTRAINT "supplier_risk_profiles_score_check"
  CHECK (score >= 0 AND score <= 100);
