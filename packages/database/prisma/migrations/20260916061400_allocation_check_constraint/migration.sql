-- Defense-in-depth backstop (see schema.prisma comment on Allocation): the
-- application already enforces this invariant transactionally with a row
-- lock before every commit/spend, but a DB-level CHECK guarantees it holds
-- even if a future code path forgets to.
ALTER TABLE "allocations"
  ADD CONSTRAINT "allocations_balance_check"
  CHECK ("committedAmount" >= 0 AND "spentAmount" >= 0 AND "committedAmount" + "spentAmount" <= "authorizedAmount");
