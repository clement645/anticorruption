# B-PFMPS Implementation Plan

This is the living plan for building the Blockchain-Based Integrated Public Financial
Management & Procurement System (B-PFMPS). Update this file at the end of every phase.

Status legend: ✅ done · 🟡 in progress · ⬜ not started

## Phase 0 — Architecture ✅
- [x] Repository structure (monorepo, npm workspaces)
- [x] Core documentation (this file, ARCHITECTURE.md, DATABASE.md, API.md, SECURITY.md,
      THREAT_MODEL.md, DEPLOYMENT.md)
- [x] Environment variable strategy (.env.example, public vs. private separation)
- [x] .gitignore / secret hygiene

## Phase 1 — Foundation ✅ (verified locally; see caveats below)
- [x] NestJS 11 backend scaffold (`apps/api`) with strict TypeScript
- [x] Vue 3 + Vite + TypeScript + Vue Router + Pinia + Tailwind CSS frontend
      scaffold (`apps/web`)
- [x] Prisma 6 configured against PostgreSQL (`packages/database`), client generated
- [x] Centralized configuration module (`@nestjs/config` + Zod validation, fail-closed)
- [x] Structured logging (`nestjs-pino`, request-correlated, secrets redacted)
- [x] Global exception filter (no raw DB errors/stack traces ever leaked)
- [x] Security headers (`helmet`) + explicit CORS allow-list
- [x] Rate limiting (`@nestjs/throttler`)
- [x] API versioning via `/api/v1` global prefix
- [x] Health/readiness endpoints (`/api/v1/health`, `/api/v1/health/ready`) — readiness
      executes a real `SELECT 1` against PostgreSQL through Prisma
- [x] Swagger/OpenAPI docs at `/api/docs` (non-production only)
- [x] Frontend → API connectivity: Pinia store calls both health endpoints on load and
      renders live status; CORS verified working for the Vite dev origin
- [x] Netlify deployment config (`apps/web/netlify.toml`): SPA redirects + security
      headers
- [x] Unit + e2e tests passing on both apps (backend Jest, frontend Vitest)
- [ ] CI pipeline (GitHub Actions) — deferred; no remote Git host configured in this
      environment to run it against
- [ ] Verified against a **real** Neon database (this environment provisioned a local
      PostgreSQL 16 container via Docker as a stand-in — see ARCHITECTURE.md
      "Verification Notes"; switching to Neon is a connection-string-only change)

### Notable engineering decisions made during this phase
- Pinned **NestJS to the 11.x line** (not the just-released 12.x) because
  `@nestjs/throttler` and other ecosystem packages had not yet published Nest
  12-compatible releases at implementation time — 12.x would have blocked rate
  limiting entirely.
- Pinned **Prisma to 6.19.3** (not 7.x) because Prisma 7 removed `datasource url`/
  `directUrl` from `schema.prisma` in favor of a new `prisma.config.ts` + driver-adapter
  model — a breaking change too new and undocumented-in-the-wild to build a
  "production-grade" system on yet.
- Pinned **`@nestjs/config` to 4.0.4** (not the new 12.x release) because that release
  ships as ESM-only (`"type": "module"`), which breaks Jest's default CommonJS test
  runner.
- These are documented here, not hidden, per the standing instruction never to claim
  something works without verifying it — each pin was chosen after a real dependency
  conflict was hit and reproduced, not preemptively.

## Phase 2 — IAM ✅ (verified locally; see caveats below)
- [x] Schema: `organizations`, `departments`, `roles`, `permissions`, `role_permissions`,
      `user_roles`, `users`, `devices`, `sessions`, `mfa_methods`, `api_keys`,
      `digital_identities`, `security_events` — migrated and verified against local
      PostgreSQL
- [x] Argon2id password hashing (native binding verified working)
- [x] JWT access tokens (15m default) carrying roles + flattened permissions
- [x] Rotating refresh tokens: opaque, stored **hashed only** (SHA-256) in `sessions`,
      httpOnly/SameSite=Lax cookie scoped to `/api/v1/auth`
- [x] Refresh-token reuse detection: presenting an already-rotated token revokes the
      entire session chain (verified via e2e test — both the old and the token that
      replaced it are rejected afterward)
- [x] Account lockout after N failed logins (configurable threshold/duration, default
      5 / 15m) — verified end-to-end
- [x] MFA: TOTP (otplib) with encrypted-at-rest secrets (AES-256-GCM,
      `packages/crypto`) + one-time-use backup codes — full setup→enable→login flow
      verified live (real computed TOTP codes, real backup-code consumption)
- [x] RBAC: `@RequirePermissions()` + global `PermissionsGuard`; `@Public()` opt-out on
      a fail-closed global `JwtAuthGuard` (Zero Trust — every route requires auth unless
      explicitly excepted)
- [x] Security event logging (append-only `security_events`; no UPDATE/DELETE issued
      against it anywhere in the codebase)
- [x] `GET/POST /api/v1/users`, `/api/v1/roles`, `/api/v1/organizations` with
      permission-gated access
- [x] Seed script (`packages/database/prisma/seed.ts`): baseline permissions, all 15
      spec roles, one demo Super Administrator and one demo Auditor — clearly labeled
      DEMO/TEST
- [x] Frontend: login view (credentials → optional MFA challenge step), Pinia auth
      store (in-memory access token only — never localStorage), silent session restore
      via the refresh cookie on app boot, automatic one-shot 401→refresh→retry, route
      guard on protected views, logout wired into the app shell
- [x] e2e coverage: unauthenticated rejection, unknown-email/wrong-password rejection,
      successful login + permission-carrying JWT, RBAC allow and deny, refresh rotation
      + reuse detection (both legs), account lockout — 8 new tests, all passing against
      real PostgreSQL
- [ ] `ApiKey` and `DigitalIdentity` tables exist (per the DATABASE.md Phase 2 table
      list) but have no service/endpoint yet — API keys have no issuing flow, and
      `DigitalIdentity` is intentionally inert scaffolding for Phase 3's signing
      abstraction
- [ ] Forced password change on first login is not enforced (admin sets the initial
      password directly; no email/invite infrastructure exists yet)
- [ ] ABAC (department/threshold/jurisdiction-scoped authorization) is not implemented
      — only role-based permission checks exist so far. Layered on top once a module
      that needs it (budget thresholds, procurement stage) exists, per ARCHITECTURE.md

### Notable engineering decisions made during this phase
- Pinned **`@nestjs/jwt` to 11.0.2 and `@nestjs/passport` to 11.0.5** (not their new
  12.x releases) — same ESM-only-breaks-Jest problem as `@nestjs/config` in Phase 1.
- Pinned **`otplib` to 12.0.1** (not the new 13.x rewrite) — v13 replaced the classic
  `authenticator.generateSecret()/generate()/check()/keyuri()` API entirely with a new
  async, plugin-based one; v12 is the version every current TOTP tutorial and this
  codebase's own tests assume.
- Added a real **build step to `packages/crypto`** (tsc → `dist/`, package.json `main`
  pointing at compiled output) after discovering Node 24's native TypeScript
  type-stripping does not reliably resolve extensionless relative imports across
  multiple `.ts` files reached via `require()` from a workspace package — `dist`-based
  resolution is the standard, robust pattern and was applied here instead of chasing
  the native-TS loader further. `packages/database`'s single-hop `src/index.ts` (which
  immediately delegates to Prisma's own compiled output) was left as-is since it does
  not hit this problem.
- Refresh-token **reuse detection revokes the entire session chain**, including the
  token that replaced the reused one — not just the reused token itself. This is
  deliberately more aggressive than the minimum (reject only the reused token): if a
  refresh token was stolen and used by an attacker, the legitimate user's own
  newly-rotated token must not remain trusted either, since chain membership is now
  suspect.
- MFA challenge tokens are short-lived (5 minutes), separate-purpose signed JWTs (not
  full sessions) — a user who fails MFA never receives any session-capable credential.

## Phase 3 — Immutable Audit ✅ (verified locally; see caveats below)
- [x] `audit_events` table: UUID `id` + a real `bigserial` `sequence` for strict total
      ordering, hash chain (`previousHash`/`currentHash`), Ed25519 signature +
      `signatureKeyId`, actor/resource/payload fields, `blockchainTxRef` (nullable,
      populated in Phase 4)
- [x] Hash chain formula per section 7:
      `currentHash = SHA256(previousHash + payloadHash + timestamp + actorId)`
- [x] Every event digitally signed (Ed25519, application-managed key in env,
      architected to be replaced by a PKI/HSM key later without callers changing —
      `packages/crypto/src/signing.ts`)
- [x] Concurrency-safe appends: a Postgres advisory transaction lock
      (`pg_advisory_xact_lock`) serializes the read-latest→compute→insert sequence so
      concurrent requests (including from separate processes) cannot fork the chain —
      stress-tested with 25 genuinely concurrent requests, chain remained valid
- [x] `AuditService.verifyChain()` / `verifyEvent()`: walks the chain recomputing
      payload hash, chain link, current hash, and signature; reports exactly where and
      why it breaks
- [x] `GET /api/v1/audit/events`, `/api/v1/audit/events/:id`, `/api/v1/audit/verify`,
      `/api/v1/audit/events/:id/verify` — all gated on a new `audit:read` permission
- [x] Wired into two real event sources: `USER_CREATED` (IAM) and
      `AUTHORIZATION_DENIED` (a `PermissionsGuard` denial — section 7's "authorization
      failures" — audited distinctly from routine `security_events` auth telemetry,
      see SECURITY.md for the split's rationale)
- [x] e2e coverage: permission-gated access (and that the denial itself is audited),
      append-on-create, whole-chain verification, single-event verification, and —
      the actual point of a tamper-evident ledger — **direct SQL tampering with a row,
      bypassing the application entirely, is detected** by `/audit/verify`
- [ ] No business modules exist yet to generate procurement/financial audit events
      (budget, contract, payment, etc.) — those wire in as each owning phase ships,
      per DATABASE.md's phased approach
- [ ] Blockchain anchoring (`blockchainTxRef`) is schema-ready but unpopulated —
      Phase 4's job

### Two real bugs found and fixed during this phase (not just engineering-decision pins)
Both were caught by testing against a real, running Postgres instance rather than
trusting the design on paper — see THREAT_MODEL.md Phase 3 for the full detail:
1. **`jsonb` does not preserve object key order on round-trip** (documented Postgres
   behavior). Hashing `JSON.stringify(payload)` directly made `payloadHash` legitimately
   unstable between write and verify even with zero tampering. Fixed with a canonical
   (recursively key-sorted) JSON serialization used identically at both write and
   verify time.
2. **The hash formula included the live, mutable `actorId` foreign-key column**, which
   NestJS/Prisma's `onDelete: SetNull` legitimately nulls out when the referenced
   `User` is later deleted — an entirely normal operation elsewhere in the system. Any
   such deletion would have permanently "broken" every audit event that user ever
   produced, even though nothing was actually tampered with. Fixed by adding
   `actorIdSnapshot` — a plain string field, not a foreign key, frozen at write time —
   and hashing/verifying from that instead of the live relation column.

Both were reproduced with a real test (parallel Jest runs across accumulated state,
and a user-deletion cleanup step in a test's `afterAll`), root-caused by direct SQL
inspection of the broken chain rather than guessed at, and re-verified fixed with 5
consecutive clean runs of the exact reproduction scenario plus a 25-way concurrency
stress test.

## Phase 4 — Blockchain Integrity Layer ✅ (verified locally; see caveats below)
- [x] `BlockchainAdapter` interface (`packages/blockchain`, pure TypeScript, no
      framework/DB dependency) per section 54: `recordEvent`, `anchorHash`,
      `verifyTransaction`, `getTransaction`, `getBlock`, `healthCheck`
- [x] `DevelopmentLedgerAdapter`: a self-contained, hash-chained ledger simulation
      stored in PostgreSQL (`blockchain_transactions`, `blockchain_anchors`) — no
      external network. Reuses the exact advisory-lock chain-safety pattern proven in
      Phase 3 (a distinct lock key; a logically independent chain)
- [x] Periodic anchoring job (`AnchoringService`, `@nestjs/schedule`) that rolls up
      not-yet-anchored `audit_events` into one blockchain transaction/block, on a
      configurable interval (`BLOCKCHAIN_ANCHOR_INTERVAL_SECONDS`, default 60s) —
      plus `POST /api/v1/blockchain/anchor` to trigger a run on demand (both paths
      share one code path, `AnchoringService.runOnce()`)
- [x] `GET /api/v1/blockchain/health`, `/transactions/:id`, `/transactions/:id/verify`,
      `/blocks/:id` — gated on new `blockchain:read`/`blockchain:anchor` permissions
- [x] `GET /api/v1/audit/events/:id/verify` now composes the audit chain's own
      verification with the blockchain anchor's verification (section 55's full
      "transaction reconstruction" checklist) — composed at the controller layer, not
      inside either service, keeping `AuditService` and the blockchain adapter
      independent of each other (see ARCHITECTURE.md § Blockchain vs. Database)
- [x] `BlockchainModule` registered `@Global()` (like `PrismaModule`) specifically to
      avoid a circular module dependency: `AnchoringService` needs `AuditService`
      (Blockchain → Audit), and `AuditController` needs the adapter token to compose
      verification (Audit → Blockchain) — global registration breaks the cycle without
      `forwardRef()`
- [x] e2e coverage: permission-gated access, health check, a real anchoring run against
      a real audit event with before/after composed verification, an idempotency check
      (an already-anchored event is never re-anchored or overwritten by a later run),
      direct-transaction verification, and — the actual point of this layer — **direct
      SQL tampering with a block's root hash is detected** via `chainLinkValid: false`
- [x] Concurrency-stress-verified: 10 genuinely concurrent manual anchor triggers
      against 20 pending events — exactly one run performed the anchor (`anchoredCount:
      20`), the other nine correctly no-op'd, ledger ended at exactly 1 block / 1
      transaction (no forking)
- [ ] Only the development ledger adapter exists — `PermissionedBlockchainAdapter`
      (Hyperledger Fabric/Besu) is future work; the interface is deliberately already
      shaped for it
- [ ] No business-module events flow into the ledger yet (only the audit-anchor rollup)
      — business event types (`BudgetAllocated`, `TenderAwarded`, ...) per section 17
      arrive with their owning phases

### Two real timing/isolation bugs caught by testing, not designed around
1. **The scheduled anchoring job's elapsed-time gate started counting from epoch 0**
   (`lastRunAt = 0`), so the very first 5-second tick after any process boot always
   computed `Date.now() - 0 ≫ intervalMs` and fired an anchoring run immediately —
   surprising in production (an expensive job firing the instant a fresh instance
   starts) and, in tests, capable of racing a manual trigger for the same events.
   Fixed by initializing `lastRunAt = Date.now()` at construction so the countdown
   starts from boot, not epoch zero.
2. **An e2e test asserted an exact global `anchoredCount: 0`** for "nothing new to
   anchor," which is a false assumption under Jest's parallel-worker test execution:
   other e2e spec files run concurrently against the same shared database and
   legitimately generate their own unrelated audit events in the same window. Caught
   via a genuinely flaky run (1 failure in 5), root-caused by inspecting what the
   actual count was rather than dismissing it as a fluke, and fixed by rewriting the
   test to check the real invariant that matters — an already-anchored event's
   `blockchainTxRef` is never changed by a later run — rather than a global count this
   test file doesn't exclusively own. Re-verified with 8 consecutive clean runs plus a
   5-run accumulated-state stress pass.

## Phase 5 — Budget Management ✅ (verified locally; see caveats below)
- [x] Schema: `fiscal_years`, `budgets` (Prisma model `BudgetPlan`), `budget_lines`,
      `allocations`, `commitments`, `expenditures`, `budget_adjustments` — matching the
      table list promised in DATABASE.md since Phase 0
- [x] Budget lifecycle state machine: DRAFT → PENDING_APPROVAL → APPROVED | REJECTED,
      strictly enforced (cannot approve a DRAFT directly, cannot submit/approve twice)
- [x] Approving a budget atomically creates one `Allocation` per `BudgetLine` — the
      "Digital Budget Entitlement" of section 10 — each individually audited
      (`ALLOCATION_CREATED`)
- [x] Commitment-control accounting on every `Allocation`: authorized/committed/spent
      running balances, enforced with a `SELECT ... FOR UPDATE` row lock inside every
      balance-changing transaction (create/release commitment, record expenditure,
      approve adjustment) plus a DB `CHECK` constraint
      (`committed + spent <= authorized`) as a defense-in-depth backstop
- [x] Full workflow implemented: create budget → submit → approve → allocate → commit
      → (partially) spend → adjust, all wired to real `GET/POST /api/v1/{fiscal-years,
      budgets, allocations, commitments, adjustments}` endpoints, gated on 7 new
      `budget:*` permissions
- [x] Every state-changing action writes a real audit event via the Phase 3
      `AuditService` (`BUDGET_CREATED`, `BUDGET_SUBMITTED`, `BUDGET_APPROVED`,
      `BUDGET_REJECTED`, `ALLOCATION_CREATED`, `COMMITMENT_CREATED`,
      `COMMITMENT_RELEASED`, `EXPENDITURE_RECORDED`, `BUDGET_ADJUSTMENT_REQUESTED`,
      `BUDGET_ADJUSTMENT_APPROVED`, `BUDGET_ADJUSTMENT_REJECTED`) — the first time
      Phases 2–4's infrastructure is exercised by real business logic rather than IAM
      housekeeping, confirmed live: a full budget→commit→spend→adjust run produced
      exactly the expected 8-event audit trail, verified against the running chain
- [x] e2e coverage: permission gating, the full create→submit→approve→allocate
      workflow with negative tests at every illegal state transition, commitment/
      expenditure ceiling enforcement (over-commit rejected 409, over-spend rejected
      400, partial expenditure correctly frees the unused remainder), a DECREASE
      adjustment that would cut below already-spent correctly rejected, and — the
      actual point of commitment-control accounting — **a 10-way concurrent
      commitment stress test against a fixed-size allocation**: exactly 5 of 10
      requests succeeded (200/1000 exhausted exactly), the other 5 correctly rejected,
      final committed amount exactly matched the ceiling with zero overshoot
- [x] Frontend: a Budgets view (fiscal year + budget creation with dynamic line rows,
      submit/approve/reject actions, allocation balances with an inline commit form),
      gated on `budget:read`/`budget:create`/`budget:approve`/`budget:commit`
- [ ] "Double-entry accounting principles" is satisfied as commitment-control
      accounting (every transition atomically moves an amount between exactly one
      bucket to another — see schema.prisma comment) — not a full double-entry ledger
      with a chart of accounts. Documented as a deliberate scope decision, not an
      oversight.
- [ ] Vote/Program/SubProgram (section 9) are plain classification fields on
      `BudgetLine`, not normalized tables — another deliberate scope decision (see
      schema.prisma comment)
- [ ] Expenditure references a Commitment directly; Phase 9's Invoices will become the
      real trigger for expenditure once Procurement/Contracts exist. No partial-
      commitment tracking across multiple expenditures yet (one expenditure fully
      closes its commitment; any unused remainder is simply released)
- [ ] No policy engine yet (section 52) — approval permissions are fixed RBAC, not
      configurable amount-based thresholds. Multi-signature approval (section 18) is
      single-approver for now; both are candidates for a policy-engine pass once a
      second module (procurement) needs the same configurable-threshold pattern,
      rather than building it speculatively for budget alone

## Phase 6 — Procurement ✅ (verified locally; see caveats below)
Full procurement bid lifecycle state machine implemented: plan → request → tender →
bids → evaluation → award (contract/PO/delivery/inspection/invoice/payment are Phase 9).

- Schema (`packages/database/prisma/schema.prisma`): 8 new tables — `Supplier`,
  `ProcurementPlan`, `ProcurementRequest` (references an `Allocation` and, once
  approved, a `Commitment`), `Tender`, `TenderLot`, `Bid`, `BidEvaluation`, `Award`.
  `Award.tenderLotId` and `Award.bidId` are both `@unique`; `Bid` has
  `@@unique([tenderLotId, supplierId])`.
- Backend (`apps/api/src/modules/procurement/**`): `SuppliersService`,
  `ProcurementPlansService`, `ProcurementRequestsService`, `TendersService`,
  `BidsService`, each with a corresponding controller, all guarded by
  `procurement:read`/`create`/`manage`/`approve`/`publish`/`bid`/`evaluate`/`award`
  permissions. `ProcurementModule` imports `BudgetModule` to reuse
  `AllocationsService.createCommitment()` directly.
- Every state-changing action writes a real audit event via `AuditService.append()`
  (plan/request/tender/bid create, submit, approve, reject, publish, close, cancel,
  evaluate, award) — the second business module, after budget, to exercise Phase 3's
  audit infrastructure for real actions.
- Frontend (`apps/web`): `stores/procurement.ts` (Pinia) and `views/ProcurementView.vue`
  — suppliers, procurement plans, procurement requests (with allocation picker),
  tenders with nested lot creation, and per-lot bid submission/evaluation/award UI, all
  permission-gated the same way `BudgetsView.vue` is. `/procurement` route added
  (`procurement:read`-gated) and a nav link added to `App.vue`.
- Seed data (`packages/database/prisma/seed.ts`): 8 new `procurement:*` permissions,
  granted to the roles the spec assigns them to (Procurement Officer, Engineer,
  Supplier, Approving Officer, and existing admin-type roles).

**Notable engineering decisions:**
- **Reused Phase 5's `AllocationsService` directly rather than duplicating its
  row-locked commitment logic.** `BudgetModule` now `exports: [AllocationsService]` and
  `ProcurementModule` imports `BudgetModule`; approving a `ProcurementRequest` calls
  `allocationsService.createCommitment()` verbatim, so procurement inherits Phase 5's
  already-verified "cannot overcommit an allocation" safety property instead of being a
  second place that same class of bug could be introduced. This works as a plain
  one-directional module import (no `@Global()` needed) because, unlike Audit↔
  Blockchain in Phase 4, there's no cycle — only Procurement depends on Budget, not the
  reverse.
- **A third concurrency-safety pattern, chosen deliberately by problem shape.** Phase 3/4
  used Postgres advisory locks (serialize "read-latest-then-append" chain writes);
  Phase 5 used `SELECT ... FOR UPDATE` row locks (guard one identified row's running
  balance). Phase 6's award step is neither — it's "create exactly once" — so it's
  enforced with plain DB unique constraints (`Award.tenderLotId`, `Award.bidId`) and a
  caught `P2002` mapped to `409`. No lock was needed at all. Verified under a genuine
  5-way concurrent award-attempt stress test: exactly one `Award` created, the other
  four requests correctly rejected with `409`. See DATABASE.md § 4 Conventions for all
  three patterns documented side by side.
- **`Prisma`-namespace enum import trap recurred a third time.** `ProcurementRequestStatus`
  and `TenderStatus` are top-level Prisma-generated exports, not members of the
  `Prisma` namespace (same class of error as Phase 5's `BudgetStatus`) — fixed the same
  way, by exporting them by name from `packages/database/src/index.ts` and importing
  them directly rather than via `Prisma.`.
- **Two rounds of missing back-relation fields** (`Allocation.procurementRequests`,
  plus the usual `Organization`/`FiscalYear`/`User`/`Commitment` back-relations) were
  needed before `prisma migrate dev` would validate the schema — consistent with the
  same error class hit in every phase that's added a new FK-heavy model set.
- No real bugs were found during Phase 6 stress testing (unlike Phases 3–4) — the
  11-run stability-stress pass (6 accumulated-state + 5 fresh-truncate) came back
  clean on the first attempt, which is read as the concurrency-pattern-selection
  discipline from Phases 3–5 paying off rather than as a reason to test less
  rigorously in future phases.

## Phase 7 — Supplier Management ✅ (verified locally; see caveats below)
Supplier profiles, ownership, compliance, documents, risk profiles, RBAC-gated visibility.

- Schema (`packages/database/prisma/schema.prisma`): extends the `Supplier` table
  Phase 6 created (not a second supplier concept) with `businessType`,
  `taxIdentifier`, `physicalAddress`, `county`, `contactPersonName`, plus 3 new
  tables — `SupplierOwner` (beneficial ownership, including an
  `isPoliticallyExposedPerson` flag), `SupplierDocument` (compliance documents —
  SHA-256 hash + metadata only, see below), `SupplierRiskProfile` (append-only
  manual risk assessments, detector-agnostic `factors` JSON so Phase 8 can write
  the same shape). DB `CHECK` constraints bound `ownershipPercentage` and `score`
  to 0-100 per row (raw-SQL follow-up migration, same pattern as Phase 5's
  `allocations_balance_check`).
- Backend (`apps/api/src/modules/supplier/**`, a new module — deliberately NOT
  importing ProcurementModule; it only needs a one-line supplierId existence
  check, not real shared business logic): `SupplierProfileService` (profile
  update + ACTIVE/SUSPENDED/BLACKLISTED transitions), `SupplierOwnersService`
  (add/list/remove with an application-layer 100%-total check),
  `SupplierDocumentsService` (server-side SHA-256 hashing via a new
  `sha256HexBuffer` in `packages/crypto`, verify/reject), `SupplierRiskService`
  (record/current/history). New permissions: `supplier:read`,
  `supplier:read_sensitive` (owners/documents/risk profile — the RBAC-gated
  visibility the phase name promises), `supplier:manage`, `supplier:verify`.
- Real integration with Phase 6, not just a new enum value: `BidsService.submit()`
  already rejected bids from a non-ACTIVE supplier since Phase 6 — that check was
  previously unreachable dead code because nothing ever set a supplier to
  SUSPENDED/BLACKLISTED. Phase 7's suspend/blacklist endpoints make it live;
  verified end-to-end (suspend → bid rejected with the existing message → a
  different ACTIVE supplier bidding on the same lot is unaffected).
- Every mutation writes a real audit event (profile update, suspend/reactivate/
  blacklist, owner add/remove, document upload/verify/reject, risk assessment).
- Frontend (`apps/web`): `stores/supplier.ts` and a new `views/SupplierDetailView.vue`
  reached via `/suppliers/:id` (linked from each supplier chip in
  `ProcurementView.vue`) — profile view/edit, status-transition buttons, owner
  disclosure list/add/remove, document upload (client reads the file, converts to
  base64, server computes the hash) with verify/reject, and risk profile
  current+history+record, each section gated on `supplier:read_sensitive` /
  `:manage` / `:verify` exactly like the backend routes. Added `apiPatch` to the
  frontend API client (only `apiGet`/`apiPost` existed before this phase needed one).

**Notable engineering decisions:**
- **Deliberately did not import ProcurementModule into the new SupplierModule.**
  Unlike Phase 6's real reuse of `AllocationsService.createCommitment()` (genuine
  row-locked business logic worth not duplicating), the only thing the new module
  needs from Phase 6 is "does this supplierId exist" — a one-line Prisma lookup,
  which isn't enough shared logic to justify a cross-module dependency. Kept the
  two modules independent instead.
- **A fourth "shape" for a known concurrency problem, but this time deliberately
  left unguarded.** Phases 3-4 used advisory locks, Phase 5 row locks, Phase 6 a
  unique constraint; Phase 7's "total beneficial ownership ≤ 100%" is a real
  cross-row invariant a lock could enforce, but — unlike a financial balance —
  it's low-stakes and low-concurrency (one procurement officer disclosing one
  supplier's owners, not concurrent public traffic), so it was left as an
  application-layer check only, with the gap **proven, not just asserted**: a new
  e2e test fires 3 concurrent 70% owner-adds and asserts more than one can
  succeed, pushing the recorded total past 100%. Documented in DATABASE.md,
  SECURITY.md, and THREAT_MODEL.md rather than silently left inconsistent with
  the CHECK-constraint pattern used everywhere else.
- **Only a document's SHA-256 hash and metadata are stored, never the file
  bytes** — no object storage backend exists yet in this codebase (Phase 10's
  evidence vault is where that gets built). The hash is computed **server-side**
  from the submitted content (`sha256HexBuffer`, added to `packages/crypto`),
  not trusted from the client — verified against `sha256sum` on the same bytes
  during manual smoke testing before the automated test was written.
- **A one-way BLACKLISTED status, by design.** `suspend`→`reactivate` is
  reversible; `blacklist` is not exposed with any reactivate path in this phase
  — deliberately, pending the same multi-signature/policy-engine work already
  deferred for budget/procurement approval (sections 52/18), rather than letting
  a single actor both blacklist and un-blacklist a supplier alone.
- **A real, pre-existing bug found in Phase 4's test suite during this phase's
  stress-testing pass**, not introduced by this phase: `blockchain.e2e-spec.ts`
  created a test user with a fixed, non-unique email and only cleaned it up
  inline (not in `afterAll`), so any interrupted run left an orphaned row that
  then permanently 409'd every future run — reproduced deterministically across
  5 accumulated-state stress runs, root-caused (confirmed no FK constraint was
  involved by deleting the orphan directly), and fixed by making the email
  unique per run, matching the convention `procurement.e2e-spec.ts` already
  used. Re-verified clean across 6 accumulated + 5 fresh-truncate runs
  afterward — this is exactly the kind of bug the project's repeated-stress-run
  methodology (adopted after Phases 3-4's real bugs) exists to catch, even in
  code untouched by the current phase.

## Phase 8 — AI Risk Engine ✅ (verified locally; see caveats below)
Four deterministic/statistical detectors (price anomaly, bid collusion, split
procurement, supplier risk), a shared alert sink + review workflow, human-review gate
before any adverse action. **Duplicate invoice detection is explicitly deferred to
Phase 9** — there is no `Invoice` entity yet for it to run against; building a stub
against nonexistent data was rejected in favor of an honest gap (see schema.prisma
comment on `SupplierRiskProfile` and `RiskAlert` for how Phase 9 slots in later without
a schema change).

- Schema (`packages/database/prisma/schema.prisma`): one new table, `RiskAlert`
  (`detectorType`, `severity`, polymorphic `resourceType`/`resourceId` — the same loose
  string-reference pattern `AuditEvent` already uses — `evidence` JSON, and a
  `status`/`reviewedById`/`reviewedAt`/`reviewNotes` review workflow). Deliberately did
  **not** build the `risk_scores`/`ai_decisions` tables DATABASE.md's original roadmap
  sketch anticipated: resource-level risk scores are written into Phase 7's existing
  `SupplierRiskProfile` (deliberately detector-agnostic for exactly this reuse), and
  detector-run logging was judged not to need a second parallel audit mechanism
  alongside Phase 3's `AuditEvent` — a plan adjusted with better information, not
  followed blindly, and documented as such rather than silently diverging.
- Backend (`apps/api/src/modules/risk/**`, a new module with no dependency on
  ProcurementModule or SupplierModule — it only ever reads raw data via Prisma):
  `PriceAnomalyDetector`, `BidCollusionDetector`, `SplitProcurementDetector`,
  `SupplierRiskDetector`, all writing through one shared `RiskAlertsService.raiseAlert()`
  sink with duplicate-alert suppression; `RiskScansService`/`RiskScansController` for
  on-demand re-scans (mirrors the blockchain module's manual `/anchor` trigger). New
  permissions: `risk:read`, `risk:review`, `risk:manage`.
- Real trigger integration, not standalone detectors nobody calls:
  `TendersService.close()` now runs price-anomaly + bid-collusion across every lot;
  `ProcurementRequestsService.approve()` runs split-procurement for the request's
  organization; `SupplierOwnersService.add()` (when the owner is a PEP),
  `SupplierDocumentsService.reject()`, and `SupplierProfileService.suspend()` /
  `reactivate()` / `blacklist()` all re-run the supplier-risk detector. Every detector
  call is wrapped so it can never fail or block the action that triggered it.
- Frontend (`apps/web`): `stores/risk.ts` and `views/RiskAlertsView.vue` at
  `/risk-alerts` — filterable alert list with expandable evidence, a review workflow
  gated on `risk:review`, and a manual-scan form gated on `risk:manage`. Added an
  `apiPatch`-style convenience wasn't needed here (all risk routes are GET/POST).
- Seed data (`packages/database/prisma/seed.ts`): 3 new `risk:*` permissions. **Not**
  granted symmetrically with the read/manage grants elsewhere —
  `risk:review` is deliberately withheld from Procurement Officer (see below).

**Notable engineering decisions:**
- **`risk:review` is deliberately withheld from the Procurement Officer role.** A
  Procurement Officer confirming or dismissing an alert about their own procurement
  actions would defeat the separation-of-duties principle the alert exists to support.
  Procurement Officer gets `risk:read` (see findings) and `risk:manage` (can trigger a
  re-scan) but not `risk:review` — reserved for Auditor/Internal Auditor and Approving
  Officer, independent-oversight roles. Verified with a dedicated e2e test proving the
  exclusion is actually enforced (403), not just documented in seed.ts.
- **Two real statistical bugs found and fixed during this phase's own manual smoke
  testing**, before either reached the automated test suite:
  1. *Masking.* The first version of `PriceAnomalyDetector` scored each bid's z-score
     against the mean/stddev of **all** bids on the lot, itself included. A genuine
     $200,000 outlier next to three ~$990,000 bids scored only |z|≈1.7 — below the
     alert threshold — because the outlier inflated its own reference stddev enough to
     mask itself (a textbook masking effect, worse with small samples). Fixed by
     scoring each bid **leave-one-out**, against the mean/stddev of the *other* bids
     only.
  2. *Degenerate small-sample statistics.* With exactly 3 total bids, leave-one-out
     always leaves exactly 2 peers — and any 3-point set that's even roughly evenly
     spaced produces a leave-one-out z-score of **exactly ±3.0** for its two extreme
     points, regardless of how tight or wide the actual spread is (a pure arithmetic
     artifact of 2-point variance, proven algebraically, not a real anomaly signal).
     Found when a legitimately tight, ordinary-looking 3-bid set correctly triggered
     bid-collusion but *also* incorrectly triggered price-anomaly on the same data.
     Fixed by raising the minimum-bids-for-z-score threshold from 3 to 4 (guaranteeing
     ≥3 peers) and falling back to the simpler estimate-deviation heuristic below that.
     Both fixes are now encoded as permanent regression tests in `risk.e2e-spec.ts`,
     not just prose — see Tests below.
- **A real pre-existing Phase 4 bug found via this phase's stress-testing, fixed in
  place.** `AnchoringService.runOnce()` used a boolean `running` flag: a caller arriving
  while a run was already in flight got an immediate `{anchoredCount: 0}` rather than
  the real result, even though genuine anchoring was happening concurrently. Fixed by
  replacing the flag with the in-flight run's own `Promise`, so a concurrent caller
  awaits and returns the same real result instead of a misleading zero. Found because
  `blockchain.e2e-spec.ts` started failing intermittently under Phase 8's own repeated
  full-suite stress-testing pass — not something Phase 8 introduced, but real and worth
  fixing now that it surfaced (same "fix it because it's real, regardless of which
  phase's testing found it" precedent set in Phase 7 for a different Phase 4 test bug).
- **A related, non-bug finding that still needed a test fix.** `POST /blockchain/anchor`
  anchors the globally oldest `BLOCKCHAIN_ANCHOR_BATCH_SIZE` unanchored events, not
  specifically one caller's own event — by design. Under this suite's full parallel
  run (8 spec files now, each writing its own audit events to the same shared table),
  a single manual anchor call is not guaranteed to reach any one specific event within
  one batch. `blockchain.e2e-spec.ts`'s "anchors a real audit event" test assumed one
  call always sufficed; fixed by polling (bounded retries) until the target is
  confirmed anchored, matching how the scheduled interval job actually catches up a
  backlog in production rather than asserting a single-call guarantee that was never
  actually true at this scale.
- Also traced an earlier apparent flakiness spike to an **unrelated leftover dev server**
  left running in the background from this phase's own manual smoke-testing session
  (with its own long-lived `AnchoringService` interval timer competing against the test
  runs) — killed it and re-verified from a clean process state. A reminder that manual
  smoke-testing servers should be stopped before relying on stress-test results, not a
  code defect.

## Phase 9 — Contracts, Invoices & Payments ✅ (verified locally; see caveats below)
Contracts, purchase orders, invoices, multi-signature payment approvals, payment
abstraction, idempotency, reconciliation.

- Schema (`packages/database/prisma/schema.prisma`): 7 new tables —
  `Contract` (one per `Award`, `organizationId`/`allocationId`/`commitmentId`/
  `supplierId` all derived server-side from the award's own chain, never client
  input), `PurchaseOrder`, `Invoice` + `InvoiceItem`, `PaymentRequest`,
  `PaymentApproval` (`@@unique([paymentRequestId, approvedById])` — no double
  approval), `Payment` (`idempotencyKey` unique, `expenditureId` nullable —
  see below), `PaymentReconciliation`. Deliberately did **not** build a
  separate `ai_decisions`-style audit table for this phase (there wasn't one
  planned here) — every action already writes through Phase 3's `AuditService`.
- Backend (`apps/api/src/modules/contracts/**`, a new module importing
  BudgetModule to reuse `AllocationsService.createExpenditure()` directly —
  genuine shared business logic, the same reuse judgment Phase 6 made):
  `ContractsService`, `PurchaseOrdersService`, `InvoicesService`,
  `PaymentsService`. New permissions: `contract:read`/`manage`,
  `invoice:read`/`submit`/`verify`, `payment:read`/`approve`/`execute`/
  `reconcile`.
- Real integration, not a standalone module: `InvoicesService.verify()`
  auto-creates a `PaymentRequest` (mirrors Phase 6's "approving a request
  auto-creates a Commitment" pattern); `PaymentsService.execute()` is the
  actual, real trigger — at last — for a budget `Expenditure` sourced from
  procurement, replacing Phase 5's placeholder direct-expenditure path for
  anything that flows through procurement (the direct path itself is
  untouched, still available for non-procurement budget execution).
- Multi-signature payment approval (section 18): `PaymentRequest.
  requiredApprovals` (default 2) distinct `PaymentApproval` rows with
  decision APPROVE before execution is allowed; any single REJECT rejects
  immediately. Self-approval is blocked (the actor who verified the invoice
  cannot also approve its payment) and `risk:review`-style separation of
  duties is mirrored in seed.ts: `payment:execute` (Treasury Officer) is
  granted to a different role than `payment:approve` (Accounting
  Officer/Approving Officer) — the role that disburses money is not one of
  the roles that voted to authorize it.
- Idempotency-Key-backed execution (SECURITY.md § Idempotency & Concurrency,
  deferred to exactly this phase): `POST /payment-requests/:id/execute`
  requires an `Idempotency-Key` header; a claim-then-work sequence (see
  schema.prisma comment on `Payment`) means a retried request after a
  dropped response returns the original result rather than disbursing twice.
- Frontend (`apps/web`): `stores/contracts.ts` and `views/ContractsView.vue`
  at `/contracts` — the full Contract → PO → Invoice → PaymentRequest
  (approve/execute) → Payment (reconcile) lifecycle, each action gated on
  its own permission. Added `headers` support to the frontend API client's
  `apiPost` (needed for the `Idempotency-Key` header — every prior phase's
  actions only needed a body).

**Notable engineering decisions:**
- **`Payment.expenditureId` is nullable, not required, by deliberate
  design.** The first version made it required and created the Expenditure
  before the Payment row — but that makes the idempotency claim happen
  *after* the real budget work, so a losing concurrent request (or genuine
  retry) could only be told "conflict" after budget state had already
  changed, and a crash between the two steps could leave a real Expenditure
  with no Payment ever recorded. Fixed by reordering to claim-then-work: the
  Payment row (with `expenditureId` still null) is created FIRST — the
  unique constraint on `idempotencyKey` is what atomically arbitrates a
  race, the same create-exactly-once judgment Phase 6 used for `Award`, just
  applied one step earlier than the actual side effect. Only the winner
  proceeds to call `AllocationsService.createExpenditure()` and then fills
  in `expenditureId`; if that step fails, the claim row is deleted so the
  key isn't permanently poisoned and a client can legitimately retry with a
  new key.
- **A deliberate, documented interaction with Phase 5's existing scope
  boundary, not a new limitation.** `Contract.commitmentId` is NOT unique —
  a multi-lot tender can produce several awards, several contracts, all
  sharing one originating `ProcurementRequest`'s commitment. Phase 5's
  `Expenditure.commitmentId` has always been `@unique` (documented then as
  "one expenditure fully closes its commitment, no partial tracking"). The
  consequence: only the first sibling contract's payment can successfully
  create an Expenditure against a shared commitment; a second gets
  `AllocationsService`'s own clear 400 ("Commitment is CONSUMED, not
  ACTIVE"), not a raw constraint error. Not fixed here — fixing it properly
  means partial-commitment tracking, an already-acknowledged Phase 5 gap,
  not a Phase 9 one.
- **Three real bugs found during this phase's own manual smoke testing and
  stress testing, all fixed before being reported as done:**
  1. *Idempotency replay ordered after the status guard.* The first version
     checked `paymentRequest.status !== 'APPROVED'` before checking for an
     existing Payment under the given idempotency key. Once a payment
     actually executes, status becomes `EXECUTED` — so a legitimate client
     retry (the *exact* scenario Idempotency-Key exists for: the first
     response was dropped, but it succeeded server-side) hit the status
     guard and got a 400 instead of the original result. Found manually
     within minutes of building the feature, before it ever reached
     automated tests. Fixed by checking for a replay first, unconditionally,
     before any status validation.
  2. *A test's own wrong assumption, caught by running it.* An e2e test for
     3 concurrent payment approvals initially asserted all 3 individually
     succeed. The row-locked implementation is actually stricter and more
     correct: once the 2nd approval reaches `requiredApprovals`, the request
     moves to APPROVED and a 3rd concurrent attempt correctly observes it's
     no longer PENDING and is rejected — the same "exactly the number that
     fit succeed, the rest correctly rejected" shape as Phase 5's allocation
     stress test and Phase 6's 5-way award race. The test's expectation was
     wrong, not the code; fixed the assertion, not the implementation.
  3. *Ambiguous unique-constraint error targets under genuine concurrency.*
     `Payment` has unique constraints on both `idempotencyKey` and
     `paymentRequestId`; under a genuine 5-way concurrent `execute()` stress
     test sharing one key, some losing requests were reported by Postgres/
     Prisma against `paymentRequestId` rather than `idempotencyKey` even
     though their key was identical — a target-based branch misclassified
     these as "different key" and wrongly returned 409 instead of the
     correct idempotent 200. Fixed by always checking directly for an
     existing row under the given key on any conflict, regardless of which
     constraint was reported. Both this and bug 2 above are now permanent
     regression tests in `contracts.e2e-spec.ts`.
- **A test-infrastructure lesson, not a product bug:** the first attempt at
  this phase's `afterAll()` cleanup deleted `userRole` rows before
  discovering `user.deleteMany()` fails on `PaymentApproval.approvedById`'s
  `onDelete: Restrict` (a deliberate design choice — approval history must
  survive a user's deletion in real usage) — silently leaving test users
  role-less for every subsequent run. Fixed by clearing `paymentApproval`
  rows for the test users before deleting them, matching the cleanup order
  every other e2e spec file's `afterAll()` already relies on.

## Phase 10 — Project Verification ✅ (verified locally; see caveats below)
Projects, milestones, inspections, evidence vault with SHA-256 hashing + blockchain
anchoring.

- Schema (`packages/database/prisma/schema.prisma`): 4 new tables — `Project`
  (one per `Contract`, `organizationId` derived server-side from the contract,
  never client input — the same anti-tampering judgment Phase 9 made for
  Contract's own budget-line fields), `Milestone`
  (`@@unique([projectId, sequenceNumber])`), `Inspection`, `ProjectEvidence`
  (`storageKey` unique, `fileHash`, `blockchainTxRef`).
- **The first real object storage backend in the codebase**, closing the
  "hash only, no bytes" gap documented since Phase 7. New `packages/storage`
  package (`ObjectStorageAdapter` interface, mirroring `packages/blockchain`'s
  exact structural pattern) and `FilesystemObjectStorageAdapter`
  (`apps/api/src/modules/storage/`) — a real local implementation that
  actually writes and reads encrypted bytes, not another hash-only
  placeholder. `StorageModule` is `@Global()` for the same DI-without-
  circular-imports reason as `BlockchainModule`. New binary-safe
  `encryptBuffer`/`decryptBuffer` primitives added to `packages/crypto`
  (the existing `encrypt`/`decrypt` only handle UTF-8 strings and would have
  silently corrupted raw binary evidence bytes if reused as-is — caught and
  fixed before ever being exercised).
- Backend (`apps/api/src/modules/projects/**`): `ProjectsService`,
  `MilestonesService`, `InspectionsService`, `EvidenceService`. New
  permissions: `project:read`/`manage`/`inspect`, `evidence:upload`.
- Separation of duties (section 18, continued from Phase 6/8/9): `project:manage`
  (Project Manager — marks milestones COMPLETED) vs `project:inspect`
  (Engineer — records PASSED/FAILED/NEEDS_REVISION); neither role can do the
  other's half of "mark done, then verify it was actually done."
  `Milestone.status` reaches `VERIFIED` only as a side effect of an
  Engineer's PASSED inspection — never self-declared — the same
  "verification is a consequence of an independent review action" pattern as
  Phase 6 (evaluate → award) and Phase 9 (verify → PaymentRequest).
  FAILED/NEEDS_REVISION sends the milestone back to IN_PROGRESS for rework
  rather than any kind of terminal rejection.
- Auto-completion: `ProjectsService.maybeMarkCompleted()` marks a project
  COMPLETED once every one of its milestones reaches VERIFIED — the same
  "auto-transition once every child reaches its terminal state" pattern as
  Phase 6's `TendersService.maybeMarkAwarded()`. Getting this genuinely
  correct (not just superficially working) required an additional guard not
  present in the Tender case — see "Notable engineering decisions" below.
- Evidence vault (section 40): SHA-256 hash computed server-side, file
  AES-256-GCM-encrypted and stored via the new adapter, hash anchored
  **immediately** on the blockchain (`blockchain.anchorHash()` called
  directly, not via the periodic `AuditService` rollup — each piece of
  evidence is independently significant enough to anchor on its own), and
  re-verified on every download (`hashVerified: boolean` in the response). A
  failed blockchain anchor never blocks evidence from being recorded — the
  same "a secondary integrity layer must never block the primary action"
  principle as the AI Risk Engine's detectors (Phase 8).
- Frontend (`apps/web`): `stores/projects.ts` and `views/ProjectsView.vue` at
  `/projects` — Project list/create/activate/suspend/resume/cancel, a
  selected-project detail panel for Milestones (add while PLANNED, start/
  complete, record inspections) and the Evidence Vault (upload, on-demand
  integrity verification via the download endpoint). File upload reuses
  Phase 7's `fileToBase64` pattern. Nav link and route gated on
  `project:read`.

**Notable engineering decisions:**
- **A real premature-auto-completion bug, found by this phase's own e2e
  suite, not by inspection.** The first version of `MilestonesService.create()`
  allowed adding milestones to a project in either `PLANNED` or
  `IN_PROGRESS` status — meaning a Project Manager could keep adding
  milestones after the project had already started. Combined with
  `maybeMarkCompleted()`'s "every *existing* milestone is VERIFIED" check,
  this meant a project with an intended 2 milestones would auto-complete
  after the *first* one was verified, simply because the second hadn't been
  created yet at that moment — "every milestone verified" was trivially true
  over a set of one. `TendersService.maybeMarkAwarded()` never has this
  problem because tender lots are fixed once the tender is `CLOSED`, strictly
  before any lot can be awarded. Fixed by applying the identical gate to
  Projects: milestone creation is now restricted to `PLANNED` only, so
  `activate()` freezes the milestone list before any verification-driven
  auto-completion check can run — an e2e test now asserts both that the full
  milestone set auto-completes correctly and that adding a milestone after
  activation is rejected.
- **`ProjectsService.create()` was missing the unique-constraint→409
  translation that `MilestonesService.create()` already had for
  `sequenceNumber`.** `Project.contractId` is unique (one project per
  contract), but the first version let a second attempt fall through to a
  raw, unhandled Prisma `P2002` and a generic 500. Found during manual
  curl smoke-testing (re-running a test script against an already-used
  contract), fixed by catching `P2002` and returning a clear 409 — now
  matching the same pattern already established for milestones.
- **AES-256-GCM's auth tag genuinely catches ciphertext tampering at rest —
  but the first version crashed instead of reporting it cleanly.**
  `EvidenceService.download()`'s doc comment promised a mismatch would be
  reported via `hashVerified: false`, but that's only true for corruption
  that happens to still decrypt successfully. Manually corrupting a byte in
  the on-disk encrypted file (to test the tamper-detection path this phase's
  own design claims to provide) showed GCM's auth-tag verification correctly
  rejects the tampered ciphertext by throwing during decryption — before a
  hash comparison is even possible — which surfaced as a raw, unhandled 500.
  Fixed by catching a decryption failure and returning a clear 422
  ("Evidence integrity check failed… may have been corrupted or tampered
  with"). The two tamper-detection layers are now both exercised and both
  documented: GCM auth-tag failure (ciphertext tampering — decryption itself
  fails) and SHA-256 mismatch (`hashVerified: false` — decryption succeeds
  but the recomputed hash disagrees, e.g. if the recorded hash itself were
  altered). Both were manually verified end-to-end (corrupt the on-disk
  file; separately, swap the DB's recorded hash) before being written up as
  working, not just assumed from reading the code.

Manual live smoke-testing (curl, against the running dev server) exercised the
full Contract → Project → Milestone → Inspection → auto-completion chain, the
FAILED→rework→PASSED path, evidence upload with a real `sha256sum` cross-check
against the uploaded bytes, confirmation the on-disk file is genuinely
ciphertext (not plaintext) by inspection, and both tamper-detection paths
above — all three bugs above were found this way, before automated tests were
written, and are now permanent regressions in `projects.e2e-spec.ts` (13
tests, all passing). Full e2e suite (70 tests across 10 spec files) and full
monorepo build+lint pass cleanly; 11 repeated stability runs (6 accumulated +
5 with `audit_events`/`blockchain_transactions`/`blockchain_anchors` truncated
between runs) all pass with no flakiness observed.

## Phase 11 — Auditor Portal ✅ (verified locally; see caveats below)
Forensic dashboard, transaction reconstruction, audit-chain + blockchain verification UI.

- No schema changes — `AuditEvent.resourceType`/`resourceId` already carried
  everything needed (deliberately plain strings, not a foreign key, since
  Phase 3), and the `@@index([resourceType, resourceId])` needed for this
  phase's own filtering already existed too. This phase is pure backend-logic
  + frontend, the first phase since Phase 2 with zero migration.
- Backend (`apps/api/src/modules/audit/**`, extending the existing Phase 3
  module rather than a new one — there is no new business entity here, only
  a new way to query and compose the existing audit chain):
  `AuditService.list()` gained `resourceType`/`resourceId` filters (`GET
  /audit/events`), and a new `AuditService.reconstructResource()` (`GET
  /audit/reconstruct?resourceType=&resourceId=`) — "transaction
  reconstruction" (section 55): every audit event ever recorded against one
  specific resource, each **independently re-verified** by reusing the
  existing `verifyEvent()` (not a cheaper "trust the stored data" shortcut),
  with each event's blockchain anchor status composed in at the controller
  layer — the same composition-not-coupling pattern `events/:id/verify`
  already established in Phase 4 (`AuditController.withBlockchainAnchor()`,
  extracted from `verifyEvent()`'s inline logic so both endpoints share it).
  No new permission — gated on the existing `audit:read`, already restricted
  to Auditor/Internal Auditor/Super Administrator only.
- Frontend (`apps/web`): `AuditorPortalView.vue` at `/auditor-portal` — a
  resource-type/resource-ID search form that calls the reconstruction
  endpoint and renders a forensic case file: every event for that resource,
  each with its own 4-check breakdown (payload hash / chain link / current
  hash / signature) and blockchain anchor status, plus an overall
  fully-verified badge. Deliberately kept separate from the existing
  Phase 3 `AuditView.vue` (general browse + whole-chain integrity +
  blockchain health) rather than folding into it — the two serve different
  jobs (browse everything vs. deep-dive one case), and the existing view
  didn't need touching to add this.

**Notable engineering decisions:**
- **Chain-link validity is checked against the true global predecessor, not
  the previous event within the filtered subset — this is what makes
  reconstruction a real forensic tool rather than a curated highlight reel.**
  `reconstructResource()` doesn't recompute a fresh mini-chain over just the
  matched events; it calls the existing `verifyEvent(id)` for each one, which
  looks up that event's actual immediate predecessor by `sequence` across the
  *entire* audit trail. Manually verified: tampering with one event belonging
  to a resource, then reconstructing a *different, unrelated* resource in the
  same request window, correctly leaves the unrelated resource's
  `fullyVerified: true` — reconstruction isolates by resourceId as intended,
  it doesn't report "something somewhere is wrong" under every resource's
  name. This isolation property is now a permanent regression test in
  `audit.e2e-spec.ts`.
- **An empty result (`totalEvents: 0`) reports `fullyVerified: true` —
  vacuous truth over an empty set, deliberately not treated as an error.**
  A caller distinguishes "no history for this ID" from "history exists and
  verifies" via `totalEvents`, not by `fullyVerified` alone — the frontend
  renders a distinct "no events found" message rather than a green badge
  when `totalEvents === 0`.

Manual live smoke-testing (curl, against the running dev server) created a
real Project (Phase 10) and exercised the reconstruct endpoint against its
genuine multi-event history (create → activate → suspend), confirmed
`fullyVerified: true` with all four checks passing per event, then manually
corrupted one event's payload directly in the database and confirmed
`fullyVerified` correctly flipped to `false` with the tampered event's
`payloadHashValid`/`currentHashValid` both `false` — restored afterward.
Formal e2e coverage added to the existing `audit.e2e-spec.ts` (5 new tests:
resourceType/resourceId filtering scoped to exactly one resource; 400 without
both query params; 403 without `audit:read`; full reconstruction with every
check passing and a `blockchainAnchor` field always present; and the
tamper-isolation property above) — 9 tests total in that file, all passing.
Full e2e suite (74 tests across 10 spec files) and full monorepo build+lint
pass cleanly; 11 repeated stability runs (6 accumulated + 5 fresh-truncate)
all pass with no flakiness.

## Phase 12 — Citizen Transparency Portal ✅ (verified locally; see caveats below)
Public read-only search over projects/tenders/suppliers/budgets with privacy filtering
and public hash verification.

- No schema changes — every route reads existing tables through hand-written,
  privacy-filtered DTOs. The first phase to add a genuinely unauthenticated
  API surface: every `/public/*` route is decorated `@Public()` (the same
  mechanism `/auth/login` and `/health` already use to bypass the global
  `JwtAuthGuard`) and carries no `@RequirePermissions`, so `PermissionsGuard`'s
  existing "no requirement declared, allow through" default applies even with
  no `request.user` at all.
- New `apps/api/src/modules/transparency/` module: `TransparencyService` +
  `TransparencyController` (`@Controller('public')`). Routes: `GET
  /public/projects` (+ `/:id` detail with milestones and evidence hash
  summaries), `GET /public/tenders` (+ `/:id` detail with each lot's winning
  award), `GET /public/suppliers` (+ `/:id`), `GET /public/budgets` (sourced
  from `Allocation`, which only exists once its Budget is APPROVED — the
  mere existence of the row is already the "this is public record" gate, no
  separate status check needed), and `GET /public/verify?hash=` — the public
  hash-verification tool.
- **Every public DTO in `transparency.types.ts` is hand-written from scratch,
  never a re-export of an internal `*View` type** — a deliberate structural
  choice so an internal field (an actor's email, a supplier's tax ID, a
  losing bidder's amount) can never leak into a public response just because
  someone adds it to an internal type without thinking about this module.
  DRAFT tenders are excluded from both the list and detail views (not yet
  public knowledge); public supplier records show only
  name/registrationNumber/status/businessType/county, never
  email/phone/taxIdentifier/physicalAddress/contactPersonName or anything
  from `SupplierOwner` (beneficial ownership, PEP flag); tender detail shows
  only the winning award per lot (supplier name + amount), never losing-bid
  amounts or evaluation scores.
- The hash-verification endpoint composes three existing systems without
  exposing any of their internals: `ProjectEvidence.fileHash` lookup (Phase
  10), `AuditService.verifyEvent()` reused as-is against the evidence's own
  `EVIDENCE_UPLOADED` audit event to get a fresh `chainIntact` boolean (Phase
  3/11's already-proven logic, not reimplemented), and
  `BlockchainAdapter.verifyTransaction()` for anchor status (Phase 4) — but
  only booleans and public-safe metadata (file name, project name, milestone
  title) cross into the response; never the uploader's identity, the raw
  audit event, or the file content itself.
- Frontend (`apps/web`): `stores/transparency.ts` and a single tabbed
  `views/TransparencyView.vue` at `/transparency` (Projects / Tenders /
  Suppliers / Budgets / Verify a hash) — the first route in the app marked
  `meta: { public: true }` alongside `/login`, so the router's `beforeEach`
  guard never redirects an anonymous visitor to sign in. `App.vue`'s nav bar
  previously rendered nothing at all for a signed-out visitor
  (`<nav v-if="auth.isAuthenticated">`) — added a "Transparency Portal" link
  outside that block, always visible, since an anonymous citizen otherwise
  had no way to discover this page existed.

**Notable engineering decisions:**
- **No rate-limiting infrastructure was built for this phase.** The existing
  global `ThrottlerGuard` (registered as `APP_GUARD` in `app.module.ts` since
  Phase 1) runs ahead of route handlers regardless of authentication status,
  so it already protects `/public/*` the same as every other route — verified
  by reading the guard registration rather than assumed.
- **A real, honestly-diagnosed test-infrastructure issue, not a product bug:**
  this phase's own e2e runs (and, once isolated and checked, several
  *unrelated, untouched* spec files run purely as a control) intermittently
  failed with generic `beforeAll`/test-level "exceeded 5000ms" timeouts under
  heavy host CPU load (`/proc/loadavg` confirmed 11+ on a 4-core machine at
  the worst point, with swap nearly exhausted) — never a genuine assertion
  mismatch. Confirmed unrelated to this phase's code: the same unrelated,
  already-stable `iam.e2e-spec.ts` failed 8/8 under the same load and passed
  8/8 once load settled. Root cause was Jest's default 5000ms timeout being
  too tight for a real NestJS app + Prisma connection pool bootstrapping on a
  shared, variably-loaded sandbox rather than a dedicated CI runner — fixed
  by raising `testTimeout` to 20000ms in `test/jest-e2e.json` (a legitimate
  environmental calibration once the failure mode was confirmed to be pure
  timing, not logic, the same "fix the actual, verified cause" discipline as
  every other bug this project has fixed, not a blind workaround).
- A stray orphaned dev-server process from this phase's own earlier manual
  smoke-testing (`pkill -f "nest start --watch"` kills the wrapper but not
  the spawned `dist/main` child, and likewise for Vite's `sh -c vite`
  wrapper) was found still running and consuming CPU/DB connections during
  the exact window some of the flakiness above was observed — a real,
  if minor, contributor, cleaned up by killing the actual child PIDs
  directly rather than the wrapper command.

Manual live smoke-testing (curl, against the running dev server, with **no
Authorization header at all** on every call) exercised every `/public/*`
route: project/tender/supplier search and detail views with real fixture
data, `DRAFT` tender exclusion (flipping a real tender's status directly in
the database and confirming both the list and the `404` detail response),
hash verification's full happy path (uploading real evidence, verifying its
hash returns `found: true, anchored: true, chainIntact: true` with no
uploader identity in the response), and tamper detection (corrupting the
underlying audit event's payload directly in the database and watching
`chainIntact` flip to `false`, then restoring it and confirming it flips
back). All of this is now permanent regression coverage in
`transparency.e2e-spec.ts` (9 tests, all passing). Full e2e suite (83 tests
across 11 spec files) and full monorepo build+lint pass cleanly; the
stability ritual (6 accumulated + 5 fresh-truncate) passed 10 of 11 runs
cleanly after the `testTimeout` fix (the one remaining failure occurred
immediately after a burst of local build/lint activity and was confirmed,
via isolated re-run, to be the same residual host-load effect, not a
regression).

## Phase 13 — Whistleblower Portal ✅ (verified locally; see caveats below)
Anonymous reporting, encrypted evidence submission, tracking IDs, investigator workflow.

- Schema (`packages/database/prisma/schema.prisma`): 3 new tables —
  `Report` (`whistleblower_reports`; `trackingCodeHash` unique, never the raw
  code — the same "only a hash is ever persisted" discipline Phase 2
  established for refresh tokens and MFA backup codes), `ReportEvidence`
  (`whistleblower_evidence`; real encrypted object storage, Phase 10's
  pattern, `uploadedById` deliberately absent — there is never an
  authenticated uploader), `ReportUpdate` (`whistleblower_report_updates`;
  two-way anonymous communication, `author: INVESTIGATOR | REPORTER`,
  `postedById` set only for the investigator side).
- New `apps/api/src/modules/whistleblower/` module with **two controllers
  sharing one service** — a structural line every method in
  `WhistleblowerService` respects: `WhistleblowerPublicController`
  (`@Controller('public/whistleblower')`, `@Public()` at the class level,
  same mechanism as Phase 12's `TransparencyController`) for the anonymous,
  tracking-code side, and `WhistleblowerController`
  (`@Controller('whistleblower')`, `whistleblower:read`/`investigate`) for
  the authenticated investigator side. New permissions:
  `whistleblower:read`/`investigate`, granted ONLY to Auditor/Internal
  Auditor in seed.ts — the narrowest permission grant in the system (not
  even Super Administrator's blanket grant was treated as a reason to skip
  thinking about this specifically — see THREAT_MODEL.md Phase 13).
- Tracking code: `WB-` + `generateOpaqueToken(24)` (Phase 2's existing
  crypto utility, 192 bits of entropy), returned to the reporter exactly
  once in the submission response and never recoverable again — the same
  "shown once" guarantee as an API key. A dedicated
  `WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY` (AES-256-GCM, Phase 6's `encrypt`/
  `decrypt`) protects the one genuinely identifying field this module can
  ever hold — an optional reporter contact — kept deliberately separate
  from `EVIDENCE_ENCRYPTION_KEY`/`MFA_ENCRYPTION_KEY` (key separation per
  purpose, not reuse for convenience).
- Real encrypted evidence storage reusing Phase 10's `ObjectStorageAdapter`
  + `BlockchainAdapter` exactly as-is (no new storage abstraction needed),
  under a `whistleblower/${reportId}/...` key prefix, hash anchored
  immediately per file like `ProjectEvidence`.
- Investigator workflow state machine: `SUBMITTED → UNDER_REVIEW →
  {SUBSTANTIATED, UNSUBSTANTIATED}` (both terminal). Two-way communication:
  an investigator's question and a reporter's reply live in the same
  chronological `ReportUpdate` list, visible to both sides through their
  respective (very different) endpoints.
- **The most consequential design decision in this phase: what gets
  audited, and how.** Every anonymous action (submit, add evidence, reply)
  still writes a real, hash-chained, signed audit event for tamper-evidence
  — the same append-only guarantee everything else in the system gets — but
  with `actorId`/`actorEmail`/`ipAddress`/`userAgent` all deliberately
  omitted (there genuinely is no actor), and the event `payload` kept
  minimal (`reportId`, `category`, `evidenceCount` — never the description
  text, never the tracking code, never contact info), so that the much
  broader `audit:read` visibility (Auditor/Internal Auditor/Super
  Administrator) can never reveal more than "a report of this category
  exists," while the full sensitive content stays gated behind the
  narrower `whistleblower:read`. Investigator actions (assign, status
  change, post update) are audited the normal way — actor, IP, user agent —
  full accountability, no exception.
- **A second, genuinely new privacy control: source IP stripped from the
  ops-level HTTP request log itself**, not just from application data. A
  custom pino `serializers.req` in `app.module.ts` drops `remoteAddress`/
  `remotePort` specifically for requests under `/api/v1/public/whistleblower`
  — see "Notable engineering decisions" below for the real bug this took to
  get working.
- Frontend (`apps/web`): `stores/whistleblower.ts`, `views/
  ReportConcernView.vue` at `/report-a-concern` (submit / check status &
  reply — tabbed, `meta: { public: true }` alongside `/login` and
  `/transparency`) and `views/WhistleblowerInvestigationView.vue` at
  `/whistleblower-investigations` (`whistleblower:read`-gated). Both nav
  links added to `App.vue` — "Report a Concern" always visible (anonymous
  visitors need to find it), "Whistleblower Investigations" only for
  permission-holders.

**Notable engineering decisions:**
- **A real bug, caught by live smoke-testing, in the IP-redaction feature
  itself — not the whistleblower module's own business logic, but the pino
  logging customization built alongside it.** The first version called
  `pino-http`'s exported `stdSerializers.req(req)` inside a custom pino
  `serializers.req` function, expecting `req` to be the raw incoming
  request. Manually inspecting the resulting log lines showed
  `remoteAddress`/`remotePort` silently missing from **every** route, not
  just whistleblower ones — the fix wasn't obvious from reading pino-http's
  source alone. Root cause, found by adding temporary diagnostic logging:
  pino-http always serializes the request once internally to build the
  per-request child logger's `req` binding; pino itself then invokes a
  custom `serializers.req` at log-write time against that *already-
  serialized* value, not the raw request — so calling `stdSerializers.req`
  a second time received an object with no `.socket`/`.info`, and silently
  produced nothing. Fixed by treating the incoming value as already in the
  standard serialized shape and stripping the two fields directly. Verified
  by direct inspection of real log lines: `/api/v1/health` shows
  `"remoteAddress":"::1","remotePort":...`; every `/api/v1/public/
  whistleblower/*` line shows neither field at all.

Manual live smoke-testing (curl, against the running dev server, **no
Authorization header for any of the anonymous-side calls**) exercised the
full loop: submit a report (verified the DB stores only `trackingCodeHash`,
never the raw code, and that hashing the returned code with the same
algorithm reproduces it exactly), check status by tracking code, add
evidence by tracking code (confirmed genuinely AES-256-GCM-encrypted at
rest — `grep`ing the on-disk file for the original content finds nothing —
and blockchain-anchored), reply as the reporter, then switched to the
investigator side: confirmed a role without `whistleblower:read` gets a
clean `403`, an Auditor-shaped role can list/view reports including the
*decrypted* contact, assign to self, walk the legal state machine while
illegal transitions are rejected with `400`, and post an investigator
update that the anonymous reporter then sees on their next tracking-code
status check — genuine two-way anonymous communication working end-to-end.
Directly inspected `audit_events` afterward: the anonymous-side rows all
have `actorId`/`ipAddress` NULL with minimal payloads, the investigator-side
rows are fully attributed. Formal e2e coverage added in
`whistleblower.e2e-spec.ts` (7 tests, all passing, including a direct
cryptographic check that the persisted `trackingCodeHash` equals
`sha256(trackingCode)` and a full-workflow test that inspects the resulting
audit trail's attribution for both sides). Full e2e suite (90 tests across
12 spec files) and full monorepo build+lint pass cleanly; 11 repeated
stability runs (6 accumulated + 5 fresh-truncate) all pass with no
flakiness.

## Phase 14 — Production Hardening ✅ (verified locally; see caveats below)
OWASP ASVS pass, dependency audit, backup/DR design, load testing, secret review.

Fundamentally different in character from every prior phase: no new schema, no new
API surface, no new frontend — a cross-cutting review and hardening pass across
everything Phases 0–13 built, closing gaps that could only be found by actually
looking, not by building forward. This phase also received two genuinely new
inputs mid-pass — real Neon PostgreSQL credentials and a GitHub repository URL —
that unlock two items this project has explicitly deferred since Phase 1/2 for
lack of exactly this.

- **Secret review.** Verified directly, not assumed: all four `.env` files in the
  repo (root, `apps/api`, `apps/web`, `packages/database`) are `git check-ignore`d;
  `.env.example` contains only placeholder values; a repo-wide grep found zero
  hardcoded private keys, AWS-style access keys, or password/secret-shaped literals
  outside test fixtures (which are clearly-labeled `E2E`-prefixed dummy credentials
  against a local dev database, the same pattern established since Phase 3); and
  the real Neon credentials supplied this session were confirmed, via grep, to
  exist nowhere in the repo except the gitignored `apps/api/.env` — never
  committed, never logged.
- **Dependency audit.** `npm audit` found 9 high-severity transitive
  vulnerabilities: `multer` (several DoS vectors — confirmed unreachable in this
  codebase, since no route anywhere uses `FileInterceptor`/multipart file uploads;
  every upload endpoint in this project, across Phases 7/10/13, takes
  base64-encoded content in a JSON body instead) and `deepmerge-ts` (only reachable
  via Prisma's own CLI tooling — `@prisma/config` — never at runtime). Both fixed
  via minimal, non-breaking `overrides` in the root `package.json` pinning to
  patched versions (`multer ^2.4.0`, `deepmerge-ts ^8.0.2`), verified with a full
  clean reinstall (not just editing `package.json` and hoping): `npm audit` now
  reports 0 vulnerabilities, and the full e2e suite (91/91) and monorepo
  build+lint still pass unchanged.
- **OWASP ASVS review.** A structured pass across all 14 relevant ASVS categories
  (V1–V14), each checked against the actual code rather than restated from memory —
  see SECURITY.md § OWASP ASVS Review for the full, evidence-cited account. Found
  and fixed two genuine bugs in the process (see below), named three new residual
  risks not previously documented (data retention policy, step-up authentication,
  a global-not-per-route body size limit), and confirmed several previously-claimed
  controls hold up under direct inspection (SQL injection: all 5 raw-query call
  sites use Prisma's parameterized tagged templates, zero uses of
  `$queryRawUnsafe`/`$executeRawUnsafe`; rate limiting: verified as a working
  control, not just present in config).
- **Two real bugs found and fixed via this phase's own hardening testing, not
  hypothetical findings:**
  1. Express/body-parser's undocumented-at-the-call-site default JSON body limit
     (100kb) was in effect everywhere — silently breaking the evidence-upload
     feature itself (Phases 7/10/13) for any realistically-sized photo or PDF, a
     functional bug discovered by actually trying to upload one during this
     phase's own testing, not a security exercise that found nothing. Fixed:
     `main.ts` now sets an explicit, considered 15mb limit.
  2. When that limit *was* exceeded, the resulting error fell through
     `AllExceptionsFilter`'s catch-all branch as a raw, unhelpful `500` instead of
     the correct `413` — because body-parser's error is a plain `Error` carrying
     `status: 413` via the `http-errors` package convention, not a NestJS
     `HttpException`, and the filter only recognized the latter. Fixed:
     `AllExceptionsFilter` now recognizes any non-`HttpException` error carrying a
     legitimate 4xx status and reflects it correctly — scoped to 4xx only, so a
     claimed 5xx status from an untrusted source still can't be used to leak a
     custom message through the filter's own guarantee. Both fixes verified
     end-to-end (a real ~666KB upload that previously failed now succeeds; a
     genuinely oversized ~27MB payload now returns a clean `413`) and covered by
     a permanent regression test in `app.e2e-spec.ts`.
- **Load testing.** A real load test (`autocannon`, not a design estimate) found
  and fixed a genuine capacity issue: no explicit Prisma `connection_limit` had
  ever been configured anywhere in this project, silently leaving Prisma's default
  (`num_physical_cpus * 2 + 1`, ~9 on this sandbox) governing production-relevant
  concurrency. At 20 concurrent connections against a real business endpoint
  (`/public/projects`, 821 accumulated rows), this showed as connection-pool
  queuing — throughput actually *dropped* relative to 5-connection load (200 vs
  395 req/s median), with a heavy latency tail (p99 570ms, max 2.3s). Fixed by
  adding `connection_limit=20&pool_timeout=10` to `DATABASE_URL`; re-tested
  identically afterward: throughput more than doubled (434 req/s median), tail
  latency collapsed (p99 81ms, max 308ms). Rate limiting was separately verified
  as a genuine working control (105 rapid requests → exactly 100×`200` then
  `429`s, matching configuration precisely), not merely present in code — see
  DEPLOYMENT.md § Load Testing & Capacity for the full method and numbers.
- **Backup & Disaster Recovery design.** Documented in DEPLOYMENT.md § Backup &
  Disaster Recovery: relies on Neon's own point-in-time recovery and
  copy-on-write branching (the same "use the managed platform's real capability
  rather than half-reimplementing it" judgment already applied to `DATABASE_URL`
  itself since Phase 1), with the audit trail (Phase 3) and blockchain integrity
  layer (Phase 4) providing an independent, tamper-evident second line of defense
  for reconstructing *history* distinct from Neon's backup of *current state*. No
  actual recovery drill has been performed against the real Neon project yet —
  named explicitly as residual risk rather than left implicit.
- **CI/CD**: a real GitHub Actions workflow now exists
  (`.github/workflows/ci.yml`) — checkout → install → build every package →
  generate the Prisma client → migrate → seed → lint → build → the full e2e suite,
  against a genuine ephemeral PostgreSQL 16 service container, on every push/PR to
  `main`/`master`. Every secret-shaped value the pipeline needs is generated fresh
  per run and discarded with it — never a stored repository secret, since nothing
  in a throwaway CI database needs to persist or be protected. Every individual
  command in the workflow was verified to work correctly by running it locally
  first; the workflow file itself has not yet been executed by GitHub Actions,
  since that requires the repository to actually exist on GitHub (see below).
- **Neon connectivity**: real pooled and direct Neon connection strings were
  supplied this session and dropped into `apps/api/.env` with zero code changes
  needed, confirming the "just a connection-string swap" design claim made since
  Phase 1. **Schema deployment against the real Neon project
  (`prisma migrate deploy`) was attempted and blocked by this environment's own
  safety tooling as a "production deploy" action** — a reasonable guardrail this
  agent did not attempt to work around. This is left as a pending, explicit
  action for a human to run (see DEPLOYMENT.md § Local Development for the exact
  command), not silently skipped or worked around through another channel.
- **GitHub repository**: `https://github.com/clement645/anticorruption` was
  supplied this session. The local working tree (14 phases, zero prior commits)
  has not yet been pushed there — treated as a deliberate, explicitly-confirmed
  action given it is this project's first-ever publish to a real, shared remote,
  not something to do automatically alongside everything else in this pass.

**Notable engineering decisions:**
- **Fix the root cause, don't just document around it — applied to `npm audit`
  itself.** `npm audit fix --force`'s own suggested remediation would have
  downgraded `prisma` (a deliberately pinned version per this project's own
  established convention). Investigated the actual vulnerable packages instead
  (`multer`, `deepmerge-ts` — both several levels deep in the dependency tree, not
  directly declared anywhere in this project's own `package.json` files) and used
  targeted `overrides` to pin exactly those two packages to patched versions,
  leaving every directly-chosen dependency version (including `prisma`) untouched.
- **A genuinely non-obvious npm behavior, found the hard way:** adding `overrides`
  to `package.json` and re-running `npm install` — even `npm install --force` —
  did not apply them; `npm audit` kept reporting the same 9 vulnerabilities and the
  resolved versions in `node_modules` never changed. Root cause: a nested
  `packages/database/node_modules` (created by npm workspaces hoisting a
  conflicting transitive version into that specific workspace) held its own
  separate resolution that survived even a full lockfile deletion and
  regeneration. Only a fully clean reinstall (`rm -rf` every `node_modules`
  directory in the monorepo, root and every workspace, plus the lockfile) forced
  npm to properly honor the new `overrides` everywhere. Verified via direct
  before/after version checks in `node_modules`, not just trusting `npm audit`'s
  summary count.

Full e2e suite (91 tests across 12 spec files) and full monorepo build+lint pass
cleanly; 11 repeated stability runs (6 accumulated + 5 fresh-truncate) all pass
with no flakiness. See SECURITY.md § OWASP ASVS Review and DEPLOYMENT.md §§ Backup
& Disaster Recovery / Load Testing & Capacity / CI/CD / GitHub Repository for the
full, detailed account of everything above.

---

## Current State (as of this report)

**All 14 phases are complete and verified locally.** Standing caveats:

1. **CI pipeline exists** (`.github/workflows/ci.yml`, built in Phase 14) but has not
   yet been run by GitHub Actions itself, since that requires the repository to
   actually be pushed to GitHub — every command in it was individually verified
   locally instead. See DEPLOYMENT.md § CI/CD.
2. **Real Neon credentials were supplied in Phase 14** and confirmed to work as a
   pure connection-string swap with zero code changes, exactly as this document
   claimed since Phase 1 — but actual schema deployment
   (`prisma migrate deploy`) against that real Neon project was blocked by this
   environment's own safety tooling as a production-deploy action and is left as
   a pending, explicit human step rather than worked around. See DEPLOYMENT.md §
   Local Development for the exact command to run.
3. See Phase 2's own unchecked items above (API keys, forced password rotation, ABAC)
   for what IAM intentionally does not cover yet.
4. See Phase 3's own unchecked items above (no business-module audit events yet —
   Phase 5 fixed that; budget actions are now real audit events, see Phase 5 above).
5. See Phase 4's own unchecked items above (development ledger adapter only). Budget
   events are **not** anchored directly — only the audit-event rollup is; see the
   `Allocation.blockchainTxRef` schema comment for the honest gap this leaves.
6. See Phase 5's own unchecked items above (commitment-control accounting rather than
   full double-entry; no policy engine/multi-signature yet).
7. Repeated concurrency-stress e2e runs during Phases 5–6 development left a sizeable
   number of clearly-labeled `E2E-`/`[E2E]`-prefixed demo fiscal years/budgets/
   organizations/suppliers/tenders in the local dev database (harmless test residue,
   same handling as Phases 3–4's audit/blockchain test data) — not cleaned up, since
   doing so wasn't requested and isn't a correctness concern for a local dev database.
8. See Phase 6's own unchecked items above (no AI collusion detection yet; single-
   approver, fixed-RBAC award/approval; free-form evaluation scoring with no enforced
   rubric or automatic ranking; no downstream contract/PO from an award).
9. See Phase 7's own unchecked items above (no object storage — document bytes are
   never persisted, only their hash; total-ownership-≤100% is unlocked and provably
   racy under concurrent adds; BLACKLISTED has no reactivate path in the API at all;
   no policy engine/multi-signature for supplier status changes).
10. Repeated e2e stress-testing during Phase 7 found and fixed a real, pre-existing
    bug in Phase 4's `blockchain.e2e-spec.ts` (a fixed test email that could
    permanently orphan-lock the suite after any interrupted run) — see Phase 7's
    "Notable engineering decisions" above. Left fixed in place rather than reverted,
    since the bug was real regardless of which phase's stress-testing surfaced it.
11. See Phase 8's own unchecked items above (no duplicate-invoice detection — no
    `Invoice` entity exists yet; risk scores are heuristic/statistical, not ML; no
    automated adverse action of any kind — every finding requires a human review).
12. Repeated e2e stress-testing during Phase 8 found and fixed a real, pre-existing
    Phase 4 concurrency bug in `AnchoringService.runOnce()` (a boolean guard returning
    a misleading zero-result to a caller racing an in-flight run), plus two genuine
    statistical bugs in this phase's own new price-anomaly detector (z-score masking,
    and a degenerate 3-point-sample artifact) — see Phase 8's "Notable engineering
    decisions" above. All three fixed in place with permanent regression tests, not
    reverted or worked around.
13. See Phase 9's own unchecked items above (no duplicate-invoice detection over the
    now-real `Invoice` entity — still Phase 8's job, next in line for it; no
    partial-commitment tracking when multiple contracts share one originating
    commitment — a Phase 5 scope boundary, not new here; payment execution is a
    simulated abstraction, no real bank/mobile-money rail; no PO-vs-invoice-total
    reconciliation, a PO can be invoiced for more than its own amount).
14. Repeated manual smoke-testing and e2e stress-testing during Phase 9 found and
    fixed three real bugs in this phase's own new payment-execution code (idempotency
    replay checked after the status guard instead of before; an incorrect test
    assumption about concurrent approval semantics; ambiguous unique-constraint error
    targets under genuine 5-way concurrency) — see Phase 9's "Notable engineering
    decisions" above, all now permanent regression tests.
15. See Phase 10's own unchecked items below (filesystem storage is a local
    simulation of an object store, not real S3/cloud storage; no PO-vs-project-
    progress reconciliation; a milestone's `plannedAmount` is never validated
    against the sum of the contract's value; no Invoice-eligibility gating tied
    to milestone verification — a residual integration opportunity between
    Phase 9 and Phase 10, not built in this pass; a project with zero
    milestones added before activation simply never auto-completes, which is
    correct but means a Project Manager who forgets to define any milestones
    gets no explicit warning).
16. Repeated manual curl smoke-testing and e2e stress-testing during Phase 10 found
    and fixed three real bugs (a premature project auto-completion bug caused by an
    unfrozen milestone list; a missing unique-constraint→409 translation on
    `ProjectsService.create()`; a raw 500 instead of a clean 422 when AES-256-GCM
    correctly detected tampered evidence at rest) — see Phase 10's "Notable
    engineering decisions" above, all now permanent regression tests.
17. See Phase 11's own unchecked items below (reconstruction is a single-resource
    lookup — there is no cross-resource case view that walks known relationships,
    e.g. Award → Contract → PaymentRequest, as one combined timeline; no saved-
    search/case-notes/export capability for an investigating auditor; no UI over
    `GET /audit/events`'s own filters beyond what the existing Phase 3 browse view
    already offered).
18. A local Postgres/Docker environment reset during this session's work caused a
    hard container stop (not a clean shutdown), requiring WAL crash recovery on
    restart and several minutes of consequent e2e flakiness (generic `beforeAll`
    timeouts from concurrent Jest workers each bootstrapping a full app against a
    DB still settling, not a code regression — isolated spec runs passed
    throughout). Confirmed not a regression by re-running the full suite to a
    clean state (11 stability runs, all passing) before and after the reset.
19. See Phase 12's own unchecked items below (no cross-resource public timeline —
    a citizen must look up a project, tender, and supplier separately rather than
    seeing one combined story; supplier search has no filter for
    businessType/county beyond exact match; no public-facing map/geospatial view
    despite `Project.location` existing; no public RSS/webhook feed for "a new
    tender was published" style external monitoring).
20. Host-level CPU/memory contention in this shared development sandbox (observed
    load average above 11 on a 4-core machine, swap nearly exhausted, at the
    worst point during Phase 12's own work — unrelated to this project's code)
    caused intermittent e2e timeouts across multiple, otherwise-untouched spec
    files. Diagnosed rather than dismissed: isolated re-runs of the same specs
    passed cleanly once load settled, and a deliberately-run *control* test
    against an unrelated, already-stable spec file failed identically under the
    same load and passed identically once it dropped — confirming the cause was
    host contention, not application logic. Addressed by raising
    `test/jest-e2e.json`'s `testTimeout` from Jest's 5000ms default to 20000ms,
    a permanent, honest calibration to this environment rather than a
    workaround for a bug that was never actually found.
21. See Phase 13's own unchecked items below (no cross-resource case view linking
    a whistleblower report to a related resource elsewhere in the system, e.g. the
    contract/tender it alleges misconduct about — an investigator must connect
    that manually today; no rate limiting specific to report submission beyond
    the global limit, which could allow low-volume spam; no automated
    duplicate/similar-report detection; the ops-level IP-redaction fix only
    covers `/api/v1/public/whistleblower/*` — a reverse proxy or CDN in front of
    a real deployment would need its own equivalent access-log exemption for
    genuinely complete IP protection, which this local dev setup can't
    demonstrate).
22. See Phase 14's own unchecked items above and in SECURITY.md § OWASP ASVS
    Review / DEPLOYMENT.md (no data retention/deletion policy for
    `security_events` or stale `sessions`/`devices` rows; no step-up
    re-authentication for high-consequence actions like payment execution or
    whistleblower status changes; the new 15mb body-size limit is global, not
    scoped per-route; no actual Neon backup/DR recovery drill has been
    performed, only the mechanism documented; load testing covered read-heavy
    endpoints at moderate concurrency for short durations only, not a sustained
    write-heavy or high-concurrency test, and not against real Neon; the CI
    workflow has not yet been executed by GitHub Actions itself; schema has not
    yet been deployed to the real Neon project; and the repository has not yet
    been pushed to GitHub — see "Next Steps" below for the last two).

## Next Steps

All 14 phases of the original roadmap are now complete. What remains is not new
implementation work but finishing the two external connections Phase 14 brought
into reach and deliberately left as explicit human actions rather than
unilateral agent actions:

1. **Deploy the schema to the real Neon project.** With `DATABASE_URL`/
   `DIRECT_DATABASE_URL` in `apps/api/.env` pointed at the real Neon connection
   strings (already confirmed to work as a pure swap, see DEPLOYMENT.md §
   Local Development), run `npm run prisma:migrate:deploy` from the repo root,
   then `npm run prisma:seed`.
2. **Push this repository to GitHub** (`https://github.com/clement645/
   anticorruption`) and confirm the new CI workflow
   (`.github/workflows/ci.yml`) runs and passes there — the one piece of this
   phase's own work that could only be verified locally, not through the real
   GitHub Actions runner, until the repository exists there.

Beyond those two, further work is genuinely optional hardening/extension rather
than anything the original spec calls for: the residual risks named throughout
this document and in SECURITY.md/THREAT_MODEL.md (cross-resource case views,
retention policies, step-up authentication, a real Neon recovery drill,
sustained/write-heavy load testing, and the various per-phase scope notes) are
the honest list of what a next iteration would prioritize, not blockers to
calling this project's initial build complete.
