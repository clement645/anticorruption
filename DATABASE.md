# B-PFMPS Database Strategy

## 1. Engine

**Neon Serverless PostgreSQL.** Standard PostgreSQL wire protocol — Prisma connects to
it exactly as it would any PostgreSQL instance. Only backend services (`apps/api`) hold
a `DATABASE_URL`; it is never sent to the browser or referenced in `apps/web`.

Neon specifics used:
- `DATABASE_URL` — pooled connection string (PgBouncer), used by the running app.
- `DIRECT_DATABASE_URL` — direct (non-pooled) connection string, used by
  `prisma migrate` (migrations require a direct connection).
- `sslmode=require` is mandatory on every connection string.

## 2. ORM & Migrations

**Prisma**, in `packages/database`. Prisma Migrate generates versioned, reviewable SQL
migration files — production schema is **never** hand-edited (section 32). Environments
are separated by `.env` files per environment (development / staging / production), not
by branching the schema.

## 3. Schema Philosophy

The full target schema (section 24 of the governing spec) is large — `users`, `roles`,
`permissions`, `organizations`, budgeting tables, procurement tables, supplier tables,
project/evidence tables, `audit_events`, `blockchain_transactions`, etc. It is built
**incrementally, phase by phase**, not all at once, so that each set of tables ships
with the module that actually uses it and can be reviewed/tested in isolation:

| Phase | Tables added |
|---|---|
| 1 | none — schema scaffold + connectivity only |
| 2 — IAM ✅ | `organizations`, `departments`, `roles`, `permissions`, `role_permissions`, `user_roles`, `users`, `devices`, `sessions`, `mfa_methods`, `api_keys`, `digital_identities`, `security_events` |
| 3 — Audit ✅ | `audit_events` |
| 4 — Blockchain ✅ | `blockchain_transactions`, `blockchain_anchors` |
| 5 — Budget ✅ | `fiscal_years`, `budgets`, `budget_lines`, `allocations`, `commitments`, `expenditures`, `budget_adjustments` |
| 6 — Procurement ✅ | `procurement_plans`, `procurement_requests`, `tenders`, `tender_lots`, `bids`, `bid_evaluations`, `awards` |
| 7 — Supplier ✅ | `suppliers` (extended), `supplier_owners`, `supplier_documents`, `supplier_risk_profiles` |
| 8 — AI Risk ✅ | `risk_alerts` only — the originally-sketched `risk_scores`/`ai_decisions` were dropped in favor of reusing Phase 7's `supplier_risk_profiles` and Phase 3's `audit_events`; see § 5 Current State |
| 9 — Contracts/Payments ✅ | `contracts`, `purchase_orders`, `invoices`, `invoice_items`, `payment_requests`, `payment_approvals` (not originally sketched — needed for multi-signature approval), `payments`, `payment_reconciliations` |
| 10 — Projects | `projects`, `milestones`, `inspections`, `project_evidence` |
| 13 — Whistleblower | `whistleblower_reports` |
| Cross-cutting | `notifications`, `configuration`, `policy_rules` |

Rationale: building all ~40 tables now, before any service uses them, would produce an
unreviewable, untested schema and violates the "do not build the entire application in
one enormous response" instruction. Each table is added, migrated, and exercised by
real service code and tests in the phase that needs it.

## 4. Conventions (apply to every table from Phase 2 onward)

- UUID primary keys (`@id @default(uuid())`) for all business entities.
- `created_at` / `updated_at` timestamps on every table.
- Foreign keys with explicit `onDelete` behavior (never a silent implicit cascade on
  financial or audit data).
- `CHECK` constraints for invariants enforceable by the database itself (e.g.
  non-negative amounts, valid state enums).
- Indexes on every foreign key and every column used in access-control filtering
  (organization_id, department_id) or frequent lookup (status, created_at).
- JSONB only for genuinely schemaless payloads (e.g. AI detector `reasons`/`evidence`,
  policy `parameters`) — never as a substitute for proper relational columns.
- Row-level security is planned as a defense-in-depth backstop to application-layer
  authorization for organization-scoped tables, but is **not yet implemented** — Phase 2
  enforces authorization only at the application layer (NestJS guards). RLS will be
  added once a module with real multi-tenant data sensitivity (e.g. supplier records,
  Phase 7) makes the gap concrete rather than speculative.
- **Audit and financial ledger tables are append-only.** No `UPDATE`/`DELETE` Prisma
  calls are ever issued against `audit_events`, `security_events`,
  `blockchain_transactions`, `blockchain_anchors`, `expenditures`, or `payments` by
  application code, **with exactly one narrow, explicitly-documented exception:**
  `audit_events.blockchainTxRef` is set once, from `NULL`, by the Phase 4 anchoring job
  (`AuditService.recordAnchor()`, guarded by a `WHERE blockchainTxRef IS NULL` clause
  that can never overwrite an existing reference). This is metadata *about* an
  already-signed event, added later by an independent process — it never touches any
  hashed or signed field, so it doesn't compromise the append-only guarantee that
  actually matters (that history cannot be rewritten). Corrections to real content are
  modeled as new, linked records (e.g. a reversing entry), never as mutation of history.
  Soft-delete (`deleted_at`) is used only on genuinely mutable operational entities
  (e.g. draft procurement plans before publication) — never on immutable audit/ledger
  records.
- **Any hashed/signed table must never hash a live, mutable foreign-key column.**
  `audit_events.actorId` is `onDelete: SetNull` (so deleting a `User` doesn't cascade
  through audit history) — but that means its value can legitimately change *after* the
  row's hash/signature were computed and frozen. `audit_events` hashes
  `actorIdSnapshot` (a plain string, not a relation) instead — see THREAT_MODEL.md
  Phase 3 for the bug this caught. The same pattern applies to any future
  hash-chained/signed table with a nullable-on-delete relation.
- **Balance-bearing tables get a DB `CHECK` constraint as a defense-in-depth backstop
  to the application-level lock-and-validate logic, never as a substitute for it.**
  `allocations` has `committedAmount + spentAmount <= authorizedAmount` (added via a
  follow-up raw-SQL migration, since Prisma's schema DSL doesn't yet express arbitrary
  `CHECK` constraints) alongside `BudgetService`'s `SELECT ... FOR UPDATE` row lock.
  The same pattern should be applied to any future table with an enforced running
  balance (Phase 6's procurement requests reuse `allocations`' existing lock/CHECK
  rather than introducing a new balance-bearing table — see below; Phase 9's payment
  ledgers will need their own).
- **"Create exactly once" is enforced with a DB unique constraint, not a lock.** Not
  every concurrency problem is a running balance. Awarding a `TenderLot` is a
  create-once operation (one `Award` per lot, one `Award` per winning `Bid`), so
  `Award.tenderLotId` and `Award.bidId` are both `@unique` and the second of two
  concurrent award attempts fails on the database's own unique-index check (mapped to
  `409 Conflict` in `BidsService`) rather than needing an advisory or row lock at all —
  see THREAT_MODEL.md Phase 6 for the concurrency test that proves this.
- **Not every cross-row invariant gets a lock — some are deliberately left as an
  application-layer check, with the resulting gap proven by a test rather than
  silently assumed away.** `SupplierOwner.ownershipPercentage` summed across a
  supplier's owners should not exceed 100%, but this is a low-stakes,
  low-concurrency disclosure field, not a financial balance — `SupplierOwnersService`
  checks the running total before each add with no lock between the read and the
  write. `supplier.e2e-spec.ts` fires genuinely concurrent adds and asserts the
  cap *can* be exceeded, so this is a documented, verified limitation (see
  THREAT_MODEL.md Phase 7), not an untested assumption. A per-row `CHECK`
  constraint (0-100 on a single row) still backstops the one thing the database
  *can* enforce without seeing sibling rows.
- **A dedicated table isn't always the right unit of reuse — sometimes an existing
  one, designed for exactly this, is.** Phase 8's AI Risk Engine needed somewhere to
  record a supplier's computed risk score. Rather than adding a new table, it writes
  into Phase 7's `supplier_risk_profiles` — deliberately built detector-agnostic (a
  plain `factors` JSON bag, `assessedById` nullable) specifically so an automated
  detector could start writing the same shape of row later with no migration. This is
  a different kind of reuse than the "create exactly once" or "row lock" patterns
  above: not a concurrency-safety choice, but a schema-design one — recognizing that a
  table built one phase earlier was already the right home for a new phase's writes.
- **"Claim, then work" — a unique constraint enforced BEFORE the real side effect,
  not after.** Phase 9's `Payment.idempotencyKey` needed to arbitrate concurrent or
  retried execution attempts before any budget mutation happens, not just deduplicate
  rows afterward. `PaymentsService.execute()` INSERTs the `Payment` row first (with
  `expenditureId` still null — the field is nullable specifically to allow this), and
  only the request whose insert wins the unique-constraint race goes on to call
  `AllocationsService.createExpenditure()` and fill in `expenditureId` afterward. This
  is the same "create exactly once" judgment as Phase 6's `Award`, just applied one
  step earlier in the sequence than the actual side effect it's protecting — see
  THREAT_MODEL.md Phase 9 for the concurrent-execution test that proves it, and for a
  real bug this ordering choice fixed (checking for a replay before, not after,
  validating request status).
- **Multi-signature approval is a row-locked running count, not a unique constraint.**
  `PaymentRequest.requiredApprovals` distinct `PaymentApproval` rows are needed before
  a request moves to APPROVED — this is a running-tally problem, the same shape as
  Phase 5's allocation balances, so `PaymentsService` row-locks the `PaymentRequest`
  (`SELECT ... FOR UPDATE`) before counting approvals and deciding whether to
  transition status. The "no double approval by the same person" invariant, in
  contrast, genuinely is a create-exactly-once problem and is a plain
  `@@unique([paymentRequestId, approvedById])` constraint — two different concurrency
  shapes on two different invariants of the same feature, each given its own correct
  tool rather than one pattern applied uniformly.

## 5. Current State (Phase 14)

The IAM schema (Phase 2, 13 tables), `audit_events` (Phase 3),
`blockchain_transactions`/`blockchain_anchors` (Phase 4), the budget schema (Phase 5,
7 tables), the procurement schema (Phase 6, 8 tables: `suppliers`,
`procurement_plans`, `procurement_requests`, `tenders`, `tender_lots`, `bids`,
`bid_evaluations`, `awards`), the Phase 7 extension of `suppliers` plus 3 new
tables (`supplier_owners`, `supplier_documents`, `supplier_risk_profiles`), Phase 8's
single new table (`risk_alerts`), Phase 9's 7 new tables (`contracts`,
`purchase_orders`, `invoices`, `invoice_items`, `payment_requests`,
`payment_approvals`, `payments`, `payment_reconciliations`), Phase 10's 4 new
tables (`projects`, `milestones`, `inspections`, `project_evidence`), and Phase 13's
3 new tables (`whistleblower_reports`, `whistleblower_evidence`,
`whistleblower_report_updates`) are migrated and verified against a local
PostgreSQL 16 instance (see ARCHITECTURE.md § Verification Notes), including live
inserts/queries through every Phase 2–13 API flow (Phases 11–12 added no schema).
`packages/database/prisma/seed.ts` seeds baseline permissions (including `audit:read`,
`blockchain:read`/`anchor`, 7 `budget:*` permissions, 8 `procurement:*` permissions, 4
`supplier:*` permissions, 3 `risk:*` permissions, 9 `contract:*`/`invoice:*`/
`payment:*` permissions, 4 `project:*`/`evidence:*` permissions, and 2 new
`whistleblower:*` permissions), all 15 spec roles, and two DEMO/TEST users.

`audit_events.sequence` and `blockchain_anchors.sequence` are both real Postgres
`bigserial` columns (not application-computed counters), giving each chain a strict
total order independent of timestamp precision. Concurrent appends to either chain are
serialized with a `pg_advisory_xact_lock` (a distinct lock key per chain — they are
logically independent chains, even though both currently live in the same physical
Postgres instance for this prototype) — verified safe under 25 genuinely concurrent
audit appends and 10 genuinely concurrent blockchain anchor triggers (see
IMPLEMENTATION_PLAN.md Phases 3–4).

Phase 5's `allocations` table uses a different, more standard concurrency-safety
mechanism — a `SELECT ... FOR UPDATE` row lock, not an advisory lock — because it
guards a specific, already-identified row's balance rather than a "read latest, then
insert next" chain-append pattern; both are correct for their respective problems, and
using the row lock here (rather than reaching for the advisory-lock pattern out of
habit) is deliberate, not inconsistency. Verified under a 10-way concurrent commitment
stress test: exactly the number of requests that fit the ceiling succeeded, the rest
correctly rejected, with zero overshoot (see IMPLEMENTATION_PLAN.md Phase 5).

Phase 6 introduces a **third** concurrency-safety mechanism alongside the two above —
a DB unique constraint for "create exactly once" — rather than defaulting to either the
advisory-lock or row-lock pattern out of habit (see § 4 Conventions above). It also
deliberately introduces **no new balance-bearing table**: a `ProcurementRequest`
approval calls straight into Phase 5's `AllocationsService.createCommitment()` (the
same row-locked, CHECK-constrained code path budget's own direct commitments use), so
procurement inherits that safety property rather than re-implementing it. Verified
under a genuine 5-way concurrent award-attempt stress test against the same
`TenderLot`: exactly one `Award` was created, the other four requests correctly
received `409 Conflict` from the unique-constraint violation (see IMPLEMENTATION_PLAN.md
Phase 6).

Phase 7 introduces a **fourth** pattern alongside the three above — deliberately
*no* lock at all for `SupplierOwner`'s total-ownership-≤100% invariant, an
accepted low-severity gap proven real by a concurrent-add e2e test rather than
silently assumed safe (see § 4 Conventions above and THREAT_MODEL.md Phase 7).
Supplier compliance documents (`supplier_documents`) store only a server-computed
SHA-256 hash and metadata, never the file bytes — verified against `sha256sum`
on identical content during manual smoke testing. Suspending or blacklisting a
supplier is a real integration point with Phase 6: `BidsService.submit()`'s
`supplier.status !== 'ACTIVE'` check has existed since Phase 6 but was
unreachable until Phase 7 added the transitions that actually set a
non-ACTIVE status — verified end-to-end in `supplier.e2e-spec.ts`.

Phase 8's `risk_alerts` table introduces no new concurrency pattern of its own —
`RiskAlertsService.raiseAlert()` de-duplicates by checking for an existing OPEN/
UNDER_REVIEW alert for the same detector+resource before inserting, which is a
plain read-then-write with no lock. This is intentionally lower-rigor than the
patterns above: a duplicate alert (the failure mode if two detector runs race) is a
UI/review-queue nuisance, not a financial-integrity or audit-immutability concern,
so it doesn't warrant a unique constraint or advisory lock. Two real bugs were found
in *existing* code during this phase's stress-testing rather than in this new table:
a genuine concurrency race in Phase 4's `AnchoringService.runOnce()` (a boolean guard
returned a misleading zero-result to a caller racing an in-flight run — fixed by
awaiting the in-flight run's own `Promise` instead), and two statistical bugs in this
phase's own price-anomaly detector (population z-score "masking" an outlier by its
own inflated stddev, and a degenerate exact-±3.0 artifact of 3-point leave-one-out
samples) — see IMPLEMENTATION_PLAN.md Phase 8 for the full account and
THREAT_MODEL.md Phase 8 for the regression tests that now encode both fixes.

Phase 9 introduces a **fifth and sixth** concurrency pattern (see § 4 Conventions
above): "claim, then work" (`Payment.idempotencyKey`, a unique constraint enforced
*before* the real budget mutation instead of after) and a row-locked running count
(`PaymentRequest`'s multi-signature approval threshold) — plus reuses the plain
unique-constraint "create exactly once" pattern for `PaymentApproval`'s
no-double-approval invariant. Verified under a genuine 5-way concurrent `execute()`
stress test sharing one idempotency key (exactly one `Expenditure` created, all 5
responses returning the identical `Payment`) and a genuine 3-way concurrent
`PaymentRequest` approval stress test (exactly 2 of 3 reach the row-locked threshold
and succeed, the 3rd correctly rejected once the request is no longer PENDING — see
IMPLEMENTATION_PLAN.md Phase 9 and THREAT_MODEL.md Phase 9). `Payment.expenditureId`
is nullable specifically to make the claim-then-work ordering possible — the more
obvious "create the Expenditure, then the Payment" ordering was tried first and
rejected once it became clear it let the idempotency claim happen *after* the real
side effect, which is backwards for what Idempotency-Key exists to guarantee.

Refresh tokens (`sessions.refreshTokenHash`) and MFA backup codes
(`mfa_methods.backupCodeHashes`) follow the same never-store-the-secret pattern as
passwords: only a SHA-256 hash is persisted, never the token/code itself. TOTP secrets
(`mfa_methods.secretEncrypted`) are the one exception that must be recoverable — they
are AES-256-GCM encrypted at rest (`packages/crypto`) rather than hashed.

Phase 10 introduces no new concurrency pattern of its own — `projects.contractId`
reuses the plain unique-constraint "create exactly once" pattern from § 4 (initially
missed: the first version of `ProjectsService.create()` let a second attempt against
an already-used contract fall through to a raw, unhandled `P2002` instead of a clean
409 — fixed to match the same catch-and-translate shape `MilestonesService.create()`
already used for `milestones`' own `@@unique([projectId, sequenceNumber])`). The
schema's real new judgment is a **child-list-freezing gate**, not a concurrency
mechanism: `Milestone` rows may only be created while their `Project` is `PLANNED`,
so `activate()` freezes the milestone list before `ProjectsService.
maybeMarkCompleted()` — the same "auto-transition once every child reaches its
terminal state" pattern as Phase 6's `TendersService.maybeMarkAwarded()` — is ever
allowed to run. Tender lots get this property "for free" (`Tender.status` must be
`CLOSED`, strictly before any lot can be awarded); Projects needed the gate stated
explicitly, since milestones are added by direct user action rather than derived
from a prior close step. Found and fixed via this phase's own e2e suite: an early
version allowed adding milestones to an `IN_PROGRESS` project too, which meant a
project with an intended 2 milestones could auto-complete after only the first was
ever verified, before the second had even been created (see IMPLEMENTATION_PLAN.md
Phase 10 "Notable engineering decisions" for the full account).

`project_evidence` is the first table in the schema backed by real encrypted
object storage rather than a hash-only record (`storageKey` unique, `fileHash`
SHA-256, `blockchainTxRef` anchored immediately per-file rather than via the
periodic `AuditService` rollup). Tamper detection on read has two independent
layers, verified manually rather than assumed from reading the code: AES-256-GCM's
auth tag rejects any tampering with the ciphertext at rest by failing during
decryption (a 422, not a 200 with `hashVerified: false` — there is no plaintext
left to hash once decryption itself fails), and a SHA-256 recomputation-vs-recorded
comparison catches the narrower case of corruption that still decrypts (e.g. the
recorded hash itself being altered out of band) via `hashVerified: false`. Both
paths were exercised for real: corrupting a byte in the on-disk encrypted file, and
separately swapping the DB's recorded `fileHash`, before either was written up as
working.

Phase 11 added no new table and no migration — `AuditEvent.resourceType`/
`resourceId` (plain strings, deliberately not a foreign key, since Phase 3) and
the `@@index([resourceType, resourceId])` needed for this phase's own filtering
and "transaction reconstruction" endpoint already existed. The only genuinely
new thing this phase proves about the existing schema: per-event verification
(`payloadHash`/`previousHash`/`currentHash`/`signature`, all already Phase 3
columns) composes correctly when queried by resource rather than by the whole
chain — `reconstructResource()` checks each matched event's chain link against
its true global predecessor (looked up by `sequence`, not by position within
the filtered result set), so a tampered event still correctly fails even when
reconstruction is scoped to a *different* resource's history — verified
directly: tampering with one resource's event, then reconstructing an unrelated
resource in the same request window, leaves the unrelated resource's
`fullyVerified: true`.

Phase 12 also added no new table and no migration — the Citizen Transparency
Portal reads `Project`, `Milestone`, `ProjectEvidence`, `Tender`, `TenderLot`,
`Award`, `Bid`, `Supplier`, and `Allocation` exactly as they already existed,
through a set of hand-written, privacy-filtered public DTOs
(`transparency.types.ts`) rather than any new persisted shape. The one schema
fact this phase leans on directly: `Allocation` is created exactly once, the
moment its owning `BudgetPlan` is APPROVED (see the Phase 5 comment on that
model) — so `GET /public/budgets` can treat "an Allocation row exists" as the
entire "this is public record now" gate, with no separate status check against
the parent Budget needed.

Phase 13's `whistleblower_reports` introduces a pattern not seen anywhere else
in the schema: a table whose primary access control is a **possession-based
secret** rather than a permission check. `trackingCodeHash` follows the exact
"never persist the secret itself, only its hash" discipline Phase 2 already
established for `sessions.refreshTokenHash` and `mfa_methods.backupCodeHashes`
— the raw tracking code exists only in memory for the duration of the
submission request and in the one-time response body, never written to any
table. `contactEncrypted` uses AES-256-GCM (`packages/crypto`'s `encrypt()`,
Phase 6) under a dedicated `WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY` — deliberately
not `EVIDENCE_ENCRYPTION_KEY` or `MFA_ENCRYPTION_KEY`, key separation per
purpose rather than reuse for convenience. `whistleblower_evidence` reuses
Phase 10's `ObjectStorageAdapter`/`BlockchainAdapter` exactly as-is (no new
storage abstraction needed) with one structural difference from
`project_evidence`: it has no `uploadedById` column at all, not even a
nullable one — there is never an authenticated uploader to record for this
table, so the column simply doesn't exist rather than always being null.

Phase 14 (Production Hardening) added no schema and no migration — its one
database-relevant finding was operational, not structural: no explicit Prisma
`connection_limit` had ever been configured on `DATABASE_URL` anywhere in this
project, leaving Prisma's undocumented default (`num_physical_cpus * 2 + 1`)
silently governing production-relevant concurrency. A real load test found this
degrading throughput under realistic concurrent load (connection-pool queuing);
fixed by adding `connection_limit=20&pool_timeout=10` to `DATABASE_URL` — see
DEPLOYMENT.md § Load Testing & Capacity for the full before/after numbers. Real
Neon pooled/direct connection strings were also exercised for the first time this
phase (see ARCHITECTURE.md § Verification Notes) — schema deployment against the
real project is the one item left as an explicit pending human step rather than
something this agent did unilaterally against a real cloud database.
