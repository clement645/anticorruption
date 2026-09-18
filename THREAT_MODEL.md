# B-PFMPS Threat Model

Format per module, per section 36: Threat model → Attack surface → Security controls →
Implementation → Tests → Residual risk. Populated as each module is built; Phase 1's
entry is below. Later phases add their own section rather than editing this one's scope.

## Cross-Cutting Threats (apply to the whole system)

| Threat | Mitigation | Phase |
|---|---|---|
| Compromised authorized identity used to enter false but "legitimate-looking" data | Multi-signature approval, immutable audit trail, AI anomaly detection, human review — no single control assumed sufficient | 2/3/8/9 |
| Retroactive tampering with historical financial/audit records (incl. by a DB admin) | Append-only tables, hash chaining, periodic blockchain anchoring, dual-control admin actions | 3/4 |
| False positive/negative AI risk scoring used to wrongly clear or condemn a transaction | AI output is explainable + advisory only; mandatory human review before adverse action; AI decisions themselves audited | 8 |
| Public transparency portal leaking personal/sensitive data because "the transaction is public" | Explicit data classification + minimization at the query/serialization layer serving that portal, never raw table exposure | 12 |
| Compromised administrator account | MFA + step-up auth + dual control on dangerous actions; all admin actions audited and non-erasable | 2/14 |
| Blockchain/AI/storage layer unavailable at the moment of a financial transaction | Fail-safe (reject, don't silently succeed) rather than fail-open; explicit health checks; no blind retries on non-idempotent financial writes | 1/5/9 |

## Phase 1 — Foundation

**Threat model:** At this phase there is no business data, authentication, or
authorization yet — the attack surface is limited to the bare HTTP layer, configuration
handling, and the frontend/backend build & deploy pipeline.

**Attack surface:**
- Unauthenticated HTTP endpoints (`/api/v1/health`, `/api/v1/health/ready`).
- Environment/configuration loading at process boot.
- CORS configuration (which origins may call the API).
- Frontend build output (anything bundled into the SPA is public).

**Security controls implemented:**
- Environment variables validated at startup with a strict schema; the process refuses
  to boot on missing/invalid required config (fail closed) rather than starting with
  unsafe defaults.
- `.env` is git-ignored; only `.env.example` (placeholders, no real secrets) is
  committed.
- `helmet` security headers and an explicit CORS allow-list (not `*`) from the first
  commit.
- Health/readiness endpoints return no internal system details (no connection strings,
  stack traces, hostnames, or versions of internal dependencies).
- A global exception filter guarantees no unhandled error ever serializes a raw
  stack trace or database error message to the client.
- Public (`VITE_*`) vs. private environment variables are structurally separated —
  nothing under `apps/api` is ever bundled into the browser build.

**Implementation:** `apps/api/src/config`, `apps/api/src/common/filters`,
`apps/api/src/modules/health`.

**Tests:** Unit tests for the config validation schema (rejects missing `DATABASE_URL`,
rejects an undersized `JWT_SECRET`); e2e test asserting `/health` and `/health/ready`
respond correctly against a live database. *Correction:* the readiness endpoint's
`503`-on-unreachable-database path is implemented (`HealthService.getReadiness` catches
and reports `error`) but is not currently exercised by an automated test — doing so
would require simulating a database outage inside the test suite, which was not built in
this pass. Noted here rather than left as an unverified claim.

**Residual risk:** None business-relevant yet — no user data or financial logic exists
in this phase. The main residual risk is process/deployment hygiene (e.g. a future
misconfigured CORS origin in a hosting provider dashboard), which is why DEPLOYMENT.md
documents the exact expected production configuration explicitly rather than leaving it
to be inferred.

## Phase 2 — Identity & Access Management

**Threat model:** This is the first phase with real credentials, sessions, and
authorization decisions — the attack surface now includes credential theft/guessing,
session/token theft and replay, privilege escalation, and MFA bypass.

**Attack surface:**
- `/api/v1/auth/login`, `/mfa/verify`, `/refresh`, `/logout` — unauthenticated by
  necessity.
- The refresh-token cookie in transit and at rest (as a hash).
- Every protected route's permission check (a missing `@RequirePermissions()` would
  silently under-protect a route).
- TOTP secrets and backup codes at rest.
- The JWT signing secret (`JWT_SECRET`) and MFA encryption key (`MFA_ENCRYPTION_KEY`).

**Security controls implemented:**
- Argon2id password hashing; constant-shape `401` response whether the account exists
  or the password is wrong (response content does not confirm account existence — see
  residual risk below on timing).
- Account lockout after repeated failures, independent of rate limiting.
- Refresh tokens never stored in plaintext (SHA-256 hash only); reuse of a rotated-out
  token revokes the entire chain, not just the reused token.
- Refresh cookie is `HttpOnly` (unreadable to JS, so immune to token exfiltration via
  XSS) and path-scoped to `/api/v1/auth` (not sent on unrelated requests).
- MFA secrets encrypted at rest (AES-256-GCM); backup codes hashed and one-time-use.
- Global fail-closed authentication (`JwtAuthGuard` applied to every route by default)
  and explicit, route-level permission declarations (`PermissionsGuard`) rather than an
  implicit "authenticated = authorized".
- Every authentication/authorization-relevant event is written to append-only
  `security_events`.

**Implementation:** `apps/api/src/modules/iam/**`, `packages/crypto`.

**Tests:** 8 e2e tests against a real PostgreSQL instance covering: unauthenticated
rejection, unknown-email and wrong-password rejection, successful login with correct
JWT permission content, RBAC allow and deny, refresh-token rotation, reuse-detection on
both the reused token and the token that replaced it, and account lockout after
repeated failures. MFA (setup/enable/challenge/backup-code consumption/one-time-use
enforcement) was verified manually end-to-end against the live server with real
computed TOTP codes; this is not yet captured as an automated test — see
IMPLEMENTATION_PLAN.md.

**Residual risk:**
- Login response timing is not equalized between "no such account" and "wrong
  password" — a sufficiently precise timing attack could distinguish them (the Argon2id
  verify only runs in the wrong-password path). Not mitigated in this phase; a
  dummy-hash-verify-on-unknown-account technique is the standard fix and is noted as a
  Phase 14 hardening candidate.
- No login-anomaly detection (impossible travel, new device, unusual hour) — a stolen
  password alone (without also compromising the device to intercept MFA) is still
  blocked by MFA where enabled, but accounts without MFA enrolled have no such backstop
  beyond lockout.
- A role/permission change takes up to 15 minutes (one access-token lifetime) to take
  effect for an already-logged-in session, since permissions are embedded in the JWT at
  issuance — see SECURITY.md § Authorization "Known trade-off".
- `JWT_SECRET` is a single shared application secret in this prototype, not
  HSM/KMS-backed. Compromise of the running process's environment compromises all
  active and future sessions until rotated. Architected so a future PKI/HSM-backed
  signing key can replace it without changing calling code (mirrors the Phase 3 digital
  signature abstraction's design principle).

## Phase 3 — Immutable Audit

**Threat model:** The core threat this phase exists to counter is retroactive tampering
with historical records — including by someone with direct database access (a
compromised or malicious administrator, a leaked DB credential, a bug in some other
part of the application that mutates a row it shouldn't). A hash-chained, signed ledger
is only as good as its ability to actually detect such tampering; a chain that produces
false positives (reports tampering that didn't happen) or false negatives (misses real
tampering) is worse than no chain at all, because it either trains people to ignore its
alerts or gives false confidence. Both failure modes were found and fixed during this
phase's own testing — see below.

**Attack surface:**
- Direct database writes to `audit_events` bypassing the application (the scenario this
  phase specifically defends against).
- The Ed25519 private signing key (`AUDIT_SIGNING_PRIVATE_KEY`) — compromise lets an
  attacker forge signatures on tampered history.
- Concurrent writers racing to append to the same chain (a forking/race attack surface
  distinct from tampering).
- `/api/v1/audit/*` endpoints themselves (gated on `audit:read`, inheriting Phase 2's
  RBAC).

**Security controls implemented:**
- Append-only at the application layer: no code path issues `UPDATE`/`DELETE` against
  `audit_events`.
- Hash chain + Ed25519 signature per event, verifiable independently of the database's
  own integrity guarantees (i.e. even a superuser editing rows directly is detectable).
- Postgres advisory transaction lock serializes concurrent appends so the chain cannot
  fork under load — verified with 25 genuinely concurrent requests via a raw stress
  test (not just the design claim).
- `AUTHORIZATION_DENIED` (permission-guard denials) are themselves written to the
  audit trail — a pattern of denials against one account is a meaningful
  escalation-attempt signal.

**Implementation:** `apps/api/src/modules/audit/**`, `packages/crypto/src/signing.ts`.

**Tests:** `apps/api/test/audit.e2e-spec.ts` — permission-gated access (and that a
denial is itself audited), append-on-create, whole-chain verification, single-event
verification, and a genuine tamper-detection test that corrupts a row via raw SQL
(bypassing the application, not just calling a service method with bad input) and
asserts `/audit/verify` catches it with the correct reason, then restores the row and
re-verifies the chain is valid again. Also stress-tested with 25 concurrent HTTP
requests outside the test suite (documented here since it's a one-off verification, not
a repeatable automated test).

**Residual risk / two real bugs this phase's testing caught (not merely designed
around):**

1. **`jsonb` does not preserve JSON object key order on round-trip** (this is
   documented PostgreSQL behavior, not a bug in Postgres). The first implementation
   hashed `JSON.stringify(payload)` directly. That produces a *different* string — and
   therefore a different hash — depending on whether the object was just constructed by
   the application (insertion-order keys) or just read back from `jsonb` storage
   (Postgres's own internal key ordering). Verification recomputes the hash from the
   value *read back from the database*, so this made `payloadHash` mismatch on
   essentially every event, with zero actual tampering — a systemic false positive that
   would have made the whole verification feature useless in practice. Caught by
   running the actual e2e test suite against a real Postgres instance (not a mocked
   Prisma client) and seeing `verifyChain()` report `false` immediately after writing
   perfectly legitimate data. Fixed with a canonical (recursively key-sorted) JSON
   serialization applied identically at write time and verify time.
2. **The hash formula included `actorId`, a live foreign-key column with
   `onDelete: SetNull`.** When a referenced `User` row is deleted — a completely normal
   operation (an e2e test's own cleanup step, or in production an account offboarding)
   — Postgres correctly nulls out every `audit_events.actorId` that pointed at that
   user, per the FK constraint. But the event's `currentHash` and `signature` were
   computed and frozen *before* that deletion, using the *original* actor id.
   Re-verifying afterward recomputes the hash from the *now-null* `actorId` and gets a
   mismatch — again, a false positive with zero real tampering, but one specifically
   triggered by ordinary user-lifecycle operations happening *after* an audit event was
   written, which in a real deployment would eventually happen to every actor
   eventually. This is arguably the more serious of the two bugs: it would have meant
   the audit chain silently and unpredictably "broke itself" over time in production.
   Found the same way — real e2e tests, run twice in a row without resetting the
   database (deliberately simulating accumulated history), reproduced it consistently;
   root-caused by directly inspecting the broken row's stored fields via `psql` rather
   than guessing. Fixed by adding `actorIdSnapshot`, a plain string column with no FK
   relation, frozen at write time and never touched by any cascade; the hash chain now
   reads exclusively from that snapshot, never from the live `actorId` relation.
3. **Not yet addressed:** the signing key (`AUDIT_SIGNING_PRIVATE_KEY`) is a single
   application-managed secret, not HSM/KMS-backed, same residual risk noted for
   `JWT_SECRET` in Phase 2 — compromise of the running environment compromises the
   ability to forge-sign future events (though it does *not* let an attacker retroactively
   forge a *valid* signature for an *already-anchored* historical hash once Phase 4's
   blockchain anchoring exists, which is precisely why that phase matters).
4. **Not yet addressed:** no business modules exist yet to generate procurement/
   financial audit events, so this phase's real-world coverage is currently limited to
   IAM actions (`USER_CREATED`, `AUTHORIZATION_DENIED`). The chain mechanism itself is
   generic and will carry every future phase's events without changes.

## Phase 4 — Blockchain Integrity Layer

**Threat model:** This phase's purpose is to make tampering detectable *even by
someone with full write access to the primary database* — the audit chain (Phase 3)
already detects tampering with individual rows, but someone with database superuser
access could, in principle, rewrite an entire contiguous range of `audit_events`
consistently (recomputing every subsequent hash and forging a new signature with a
stolen `AUDIT_SIGNING_PRIVATE_KEY`) and the chain alone would show as valid. Anchoring
rollup hashes into a second, independent ledger means such a rewrite would also have to
match a rollup hash committed *earlier*, in a separate table with its own separate
chain and lock. The current implementation's honest limitation (see SECURITY.md § this
phase) is that both chains still live in the same physical PostgreSQL instance in this
prototype — real independence arrives with a `PermissionedBlockchainAdapter` on a
separately-operated network.

**Attack surface:**
- The periodic anchoring job and its manual-trigger endpoint (`POST
  /api/v1/blockchain/anchor`) — an attacker able to call it repeatedly, or race it,
  could in principle try to create duplicate/forked anchors.
- Direct database writes to `blockchain_anchors`/`blockchain_transactions` bypassing
  the application (the same class of threat Phase 3 defends against, applied here).
- The rollup hash computation itself — if it could be influenced to reference the wrong
  set of events, an anchor could be created that "vouches for" the wrong content.

**Security controls implemented:**
- `BlockchainAdapter` is a pure interface (`packages/blockchain`) — no business logic
  anywhere is coupled to `DevelopmentLedgerAdapter` specifically, so replacing it with a
  real permissioned-ledger adapter later requires no caller changes (section 54's
  explicit design goal).
- The rollup hash is computed by concatenating `audit_events.currentHash` values (not
  serializing JSON), sidestepping the jsonb key-order hazard from Phase 3 entirely by
  construction rather than by remembering to canonicalize.
- The same Postgres-advisory-lock chain-safety pattern proven in Phase 3, applied here
  with a distinct lock key — verified under genuine concurrent load (10 concurrent
  anchor triggers against 20 pending events: exactly one performed the anchor, the
  other nine correctly no-op'd, resulting ledger had exactly one block).
- `blockchainTxRef` is set exactly once, guarded by `WHERE blockchainTxRef IS NULL` —
  an event can never be silently re-anchored to a different transaction later.

**Implementation:** `packages/blockchain/**`, `apps/api/src/modules/blockchain/**`.

**Tests:** `apps/api/test/blockchain.e2e-spec.ts` — permission-gated access, health
check, a real anchoring run with before/after composed verification via
`GET /api/v1/audit/events/:id/verify`, an idempotency check (no re-anchoring or
overwriting an existing anchor reference), direct transaction verification, and a
genuine tamper-detection test that corrupts a block's `rootHash` via raw SQL and
asserts `chainLinkValid: false`, then restores it. Also stress-tested with 10
concurrent HTTP requests outside the automated suite (documented here as a one-off
verification, matching Phase 3's approach).

**Residual risk / two real bugs this phase's testing caught:**

1. **The scheduled anchoring job's elapsed-time gate started its countdown from epoch
   0**, so the very first tick after any process boot always computed an elapsed time
   far exceeding the configured interval and fired an automatic run immediately — an
   expensive job unexpectedly firing the instant a fresh instance starts, and in tests,
   a source of nondeterministic races against manual triggers for the same events.
   Fixed by starting the countdown from `Date.now()` at construction instead.
2. **A test asserted an exact global count of newly-anchored events ("0") after a
   second anchoring run**, which is unsound under Jest's parallel-worker execution:
   other e2e spec files run concurrently against the same shared database and
   legitimately produce their own audit events in the same window, which a correctly-
   functioning anchoring job will (correctly) also pick up. Caught via a genuinely
   flaky run (1 failure in 5 attempts) rather than dismissed as noise; root-caused by
   recognizing the test's assumption (that it exclusively owned the audit_events table
   during its own execution window) was false in a parallel-test environment, not that
   the anchoring logic was wrong. Fixed by rewriting the test to check the actual
   invariant that matters here — an already-anchored event's `blockchainTxRef` is never
   changed by a later run — instead of a global count. Re-verified with 8 consecutive
   clean runs plus a 5-run accumulated-state stress pass.
3. **Not yet addressed:** both the audit chain and the blockchain ledger live in the
   same physical database, so this phase does not yet protect against a full database
   host compromise — see the Threat model paragraph above and SECURITY.md's honest
   limitation note.
4. **Not yet addressed:** no business-module events (`BudgetAllocated`, `TenderAwarded`,
   etc., per section 17) flow into the ledger yet — only the audit-anchor rollup exists.

## Phase 5 — Budget Management

**Threat model:** This is the first module where a bug directly means public money is
misallocated — the core threat isn't external attack so much as ordinary
concurrency/logic bugs producing an over-committed or over-spent allocation (money
promised or spent that was never actually authorized), or a broken state machine
letting a budget skip approval. A race condition here is a financial-integrity
incident, not just a data inconsistency.

**Attack surface:**
- Every balance-changing endpoint (commit, release, expenditure, adjustment-approval)
  — the central concern is TOCTOU (time-of-check-to-time-of-use): reading a balance,
  deciding it's sufficient, then writing, with another request doing the same
  concurrently.
- Budget state-transition endpoints (submit/approve/reject) — skipping
  `PENDING_APPROVAL` would mean a budget never actually got approved by anyone with
  `budget:approve`.
- The DECREASE-adjustment path specifically — approving one that cuts authorized
  amount below already-committed-or-spent would retroactively make prior legitimate
  commitments/expenditures appear to violate the ceiling.

**Security controls implemented:**
- Every balance mutation runs inside a Postgres transaction that takes a
  `SELECT ... FOR UPDATE` row lock on the target `Allocation` before reading its
  current balance — the standard, correct fix for the TOCTOU class of bug, verified
  (not just asserted) under genuine concurrent load.
- A database-level `CHECK` constraint on `allocations` is a second, independent layer:
  even a future code path that forgets to lock cannot leave the table in an impossible
  state — the write itself fails at the database.
- Budget status transitions are validated against an explicit allow-list of legal
  "from" states before any transition (`DRAFT→PENDING_APPROVAL→APPROVED|REJECTED`
  only) — mirrors the same rigor section 11 requires for procurement.
- A DECREASE adjustment is checked against `committedAmount + spentAmount` before
  being allowed to apply, not just against zero.
- Every state-changing action writes a real, hash-chained, signed audit event
  (Phase 3) — this module is the first real exercise of that infrastructure for
  business logic rather than IAM housekeeping.

**Implementation:** `apps/api/src/modules/budget/**`.

**Tests:** `apps/api/test/budget.e2e-spec.ts` — permission gating, the full
create→submit→approve→allocate workflow with a negative test at every illegal state
transition, over-commit rejection (`409`), over-spend rejection (`400`), a DECREASE
adjustment that would cut below already-spent correctly rejected on approval (`409`),
and a genuine 10-way concurrent commitment stress test against a fixed-size allocation
(1000 available, 10× 200 requested concurrently) — exactly 5 succeeded, 5 were
rejected, and the final committed amount was exactly 1000, not more. Re-verified with
11 total clean full-suite runs across two different accumulation strategies (matching
the stability-verification approach adopted after Phases 3–4's real bugs).

**Residual risk:**
1. **Not yet addressed:** no configurable policy engine or multi-signature approval
   (sections 52/18) — a single actor with `budget:approve` can approve any budget or
   adjustment regardless of amount. A compromised or malicious Accounting Officer
   account can currently approve budgets of any size alone. Section 18 explicitly
   describes multi-actor approval chains for high-value operations; this is deferred
   to whichever phase first needs configurable thresholds badly enough to justify
   building the policy engine generally, rather than a budget-specific one-off.
2. **Not yet addressed:** commitment-control accounting, not full double-entry
   bookkeeping with a chart of accounts — see SECURITY.md § Financial Integrity for
   why this is considered sufficient for the current scope, and DATABASE.md's
   schema.prisma comment for the exact scope boundary.
3. **Not yet addressed:** Expenditure references a Commitment directly, with no
   Procurement/Contract/Invoice in between yet (those are Phases 6 and 9). Anyone with
   `budget:spend` can currently record an expenditure against any active commitment
   without an invoice or delivery having been verified — acceptable for demonstrating
   budget execution mechanics before those modules exist, not acceptable as a
   production control once they do.
4. **Not yet addressed:** `Allocation.blockchainTxRef` is schema-ready but unpopulated
   — only the underlying `ALLOCATION_CREATED` audit event gets anchored, nothing
   currently copies that reference back onto the allocation row. Documented as an
   honest gap in schema.prisma rather than silently left inconsistent with the
   `AuditEvent.blockchainTxRef` pattern it visually resembles.

## Phase 6 — Procurement

**Threat model:** Procurement is where public money actually gets committed to a named
counterparty, and where the governing spec's core corruption patterns concentrate:
steering an award to a favored bidder, bypassing competitive tendering, tampering with
evaluation scores after the fact, or exploiting a race in the award step to slip in a
second "winner." The threat is collusive/insider misuse of otherwise-legitimate
permissions as much as external attack — the same framing as Phase 5, one module
further down the money's path.

**Attack surface:**
- The plan→request→tender→bid→evaluation→award state machine — skipping a stage (e.g.
  raising a tender against a non-`APPROVED` request, or awarding a `SUBMITTED` bid that
  was never evaluated) would mean a procurement decision was made without the
  gate the spec requires.
- The request-approval step specifically, because it creates a real budget
  `Commitment` — the same TOCTOU class of bug Phase 5 defends against reappears here at
  the integration seam.
- The award step under concurrency — two evaluators/approvers racing to award the same
  lot (or the same bid) must not both succeed.
- Bid submission after a tender's `closingDate` or before it's `PUBLISHED` — a late or
  premature bid would undermine the fairness the competitive-tender step exists to
  guarantee.
- A supplier submitting more than one bid for the same lot — could be used to hedge or
  to signal collusion with another bidder.

**Security controls implemented:**
- Every transition is validated against an explicit allow-list of legal "from" states
  before it is applied (mirrors Phase 5's budget state machine), including
  `assertOpenForBidding()` checking both tender status and `closingDate` before any bid
  is accepted.
- Request approval calls straight into Phase 5's row-locked, CHECK-constrained
  `AllocationsService.createCommitment()` rather than re-implementing budget-safety
  logic — a compromise here inherits Phase 5's already-verified protection instead of
  being a second, separately-reasoned-about place the same bug class could occur.
- `Award.tenderLotId` and `Award.bidId` are both DB unique constraints — of any number
  of concurrent award attempts, the database itself permits only the first to commit;
  the rest fail on the unique-index check and are mapped to `409 Conflict` in
  `BidsService.award()`.
- `Bid.tenderLotId + supplierId` is a unique constraint — a supplier cannot submit a
  second bid for the same lot; the second attempt is rejected with `409`.
- Every state-changing action writes a real, hash-chained, signed audit event
  (Phase 3) — plan/request/tender/bid/award actions are all attributable and
  tamper-evident, not just logged.

**Implementation:** `apps/api/src/modules/procurement/**`.

**Tests:** `apps/api/test/procurement.e2e-spec.ts` — permission gating; the full
supplier→plan→request→tender→bid→evaluate→award lifecycle including the real budget
commitment being created on request approval; illegal-transition rejections at each
stage (late bid, bid on an unpublished/closed tender, evaluate/award out of order,
duplicate bid); and a genuine 5-way concurrent award-attempt stress test against the
same `TenderLot` — exactly one `Award` was created, the other four requests correctly
received `409 Conflict`. Re-verified with 11 total clean full-suite runs (6 accumulated
+ 5 fresh-truncate) across the whole 6-spec-file, 29-test e2e suite, matching the
stability-verification approach adopted after Phases 3–4's real bugs; no new bugs
surfaced during this phase's stress testing.

**Residual risk:**
1. **Not yet addressed:** no AI-assisted bid-collusion or price-anomaly detection
   (section 8's split-procurement/bid-collusion detectors, section 17) — Phase 6 stores
   the bid data those detectors will need, but nothing analyzes it yet. Deferred to
   Phase 8 (AI Risk Engine) rather than building a one-off heuristic here.
2. **Not yet addressed:** no configurable policy engine or multi-signature approval
   (sections 52/18) — a single actor with `procurement:approve` can approve a request
   or `procurement:award` can award a bid of any value alone, same scope limitation
   already documented for budget approval in Phase 5.
3. **Not yet addressed:** evaluation scoring (`technicalScore`/`financialScore`) is
   free-form input from any actor with `procurement:evaluate` — there is no
   multi-evaluator consensus, scoring-rubric enforcement, or automatic
   lowest-price/highest-score ranking; `BidsService.award()` awards whichever specific
   bid the caller names, it does not compute or enforce a "winner." A production
   deployment would need to decide whether the spec's evaluation criteria (price vs.
   technical merit weighting) are enforced in code or remain a documented human
   decision — left as the latter for this phase.
4. **Not yet addressed:** an `Award` has no downstream `Contract`/`PurchaseOrder`
   (Phase 9) yet — the procurement lifecycle currently ends at "awarded," matching
   Phase 5's expenditure path ending before an invoice exists.
5. **Not yet addressed:** suppliers are minimal identity records only (name,
   registration number, contact) — no ownership/beneficial-owner disclosure,
   compliance documents, or risk profile (section 12) exists yet; deferred to Phase 7
   (Supplier Management), which extends this same `suppliers` table rather than
   introducing a second supplier concept (see schema.prisma comment).

## Phase 7 — Supplier Management

**Threat model:** This module holds exactly the kind of data corruption
investigations actually need — who really owns/controls a supplier (including
politically exposed persons), whether its compliance documents are genuine and
current, and its accumulated risk history. The threat is less "external attacker"
and more insider misuse: an actor with legitimate access quietly under-disclosing
ownership, approving a document without real verification, or a supplier that
should be blocked from bidding continuing to win awards because nothing ever
actually enforces its status. A bug here doesn't corrupt money directly, but it
can hide the exact relationships anti-corruption controls exist to surface.

**Attack surface:**
- Visibility of sensitive supplier data (owners, documents, risk profile) —
  should be materially narrower than "can see suppliers exist at all."
- The beneficial-ownership disclosure endpoint — a malicious or careless actor
  under-disclosing ownership (e.g. omitting a PEP owner) defeats the entire
  point of the control; a race in the 100%-cap check could also let recorded
  ownership exceed reality.
- Document upload/verify — a party claiming a document is verified without
  real review, or the hash not actually matching what was reviewed.
- The status transitions (suspend/reactivate/blacklist) — the real question is
  whether these are *enforced* anywhere, not just recorded.

**Security controls implemented:**
- Route-level RBAC separates `supplier:read` (basic profile) from
  `supplier:read_sensitive` (owners, documents, risk profile) — a Procurement
  Officer needs to see standard profiles broadly, but seeing beneficial
  ownership and risk data is deliberately a narrower grant, mirroring the same
  read/read_sensitive split section 12's "RBAC-gated visibility" language asks
  for.
- `isPoliticallyExposedPerson` is a first-class, queryable boolean field on
  `SupplierOwner`, not buried in free-text notes — makes PEP ownership a fact
  the system can surface, not something that depends on a human reading every
  disclosure carefully.
- A document's SHA-256 hash is computed **server-side** from the submitted
  content, never trusted from the client — a caller cannot claim an arbitrary
  hash for content it never actually sent. Verified against `sha256sum` on
  identical bytes during manual smoke testing before the automated test existed.
- `supplier:verify` is a separate, narrower permission from `supplier:manage` —
  the actor who uploads a document is not automatically the actor who can mark
  it verified (both currently can be the same *role*, e.g. Procurement Officer,
  but the permission split exists so a future role separation doesn't require a
  schema or endpoint change).
- The ACTIVE/SUSPENDED/BLACKLISTED status machine is validated against an
  explicit allow-list of legal "from" states (mirrors every other module's state
  machine), and — the part that actually matters — `BidsService.submit()`
  really rejects bids from a non-ACTIVE supplier, verified end-to-end rather
  than just asserted by the state machine's existence.
- Every mutation (profile update, status transition, owner add/remove, document
  upload/verify/reject, risk assessment) writes a real, hash-chained, signed
  audit event (Phase 3).

**Implementation:** `apps/api/src/modules/supplier/**`.

**Tests:** `apps/api/test/supplier.e2e-spec.ts` — permission gating for both
`supplier:read` and `supplier:read_sensitive` (a limited-access role is proven
unable to see owners/documents/risk-profile, not just assumed); the 100%
ownership-cap rejection and acceptance paths; document upload with a
server-computed hash asserted equal to an independently computed
`node:crypto` hash of the same bytes, then verify/reject with correct state
guards; append-only risk assessment history where "current" is proven to be
the latest row; the full ACTIVE→SUSPENDED→ACTIVE / ACTIVE→BLACKLISTED
(terminal) state machine including all illegal-transition rejections; and a
full procurement-chain integration test — suspend a supplier, confirm its bid
is rejected with the existing Phase 6 message, confirm a different ACTIVE
supplier bidding on the same lot is unaffected. A separate test deliberately
proves the *absence* of a guarantee: 3 concurrent 70% owner-adds, asserting
more than one can succeed and the recorded total can exceed 100% — a
documented residual risk demonstrated empirically, not just described in
prose. All 8 tests passed on first run; stability-verified across 6
accumulated + 5 fresh-truncate runs of the full 7-spec-file, 37-test suite
(matching the methodology adopted after Phases 3–4's real bugs).

**Residual risk:**
1. **Not yet addressed:** the total-ownership-≤100% invariant is enforced with
   no lock — proven exploitable under genuine concurrent adds (see Tests
   above). Accepted as low-severity for now: a low-stakes, low-concurrency
   disclosure field, not a financial balance, so it doesn't currently justify
   the row-locking machinery Phase 5 uses for allocations. Would need
   revisiting if this endpoint ever saw meaningful concurrent write traffic.
2. **Not yet addressed:** no object storage backend exists — only a document's
   hash and metadata are persisted, never the file bytes. A verified document's
   hash proves integrity of *something*, but that something isn't retrievable
   through this API today. Phase 10's evidence vault is where real encrypted
   storage gets built.
3. **Not yet addressed:** blacklisting is a one-way door with no
   API-exposed reversal and no multi-signature/policy-engine requirement
   (section 52/18) — a single actor with `supplier:manage` can blacklist any
   supplier alone, and nothing currently lets that decision be reversed except
   direct database access. This is a deliberate "serious sanction, not easily
   undone" design choice, but it also means there is no in-app remedy for a
   mistaken blacklist yet.
4. **Not yet addressed:** document verification is a human judgment call with
   no automated authenticity checking (no OCR, no registry cross-check, no
   expiry-based auto-invalidation) — `supplier:verify` marking a document
   VERIFIED only means a human clicked verify, not that the document was
   independently confirmed genuine.
5. **Not yet addressed:** risk assessments are entirely manual — Phase 8's AI
   Risk Engine is what will start writing automated `SupplierRiskProfile` rows;
   until then, "current risk" only reflects whatever a human last recorded.

## Phase 8 — AI Risk Engine

**Threat model:** The threat here is dual and points in opposite directions. First,
the ordinary corruption patterns this engine looks for — bid-rigging via suspiciously
uniform pricing, artificially split procurement to dodge scrutiny thresholds,
anomalously priced bids, suppliers whose risk has quietly risen — going undetected
because nobody is systematically checking for them (the reason to build this at all).
Second, and just as real: an AI/statistical system that gets *too much* authority is
itself a threat — a wrong or manipulable automated decision that autonomously blocks,
rejects, or blacklists is a new attack surface and a new single point of failure that
a corruption-resistant system should not introduce. Section 8/17's "human-review gate
before any adverse action" is the answer to the second threat, and it shapes this
module's entire architecture, not just a line in its documentation.

**Attack surface:**
- The detectors' own outputs — a bug or manipulable threshold that produces false
  negatives (a real bid-rigging pattern that never gets flagged) is a corruption-
  detection failure; false positives at scale erode trust in the whole system and
  could be used to bury a genuine finding in noise.
- The review workflow (`risk:review`) — the actor resolving a finding about a
  procurement action must be independent of the actor who took that action, or the
  review is theater.
- Any code path that could let a detector's output autonomously affect a real
  business transition (approve, award, suspend) — this must not exist at all, not
  just be access-controlled.
- The statistics themselves as an attack surface: an actor who understands the exact
  thresholds could try to bid just inside them (e.g., splitting a procurement request
  to land just under `RISK_SPLIT_PROCUREMENT_THRESHOLD`, or spacing collusive bids
  just wide enough to clear `BID_COLLUSION_CV_HIGH`) — an inherent limitation of any
  disclosed, deterministic threshold, not something eliminated by this design.

**Security controls implemented:**
- Structural, not policy-based, non-interference: every detector's only interface to
  the rest of the system is `RiskAlertsService.raiseAlert()`, an additive insert with
  no return value the caller could act on to block anything, and every detector
  invocation is wrapped so an exception inside it is logged and swallowed rather than
  propagated — a detector cannot fail the approve/close/suspend action that triggered
  it even if it tries to. This is enforced by the code's shape, not by a "detectors
  must not do X" comment a future change could violate.
- `risk:review` (the only permission that changes an alert's resolution) is granted
  only to independent-oversight roles (Auditor, Internal Auditor, Approving Officer) —
  deliberately withheld from Procurement Officer, which holds nearly every other
  procurement permission. See SECURITY.md § Separation of duties.
- Every alert carries structured, numeric `evidence` (bid amounts, z-scores,
  coefficient of variation, weighted supplier-risk factors) — a reviewer sees the
  actual basis for a finding, not just a severity label, which is what makes the
  human-review gate meaningful rather than a rubber stamp.
- Duplicate-alert suppression (no new OPEN alert for the same detector+resource while
  one is already OPEN/UNDER_REVIEW) keeps the review queue from being spammed by
  repeated re-triggers of the same underlying condition.
- Every alert raised and every review decision writes a real, hash-chained, signed
  audit event (Phase 3) — `RISK_ALERT_RAISED`/`RISK_ALERT_REVIEWED`.

**Implementation:** `apps/api/src/modules/risk/**`, plus the integration call sites in
`apps/api/src/modules/procurement/services/tenders.service.ts` (`close()`),
`procurement-requests.service.ts` (`approve()`), and
`apps/api/src/modules/supplier/services/*.ts` (owner-add, document-reject,
suspend/reactivate/blacklist).

**Tests:** `apps/api/test/risk.e2e-spec.ts` — permission gating, including a
dedicated test proving `risk:review` is actually withheld from a role shaped like the
real Procurement Officer grant (403, not just absent from seed.ts); each detector
firing on realistic trigger data (a genuine price outlier via tender close, uniform
bidding via the same path, a 3-under-threshold-requests split-procurement pattern via
request approval, and PEP-owner/blacklist-driven supplier-risk escalation); the full
review workflow (OPEN → UNDER_REVIEW → CONFIRMED, blocked from re-review once
resolved) and duplicate-alert suppression; manual re-scan permission gating and 404s;
and **two regression tests that directly encode real bugs found during this phase's
own manual smoke testing before they reached automated coverage** — a price-anomaly
false-negative from z-score masking, and a price-anomaly false-positive from the
3-point leave-one-out degenerate case (see IMPLEMENTATION_PLAN.md Phase 8 for the
full account of both). Stress-tested across 11 total full-suite runs (6 accumulated +
5 fresh-truncate) after fixing a related pre-existing Phase 4 concurrency bug in
`AnchoringService` that this phase's stress-testing pass also surfaced (see
IMPLEMENTATION_PLAN.md Phase 8 and `blockchain.e2e-spec.ts`).

**Residual risk:**
1. **Not yet addressed:** duplicate-invoice detection — no `Invoice` entity exists
   yet (Phase 9). Building a stub detector against nonexistent data was rejected as
   dishonest scaffolding; this is an explicit, documented gap, not a silent omission.
2. **Not yet addressed:** all thresholds are static and disclosed in source
   (`risk.constants.ts`, `env.validation.ts`) — a sophisticated actor could shape
   behavior to stay just inside them (see Attack surface above). No adaptive or
   learned thresholds exist; that would require real historical baseline data this
   system doesn't yet have enough of.
3. **Not yet addressed:** bid-collusion detection looks at whole-lot uniformity only,
   not sub-clusters — a lot with 3 colluding bidders and 1 genuinely independent
   outlier bidder will not trigger collusion detection, because the outlier's
   presence pulls the whole-lot coefficient of variation up. Confirmed directly during
   manual smoke testing (not just theorized): the exact wild-outlier scenario that
   correctly triggered price-anomaly did not also trigger bid-collusion, even though
   the other 3 bids were themselves suspiciously tight.
4. **Not yet addressed:** no cross-tender or cross-time-window collusion detection
   (e.g., the same set of suppliers always losing to the same winner across many
   tenders, "bid rotation") — every detector here reasons about a single lot, request,
   or supplier in isolation, not longitudinal patterns across many.
5. **Not yet addressed:** supplier-risk weights (`SUPPLIER_RISK_WEIGHTS`) are
   hand-chosen constants, not calibrated against any real outcome data — they are a
   reasonable starting heuristic, not a validated scoring model.

## Phase 9 — Contracts, Invoices & Payments

**Threat model:** This is the phase where public money actually leaves the system —
every earlier phase built toward this moment (budget commitments, procurement awards,
supplier vetting, risk detection) but none of them actually moved a payment. The
threats are correspondingly sharper: a single compromised or malicious account
authorizing a real disbursement alone; a client-side retry or network failure causing
a double payment; a race between concurrent approval/execution attempts producing an
inconsistent authorization count; and the review/approval trail itself being
falsifiable or incomplete. Unlike every prior phase, a bug here has a direct financial
consequence, not just a data-integrity one.

**Attack surface:**
- The approval-casting endpoint — the actor who verified an invoice authorizing its
  own payment would collapse a two-person control into a one-person one.
- The execution endpoint specifically — this is where a race condition or a naive
  retry-handling bug means real money moves twice, or a genuine retry after a dropped
  response is wrongly told "no" and a legitimate payment stalls.
- The Contract-creation endpoint — accepting `organizationId`/`allocationId`/
  `commitmentId` as client input rather than deriving them from the Award would let a
  caller point a contract at a budget line that was never actually awarded to that
  supplier.
- Concurrent approval casting — multiple approvers acting near-simultaneously must
  not let a miscounted race push a request to APPROVED with fewer genuine approvals
  than `requiredApprovals`, or let more decisions be recorded than the state machine
  should allow once a terminal state is reached.

**Security controls implemented:**
- Every budget-line-identifying field on `Contract` is derived server-side from the
  `Award`'s own chain (`Award → TenderLot → Tender → ProcurementRequest`), never
  accepted as client input — see schema.prisma comment on `Contract`.
- Self-approval is blocked structurally: `PaymentsService.castApproval()` checks the
  invoice's `verifiedById` against the calling actor and returns `403` on a match, not
  just a policy note.
- No double approval by the same person: `@@unique([paymentRequestId,
  approvedById])` on `PaymentApproval` — the database itself guarantees it, not
  application logic that could have a gap.
- The approval-count-and-transition is row-locked (`SELECT ... FOR UPDATE` on
  `PaymentRequest`) — a running-tally problem given the same rigor as Phase 5's
  allocation balances, verified under genuine concurrent load (see Tests below), not
  assumed safe by inspection.
- `payment:execute` (Treasury Officer) is granted to a different role than
  `payment:approve` (Accounting Officer / Approving Officer) in seed.ts — the role
  that disburses money is not one of the roles that voted to authorize it.
- Idempotency-Key-backed execution: a claim-then-work sequence (see schema.prisma
  comment on `Payment`) makes a duplicate disbursement from a retried or racing
  request structurally difficult, not just discouraged — verified under genuine 5-way
  concurrent execution (see Tests below).
- Every contract/PO/invoice/approval/execution/reconciliation action writes a real,
  hash-chained, signed audit event (Phase 3).

**Implementation:** `apps/api/src/modules/contracts/**`.

**Tests:** `apps/api/test/contracts.e2e-spec.ts` — permission gating; the full
Contract → PurchaseOrder → Invoice → PaymentRequest lifecycle including every illegal
state transition; self-approval rejection and duplicate-approval rejection; a genuine
3-way concurrent approval stress test (exactly 2 of 3 reach the row-locked threshold
and succeed, the 3rd correctly observes the request is no longer PENDING); successful
execution updating the budget allocation and marking the invoice PAID; a regression
test for the idempotency-ordering bug (replaying the same key after a successful
execution returns the original payment, not a 400); and a genuine 5-way concurrent
execution stress test sharing one idempotency key (exactly one `Expenditure` created,
all 5 responses returning the identical `Payment` — a regression test for the
ambiguous-unique-constraint-target bug). All fixes verified with 11 total full-suite
stability runs (6 accumulated + 5 fresh-truncate) across all 9 spec files, matching
the methodology adopted after Phases 3–4's real bugs.

**Residual risk:**
1. **Not yet addressed:** duplicate-invoice detection — Phase 8's AI Risk Engine has
   not been extended to look at the now-real `Invoice` entity. The data exists; the
   detector doesn't yet.
2. **Not yet addressed:** no partial-commitment tracking when multiple contracts
   share one originating budget commitment (a multi-lot tender can produce several
   awards, several contracts, all tracing to the same `ProcurementRequest`). Only the
   first sibling contract's payment can successfully create an Expenditure; a second
   gets a clear `400` from `AllocationsService`, not a silent inconsistency — but this
   is a real functional limitation, not just an edge case, inherited from Phase 5's
   already-documented "one expenditure fully closes its commitment" scope boundary
   rather than newly introduced here.
3. **Not yet addressed:** payment execution is a simulated abstraction — `reference`
   is an internally-generated string, not a real bank/mobile-money transaction
   identifier, and there is no integration with an actual payment rail. Reconciliation
   is a manual human-entered record, not an automated bank-feed match.
4. **Not yet addressed:** `requiredApprovals` is a fixed default (2) set at
   `PaymentRequest` creation time, not a configurable, amount-scaled policy (section
   52's policy engine remains deferred, same as every earlier phase's approval
   workflow).
5. **Not yet addressed:** no PO-vs-cumulative-invoice-total reconciliation — a
   Purchase Order can be invoiced for more than its own amount; nothing currently
   checks or warns.

## Phase 10 — Project Verification

**Threat model:** This is the phase where money already disbursed (Phase 9) is
supposed to correspond to real, physically-verified work — the classic ghost-project
corruption pattern (claiming a school/road/clinic was built when it wasn't, or was
built to a lower standard than paid for) lives exactly at this seam. The threats are:
a project or milestone self-declared "done" by the same party who did the work,
without independent verification; a project appearing complete before all its
intended milestones were even defined (undermining the meaning of "complete" itself);
fabricated or substituted evidence (a photo from a different site, or a report edited
after the fact); and evidence that, once uploaded, could be silently tampered with at
rest without anyone noticing.

**Attack surface:**
- The milestone-completion and inspection endpoints — if the same role (or worse, the
  same actor) could both mark a milestone done and verify it, the entire point of
  independent inspection collapses into a rubber stamp.
- The project-creation endpoint — accepting `organizationId` as client input rather
  than deriving it from the Contract would let a caller attribute a project (and
  whatever budget/procurement history it implies) to an organization that never
  actually contracted for it.
- The auto-completion path — if a project could reach `COMPLETED` based on an
  incomplete or still-growing milestone list, "COMPLETED" would stop meaning "every
  planned piece of work was independently verified" and start meaning "at least one
  piece was," a materially weaker and misleading claim for exactly the audiences
  (auditors, the public transparency portal in Phase 12) who will read that status at
  face value.
- The evidence upload/download endpoints — this is the one place in the codebase
  storing and returning real file bytes rather than only metadata; a storage or
  encryption bug here has a direct confidentiality/integrity consequence that a
  hash-only design (Phase 7's supplier documents) never had to face.

**Security controls implemented:**
- `organizationId` on `Project` is derived server-side from the `Contract`, never
  accepted as client input — the identical anti-tampering judgment Phase 9 made for
  Contract's own budget-line fields.
- Separation of duties, enforced by distinct permissions rather than convention:
  `project:manage` (Project Manager — creates projects, starts/completes milestones)
  is granted to a different role than `project:inspect` (Engineer — records the
  PASSED/FAILED/NEEDS_REVISION outcome). A milestone only reaches `VERIFIED` as the
  consequence of an Engineer's independent inspection call — never self-declared by
  whoever marked it complete. Verified in `projects.e2e-spec.ts`: a Project Manager
  attempting `POST /milestones/:id/inspections` gets `403`; an Engineer attempting
  `POST /milestones/:id/complete` gets `403`.
- Milestone list freezing: `Milestone` creation is only permitted while the project is
  `PLANNED`; `activate()` is the point the list is locked. This is not cosmetic — it is
  what makes `ProjectsService.maybeMarkCompleted()`'s "every milestone is VERIFIED"
  check trustworthy at all. Without it, a project could auto-complete after its first
  milestone alone, before later milestones were ever created (see "real bug" below).
- Evidence is hashed (SHA-256) server-side at upload time — the client cannot supply a
  pre-computed hash the server merely trusts — encrypted at rest (AES-256-GCM,
  `packages/storage`), and the hash is anchored on the blockchain integrity layer
  immediately per file. The hash is re-verified against the actual stored bytes on
  every download, not just checked once at upload and assumed to still hold.
- Two independent, manually-verified tamper-detection layers on evidence (see
  SECURITY.md § Evidence Vault for the full account): AES-256-GCM's authentication
  tag rejects ciphertext tampering during decryption itself (`422`), and a SHA-256
  recomputation-vs-recorded comparison catches hash-record tampering that still
  decrypts cleanly (`hashVerified: false`).
- Every project/milestone/inspection/evidence action writes a real, hash-chained,
  signed audit event (Phase 3).

**Implementation:** `apps/api/src/modules/projects/**`,
`apps/api/src/modules/storage/**`, `packages/storage`.

**Tests:** `apps/api/test/projects.e2e-spec.ts` (13 tests) — permission gating
(`project:read`/`manage`/`inspect`, `evidence:upload`) including that a Project
Manager cannot inspect and an Engineer cannot manage; `organizationId` derivation;
Contract-must-be-ACTIVE and duplicate-project rejection; duplicate-sequenceNumber
rejection; milestone-list-freezing (adding a milestone after activation is rejected);
the full Milestone → Inspection lifecycle including the FAILED/NEEDS_REVISION →
rework → PASSED path; the full auto-completion regression test (a project with 2
intended milestones stays `IN_PROGRESS` after only the first is verified, and reaches
`COMPLETED` only once both are); evidence upload with a real SHA-256 cross-check
against `node:crypto` (not just trusting the server's own reported hash); and
inspection-must-belong-to-project validation on evidence upload. Manual live
curl smoke-testing against the running dev server additionally verified: the on-disk
evidence file is genuinely AES-256-GCM ciphertext, not plaintext (`grep` for the
original content against the stored file finds nothing); both tamper-detection paths,
by directly corrupting the on-disk file and separately swapping the DB's recorded
hash. All three bugs found during this phase's own smoke/e2e testing (premature
auto-completion, a missing 409 on duplicate-project creation, a raw 500 instead of a
clean 422 on tampered evidence) are now permanent regressions. Full e2e suite (70
tests across 10 spec files) and 11 total stability runs (6 accumulated + 5
fresh-truncate) all pass with no flakiness observed.

**Residual risk:**
1. **Not yet addressed:** filesystem object storage is a local simulation, not real
   S3/cloud storage — swappable without any caller change (`ObjectStorageAdapter`),
   but not yet swapped. A production deployment on a single host with this adapter
   has no built-in redundancy for stored evidence bytes beyond whatever the host's own
   disk/backup story provides.
2. **Not yet addressed:** no reconciliation between a Purchase Order's value (Phase 9)
   and a Project's milestone `plannedAmount` sum, or between overall project progress
   and how much has actually been invoiced/paid against the underlying contract. A
   project could be fully verified while its contract's payment history tells a
   different story, and nothing currently cross-checks the two.
3. **Not yet addressed:** no Invoice-eligibility gating tied to milestone
   verification — Phase 9's invoice/payment flow and Phase 10's milestone
   verification are not integrated; an invoice can be submitted and paid regardless
   of whether the corresponding physical work has been verified at all. This is the
   single largest residual gap for the ghost-project threat this phase's own model
   describes, and is flagged here rather than left implicit.
4. **Not yet addressed:** a project with zero milestones ever added before activation
   simply never auto-completes (the `every()` check over an empty array is guarded
   off deliberately) — correct behavior, but there is no explicit warning to a Project
   Manager who activates a project without having defined any milestones at all.
5. **Not yet addressed:** evidence review/verification is manual — there is no
   automated check that an uploaded photo/report is actually relevant to the
   milestone or inspection it's attached to (e.g. reverse-image or duplicate-file
   detection against previously-uploaded evidence). The AI Risk Engine (Phase 8) has
   not been extended to look at evidence uploads.

## Phase 11 — Auditor Portal

**Threat model:** By this phase, the system holds a genuinely large, cross-module
transaction history — budget commitments, procurement awards, payments, project
evidence — each individually audited (Phase 3) and each individually verifiable, but
with no built-in tool for an investigator to pull the full, trustworthy story of one
specific case without either trusting a raw event dump at face value or writing ad
hoc SQL. The threats here are less about a new attacker capability and more about
whether the oversight tooling itself can be trusted and whether it scopes correctly:
a reconstruction tool that silently omits events, that reports a resource "verified"
without actually re-checking its cryptographic properties (just reflecting whatever
`blockchainTxRef`/stored flags already say), or that leaks or conflates one
resource's integrity status with another's, would be worse than no tool at all — an
auditor acting on a false "all clear" is a more dangerous failure mode than an
auditor knowing they have no tool.

**Attack surface:**
- The reconstruction endpoint's own correctness — if chain-link validity were
  computed only within the filtered subset of matched events (rather than against
  each event's true global predecessor), a resource's own history could appear
  falsely clean by construction, independent of whether anything was actually
  tampered with.
- Cross-resource leakage or conflation — a reconstruction for resource A must never
  include, or be influenced by the integrity status of, an unrelated resource B's
  events, even though `resourceType`/`resourceId` are unindexed-by-relation plain
  strings (see DATABASE.md § Conventions) rather than foreign keys.
- Access to this tool itself — it exposes, in one place, a resource's entire
  history including actor identities, timestamps, and payloads; broader access than
  `audit:read` already grants would widen the exposure of that same data
  unnecessarily.

**Security controls implemented:**
- `reconstructResource()` reuses the existing, independently-tested `verifyEvent()`
  for every matched event rather than reimplementing verification logic or trusting
  cached state — each event's payload hash, chain link, current hash, and signature
  are all recomputed fresh, and the chain-link check is against that event's true
  predecessor in the *entire* chain (looked up by `sequence`), not merely the
  previous event within the filtered result set.
- No new permission introduced — gated on the existing `audit:read`, already
  restricted to Auditor/Internal Auditor/Super Administrator in seed.ts (verified:
  no other role has it).
- Blockchain anchor composition happens at the controller layer, the same
  established pattern `events/:id/verify` already used since Phase 4 — `AuditService`
  stays decoupled from `BlockchainAdapter`, consistent with the rest of the codebase's
  treatment of the blockchain layer as independent, swappable infrastructure.

**Implementation:** `apps/api/src/modules/audit/**` (extends the existing Phase 3
module — no new module, no new schema).

**Tests:** `apps/api/test/audit.e2e-spec.ts` (9 tests total, 5 new for this phase) —
resourceType/resourceId filtering on `GET /audit/events` scoped to exactly one
resource (proven by asserting an unrelated resource's events are absent, not just
that the target resource's events are present); `400` when either reconstruct query
param is missing; `403` without `audit:read`; a full reconstruction with every
per-event check passing and a `blockchainAnchor` field always present even when
unanchored; and — the test that most directly targets this phase's own threat
model — tampering with one resource's audit event and confirming reconstruction of
that resource correctly reports `fullyVerified: false` while reconstruction of a
second, unrelated resource in the same test run still correctly reports
`fullyVerified: true`. Full e2e suite (74 tests across 10 spec files) and full
monorepo build+lint pass cleanly; 11 repeated stability runs (6 accumulated + 5
fresh-truncate) all pass with no flakiness.

**Residual risk:**
1. **Not yet addressed:** reconstruction is a single-resource lookup. There is no
   cross-resource case view that walks known relationships as one combined timeline
   (e.g. Award → Contract → PurchaseOrder → Invoice → PaymentRequest → Payment) —
   an investigating auditor must currently reconstruct each linked resource
   separately and connect them manually.
2. **Not yet addressed:** no saved-search, case-notes, or export capability. A
   reconstruction result exists only in the API response for that one request; there
   is no way to bookmark an investigation, annotate it, or produce a shareable
   report from it.
3. **Not yet addressed:** the frontend's resource-type input is free text with
   suggestions, not validated against an enumerated list — an auditor must already
   know (or guess) the exact `resourceType` string a given module uses (e.g.
   `Project` vs `ProjectEvidence`); a typo silently returns an empty, vacuously
   "fully verified" result rather than an error, though `totalEvents: 0` does make
   that state distinguishable in the UI.
4. **Not yet addressed:** no rate limiting or audit logging specific to the
   reconstruction endpoint itself — an Auditor's own use of this forensic tool
   (which resources they investigated, and when) is not separately tracked, though
   every *prior* action visible through it already is.

## Phase 12 — Citizen Transparency Portal

**Threat model:** This is the first phase that deliberately opens an unauthenticated
door into the system — every prior phase's threat model assumed a caller with at
least a valid session. The threats here are almost entirely about what crosses that
door, not about breaking in through it: an internal field leaking into a public
response because a DTO was reused or extended carelessly; a not-yet-public record
(a `DRAFT` tender, a budget still pending approval) being exposed before its
owning organization intended it to be; the public hash-verification tool becoming
an oracle that reveals more than "does this hash match" (e.g. confirming file
existence/non-existence in a way that leaks investigation activity, or exposing
who uploaded something); and this being the first surface where anyone, including
an unauthenticated scraper, can generate load — a resourcing/availability concern
distinct from every prior phase's confidentiality/integrity focus.

**Attack surface:**
- Every field in every public DTO — the actual, ongoing risk here isn't the routes
  that exist today, it's a *future* edit that adds a field to an internal `*View`
  type without anyone remembering this module exists and copies it forward.
- The tender/project filters — a `DRAFT` tender or a budget with no `Allocation`
  yet (i.e. not yet APPROVED) must never appear, since these represent internal
  deliberation not yet made public by the organization's own process.
- The hash-verification endpoint — the most information-dense single endpoint in
  this phase, composing evidence storage, the audit chain, and the blockchain
  layer; a mistake here has the widest blast radius of anything in this phase.
- Unauthenticated request volume — with no session to rate-limit "per user"
  against, this surface is reachable by anyone at the same global rate limit as
  every authenticated endpoint.

**Security controls implemented:**
- Every public response type is hand-written in `transparency.types.ts`, never a
  re-export or structural narrowing of an internal `*View` type — verified by
  reading the file: not one import from another module's `*.types.ts`. This is
  the single most load-bearing control in this phase, and it is a code-structure
  guarantee, not a runtime check.
- `TenderService`'s list/detail queries explicitly exclude `DRAFT` status
  (`{ not: 'DRAFT' }` on list, an explicit status check plus `404` on detail);
  `GET /public/budgets` reads from `Allocation`, which by construction only
  exists once its Budget is APPROVED (see DATABASE.md § 5) — there is no code
  path that could accidentally expose a pending budget, because no `Allocation`
  row exists for one yet.
- The hash-verification response never includes `uploadedById`, the raw audit
  event, or the file's actual bytes — manually verified by inspecting a real
  response against a real upload (see Tests below) rather than assumed from
  reading the code.
- Global `ThrottlerGuard` (Phase 1, `APP_GUARD`) applies to `/public/*` exactly
  as it does to every other route, regardless of authentication status — read
  directly from `app.module.ts` rather than assumed.
- No permission decorator anywhere in `TransparencyController` — deliberately
  relying on `PermissionsGuard`'s existing, already-tested "no requirement
  declared" pass-through rather than inventing a new "public" code path that
  would itself need separate verification.

**Implementation:** `apps/api/src/modules/transparency/**` (new module, no new
schema).

**Tests:** `apps/api/test/transparency.e2e-spec.ts` (9 tests) — every `/public/*`
route reachable with literally no `Authorization` header at all (the test that
most directly proves "public" means public, not "permissive"); project list/detail
structurally checked to exclude `createdById`/`contractId`/milestone `id`; a real
tender flipped to `DRAFT` directly in the database and confirmed excluded from
both list and detail (`404`), then restored; a tender's winning award shown with
no losing-bid detail; a supplier's sensitive fields
(`email`/`phone`/`taxIdentifier`/`contactPersonName`/`physicalAddress`) set
directly via Prisma (since the create-supplier DTO doesn't even accept most of
them yet) and confirmed absent from the public response — defense in depth
against a future API surface gaining the ability to set them; an approved
allocation appearing in public budget data; hash verification's full happy path
(`found`/`anchored`/`chainIntact` all `true`, no `uploadedById` or `storageKey` in
the response); `found: false` for an unknown hash and `400` for a malformed one;
and a tamper-detection regression (corrupting the underlying audit event's
payload directly in the database, confirming `chainIntact` flips to `false`
through the *public* endpoint specifically, then restoring it and confirming it
flips back). Full e2e suite (83 tests across 11 spec files) and full monorepo
build+lint pass cleanly; the stability ritual (6 accumulated + 5 fresh-truncate)
passed 10 of 11 runs cleanly, with the one failure traced to host-level resource
contention unrelated to this phase's code (see IMPLEMENTATION_PLAN.md "Notable
engineering decisions" for the full diagnosis, including a control test against
an unrelated spec file).

**Residual risk:**
1. **Not yet addressed:** no cross-resource public timeline — a citizen looks up
   a project, its tender, and its contracted supplier as three separate lookups,
   not one connected story. The data to build that view already exists (the same
   relational chain Phase 11's reconstruction tool walks), just not assembled
   into a public-facing narrative yet.
2. **Not yet addressed:** no public map/geospatial view despite `Project.location`
   already existing as free text — a natural, high-value future addition for a
   physical-infrastructure transparency portal that wasn't built in this pass.
3. **Not yet addressed:** no public RSS/webhook/notification feed for "a new
   tender was published" or "a project just completed" style external monitoring
   — a citizen or journalist must poll the search endpoints manually today.
4. **Not yet addressed:** search is a simple case-insensitive substring match on
   one field (`name`/`title`) — no full-text search, no fuzzy matching, no
   search-by-location or search-by-amount-range.
5. **Accepted, not a gap:** this phase intentionally does not expose full bid
   tabulations (every bid and its amount, not just the winner) for an awarded
   tender lot. Some transparency portals do publish full bid history as an
   anti-collusion measure; this pass scoped to the winning award only, as the
   minimum necessary public-interest fact. Revisiting this is a policy decision,
   not a technical one, and is flagged here explicitly rather than left implicit.

## Phase 13 — Whistleblower Portal

**Threat model:** This phase's entire purpose is protecting the identity of
someone reporting misconduct — arguably the single highest-consequence privacy
requirement anywhere in this system, since the failure mode isn't "data
leaked" in the abstract, it's a specific person facing retaliation. The
threats are correspondingly different in character from every earlier phase:
not "can an unauthorized actor read data they shouldn't" (though that
matters too) but "can *anyone at all* — including someone with legitimate
`audit:read` access, including whoever operates the server, including an
investigator's own curiosity — work out who filed a specific report." A
second, related threat: a whistleblower system that appears anonymous but
isn't (logs an IP somewhere, requires an account, stores a recoverable
identity) is worse than an honestly-authenticated one, because it invites
exactly the people most at risk to use it under a false sense of safety.

**Attack surface:**
- The audit trail itself — every other module in this system deliberately
  records actor + IP + user agent on every action, precisely so behavior is
  accountable. For this one module's anonymous half, that same instinct is
  the threat: reflexively passing the caller's IP into `AuditService.append()`
  (the pattern every other service in the codebase follows) would silently
  reattach an identity to an anonymous report.
- The broader `audit:read` permission — held by Auditor, Internal Auditor,
  and Super Administrator, none of whom necessarily also hold the narrower
  `whistleblower:read`. If a whistleblower event's payload carried the
  report's actual description or contact info, anyone with only `audit:read`
  would see sensitive report content through a permission never meant to
  grant it.
- The ops-level HTTP request log — application-layer care about actor
  identity means nothing if the underlying web server/logging middleware
  independently records the caller's IP on every request regardless of what
  the application code does.
- The optional contact field — the one piece of data in this entire module
  that could actually identify someone, and the one place a plaintext
  storage mistake would have the most direct consequence.
- Cross-referencing risk — even with no identity stored anywhere, a report's
  own content (timing, specificity, which organization) could in principle
  let an investigator narrow down who filed it. This system cannot fully
  solve that problem (no technical control removes the information content
  of the report itself), but it can and does avoid adding any
  *additional* correlatable signal (IP, timestamp-with-request-metadata,
  account activity) on top of the report's own content.

**Security controls implemented:**
- `Report.trackingCodeHash` — only `sha256(trackingCode)` is ever persisted;
  the raw code exists only transiently and in the one-time submission
  response. Verified directly: a permanent regression test asserts the
  persisted hash equals a fresh SHA-256 computation over the returned code,
  and that it does *not* equal the raw code itself.
- Every anonymous-side call to `AuditService.append()` omits `actorId`,
  `actorEmail`, `ipAddress`, and `userAgent` — verified by inspecting real
  audit rows after a real submission: all four fields are `NULL`. The event
  `payload` is deliberately minimal (`reportId`, `category`,
  `evidenceCount`) — never description text, never contact info, never the
  tracking code — so `audit:read` alone can never reveal report content, only
  that a report of some category exists. Investigator-side calls use the
  full, normal, attributed form — no exception, no special case.
- A custom pino `serializers.req` (`app.module.ts`) strips `remoteAddress`/
  `remotePort` specifically for `/api/v1/public/whistleblower/*` requests —
  verified by direct inspection of real log lines (see IMPLEMENTATION_PLAN.md
  Phase 13 for the debugging account of a real bug this took to get right).
- The optional contact field is AES-256-GCM encrypted under a dedicated
  `WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY`, decrypted only for an authorized
  investigator viewing report detail — verified: the raw ciphertext in the
  database does not equal the plaintext contact, and the investigator-facing
  endpoint returns the correctly decrypted value.
- `whistleblower:read`/`investigate` are granted to exactly Auditor and
  Internal Auditor in seed.ts — verified: a role with broad access elsewhere
  in the system (a Procurement Officer-shaped role in the test suite) gets a
  clean `403` from every investigator-side endpoint.

**Implementation:** `apps/api/src/modules/whistleblower/**` (new module),
plus the pino `serializers.req` customization in `apps/api/src/app.module.ts`.

**Tests:** `apps/api/test/whistleblower.e2e-spec.ts` (7 tests) — every
anonymous-side call made with no Authorization header at all; the
tracking-code-hash cryptographic property described above; a structural
check that the public status response has no `organizationId`,
`assignedToId`, or `contact` property at all (not merely null values);
evidence upload with a real SHA-256 cross-check and anchor confirmation;
reporter reply visible on the reporter's own next status check; `403` for
an unprivileged role on the investigator side; an investigator seeing the
correctly-decrypted contact; and a full end-to-end workflow test that
drives assign → illegal-transition-rejected → legal-transition →
investigator-update → resolve → terminal-status-has-no-further-transition,
confirms the investigator's question is visible to the anonymous reporter,
and directly queries `audit_events` to confirm the anonymous-side rows are
unattributed while the investigator-side rows are fully attributed. Full
e2e suite (90 tests across 12 spec files) and full monorepo build+lint pass
cleanly; 11 repeated stability runs (6 accumulated + 5 fresh-truncate) all
pass with no flakiness.

**Residual risk:**
1. **Not yet addressed:** no rate limiting specific to report submission
   beyond the existing global limit — a low-volume spam/nuisance-report risk
   (not a data-exposure one), since the global `ThrottlerGuard` still applies.
2. **Not yet addressed:** no automated duplicate or similar-report detection
   — two reports about the same incident (from the same or different
   reporters) are not correlated by the system in any way.
3. **Not yet addressed:** no cross-resource link from a report to a related
   resource elsewhere in the system — if a report concerns a specific tender
   or contract, an investigator must locate and connect that manually; there
   is no "attach this report to Award X" capability.
4. **Not yet addressed, and structurally out of this system's reach:** the
   ops-level IP-redaction fix covers only this application's own pino
   logging. A real production deployment sitting behind a reverse proxy,
   load balancer, or CDN would need an equivalent access-log exemption
   configured at that layer too — this local dev environment has no such
   layer to demonstrate a fix for, so this is flagged as a deployment-time
   responsibility, not something this codebase can fully close on its own.
5. **Accepted, not a gap:** report content itself (specificity, timing,
   which organization) can in principle narrow down who filed a report, and
   no technical control removes that inherent property of the report's own
   substance. What this phase controls is avoiding any *additional*
   correlatable signal on top of that — no IP, no account, no recoverable
   identity — which is the full extent of what a technical system can
   actually guarantee here.

## Phase 14 — Production Hardening

**Threat model:** Different in kind from every earlier phase's threat model —
there is no new feature surface to attack, so the relevant question is "does what
was already built actually hold up under direct scrutiny, or only under the
scrutiny it received while being built." The risk this phase targets is
overclaiming: a control described in SECURITY.md that turns out, on actual
inspection, not to work as described. A second, distinct risk specific to this
phase's own circumstances: real external credentials (Neon, GitHub) arriving
mid-session, and the risk of either mishandling them (logging, committing) or
overreaching with them (deploying to/publishing from a real shared resource
without explicit confirmation).

**Attack surface:** every claim in SECURITY.md and every previously-stated
"Pass" — this phase's job was to try to break each one, not just re-read it.
Also, narrowly: the real Neon credentials themselves, for the short window they
existed in this session's working memory and in `apps/api/.env`.

**Security controls implemented / verified:** see SECURITY.md § OWASP ASVS
Review for the full, category-by-category account (V1–V14) — every "Pass" there
is evidence-cited to a specific file, test, or direct observation made *this
phase*, not carried forward from an earlier phase's own self-assessment.
Highlights not duplicated from that section: the dependency audit (`multer`,
`deepmerge-ts`, both fixed via targeted overrides, verified with a full clean
reinstall down to 0 vulnerabilities); the two real bugs found and fixed in
`AllExceptionsFilter` and `main.ts`'s body-size limit (a genuinely more
consequential finding than most ASVS line items, since it was silently breaking
a real feature, not just a theoretical gap); rate limiting confirmed as a
working control via direct testing (105 requests → exactly 100×`200` then
`429`s); and the secret-handling discipline applied to the real Neon credentials
supplied this session — used only to populate the gitignored `apps/api/.env`
for connectivity verification, confirmed via repo-wide grep to exist nowhere
else, and the actual schema-deployment action left unexecuted pending explicit
human confirmation rather than run through unilaterally.

**Implementation:** cross-cutting — `apps/api/src/main.ts`,
`apps/api/src/common/filters/all-exceptions.filter.ts`, root `package.json`
(`overrides`), `apps/api/.env`/`.env.example` (`connection_limit`,
`WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY` documentation), `.github/workflows/ci.yml`
(new), `DEPLOYMENT.md` (Backup & DR, Load Testing, CI/CD, GitHub Repository
sections, new), `SECURITY.md` (OWASP ASVS Review section, new).

**Tests:** `app.e2e-spec.ts` gained a permanent regression test for the
body-size/error-handling fix (a request over a deliberately small test-local
limit returns a proper `413` with the standard error shape, and a request
within it still succeeds normally). The dependency-audit fix and the
`connection_limit` fix were both verified via the existing full e2e suite
(91/91) rather than new dedicated tests, since neither changes application
behavior in a way a business-logic test would meaningfully exercise — their
verification is the audit tool's own report (0 vulnerabilities) and the load
test's own before/after numbers (see DEPLOYMENT.md), respectively. Full e2e
suite (91 tests across 12 spec files) and full monorepo build+lint pass
cleanly; 11 repeated stability runs (6 accumulated + 5 fresh-truncate) all pass
with no flakiness.

**Residual risk:**
1. **Not yet addressed:** no data retention/deletion policy for
   `security_events` or stale `sessions`/`devices` rows (they accumulate
   indefinitely) and no step-up (re-authentication) requirement for
   high-consequence actions (payment execution, whistleblower status changes)
   beyond holding a valid session — both newly named by this phase's ASVS
   review, not previously documented.
2. **Not yet addressed:** the new 15mb JSON body limit is global, not scoped
   per-route — a route with no legitimate reason to accept a large body still
   technically accepts one up to the same ceiling.
3. **Not yet addressed:** no actual backup/disaster-recovery drill has been
   performed against the real Neon project — the mechanism (point-in-time
   recovery, branching) is real and documented, but "documented as available"
   and "exercised at least once" are different claims.
4. **Not yet addressed:** load testing covered read-heavy public endpoints only,
   at moderate concurrency, for short durations, against local Postgres — not a
   sustained, high-concurrency, write-heavy test, and not against real Neon
   (where network latency and the pooler's own behavior would change the
   numbers).
5. **Not yet addressed, and deliberately left for explicit human action rather
   than done unilaterally:** schema deployment against the real Neon project
   (blocked by this environment's own safety tooling as a production-deploy
   action, not attempted through another channel), and pushing this
   repository to GitHub for the first time (a first-ever publish to a real,
   shared remote — see IMPLEMENTATION_PLAN.md "Next Steps").
