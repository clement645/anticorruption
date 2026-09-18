# B-PFMPS API

## Versioning

All routes are served under `/api/v1` (configurable via `API_PREFIX`). Breaking changes
ship as `/api/v2` alongside `/api/v1` rather than mutating a live version.

## Conventions

- JSON request/response bodies, validated with `class-validator` DTOs and
  `class-transformer` on every endpoint (whitelist + forbid unknown properties).
- Every response carries a `requestId` (also emitted in logs) for correlation.
- Errors follow a single shape and never leak raw database or stack-trace detail:
  ```json
  {
    "statusCode": 400,
    "message": "Human-readable message",
    "error": "Bad Request",
    "requestId": "..."
  }
  ```
  This applies even to errors raised outside application code — e.g. a request
  body over the (Phase 14) 15mb limit returns a proper `413` with this same
  shape, not a generic `500` (see SECURITY.md § OWASP ASVS Review, V12, for the
  bug this fixed).
- Pagination uses cursor-based pagination for high-volume collections (procurement,
  audit events, transactions) and offset pagination only for small, bounded lists.
- Mutating financial endpoints (payments, allocations, commitments) accept an
  `Idempotency-Key` header (Phase 9+; see SECURITY.md § Idempotency).

## Planned Route Groups (populated as each phase ships)

| Prefix | Phase | Status |
|---|---|---|
| `/api/v1/health` | 1 | ✅ implemented |
| `/api/v1/auth`, `/api/v1/users`, `/api/v1/roles` | 2 | ✅ implemented |
| `/api/v1/organizations` | 2 | ✅ implemented (read-only; no create/edit endpoint yet) |
| `/api/v1/audit` | 3 | ✅ implemented |
| `/api/v1/blockchain` | 4 | ✅ implemented |
| `/api/v1/fiscal-years`, `/budgets`, `/allocations`, `/commitments`, `/adjustments` | 5 | ✅ implemented |
| `/api/v1/procurement-plans`, `/procurement-requests`, `/tenders`, `/tender-lots`, `/bids` | 6 | ✅ implemented |
| `/api/v1/suppliers` (extended), `/supplier-documents` | 7 | ✅ implemented |
| `/api/v1/risk-alerts`, `/risk-scans` | 8 | ✅ implemented |
| `/api/v1/contracts`, `/purchase-orders`, `/invoices`, `/payment-requests`, `/payments` | 9 | ✅ implemented |
| `/api/v1/projects`, `/milestones`, `/inspections`, `/evidence` | 10 | ✅ implemented |
| `/api/v1/public` | 12 | ✅ implemented (public, unauthenticated, read-only) |
| `/api/v1/public/whistleblower` (anonymous), `/api/v1/whistleblower` (investigator) | 13 | ✅ implemented |

## Phase 1 — Implemented Endpoints

### `GET /api/v1/health`
Liveness check. Returns process status without touching the database. Always fast,
always safe to hit frequently (load balancer probes).

```json
{ "status": "ok", "timestamp": "2026-09-15T08:00:00.000Z", "uptimeSeconds": 123 }
```

### `GET /api/v1/health/ready`
Readiness check. Verifies the database connection is actually usable
(`SELECT 1`-equivalent via Prisma). Returns `503` if the dependency is unavailable, per
section 30 — does not report "ready" when it isn't. Does **not** expose connection
strings, internal hostnames, or stack traces (section 30: never leak sensitive system
info through health endpoints).

```json
{ "status": "ok", "checks": { "database": "ok" } }
```

## Phase 2 — Implemented Endpoints

All routes below except `/auth/*` require a valid `Authorization: Bearer <accessToken>`
header (global `JwtAuthGuard`, fail closed). Routes marked with a permission require the
caller's JWT to carry that permission (global `PermissionsGuard`); unmarked
authenticated routes require only a valid session.

### `POST /api/v1/auth/login`
Body: `{ email, password }`. Returns either `{ accessToken, expiresIn }` (sets the
`bpfmps_refresh_token` httpOnly cookie, scoped to `/api/v1/auth`) or, if MFA is enabled
on the account, `{ mfaRequired: true, mfaToken }`. Locks the account after
`ACCOUNT_LOCKOUT_THRESHOLD` consecutive failures (`403`, default 5 attempts /
15 minutes).

### `POST /api/v1/auth/mfa/verify`
Body: `{ mfaToken, code }` — `code` is a 6-digit TOTP code or a `XXXX-XXXX-XXXX` backup
code (consumed on use). Completes the login started by `/auth/login`, returning the same
shape as a successful login.

### `POST /api/v1/auth/refresh`
Reads the refresh cookie, rotates it, and returns a new `{ accessToken, expiresIn }`.
Presenting an already-rotated or revoked refresh token revokes the entire session chain
(reuse detection — see SECURITY.md).

### `POST /api/v1/auth/logout`
Revokes the current session's refresh token and clears the cookie. `204 No Content`.

### `GET /api/v1/users/me`
Returns the authenticated user's id, email, roles, and flattened permission list (the
same shape embedded in the access token).

### `GET /api/v1/users` — requires `users:read`
Paginated user list (`?skip=&take=`).

### `POST /api/v1/users` — requires `users:create`
Admin-created user with an administrator-set temporary password (no invite-email flow
yet — see IMPLEMENTATION_PLAN.md Phase 2 follow-ups).

### `POST /api/v1/users/me/mfa/totp/setup`
Generates a new TOTP secret (stored encrypted, not yet active) and returns
`{ secret, otpauthUrl }` for the user to add to an authenticator app.

### `POST /api/v1/users/me/mfa/totp/enable`
Body: `{ code }` (6-digit). Verifies the setup code, activates TOTP, and returns
`{ backupCodes: string[] }` — shown to the user exactly once.

### `GET /api/v1/roles` — requires `roles:read`
Lists roles with their granted permissions.

### `GET /api/v1/organizations`
Lists organizations and their departments. Authenticated-only, no dedicated permission
(every actor needs to browse the org chart); create/edit will require a permission once
that mutation endpoint exists.

## Phase 3 — Implemented Endpoints

All routes below require `audit:read` (the demo Super Administrator and Auditor roles
both have it).

### `GET /api/v1/audit/events`
Query: `?skip=&take=&eventType=&actorId=&resourceType=&resourceId=` (the last two
added in Phase 11) — paginated, filterable audit event list, newest first.

### `GET /api/v1/audit/events/:id`
A single audit event by id.

### `GET /api/v1/audit/verify`
Walks the entire hash chain, recomputing every event's payload hash, chain link,
current hash, and signature. Returns `{ valid, totalChecked }` when intact, or
`{ valid: false, totalChecked, brokenAtSequence, reason }` at the first mismatch found
— `reason` is one of `payload_hash_mismatch`, `chain_link_broken`,
`current_hash_mismatch`, `signature_invalid`.

### `GET /api/v1/audit/events/:id/verify`
Single-event drill-down: verifies one event's link to its predecessor and its
signature, returning the event plus a `checks` breakdown, **plus** (as of Phase 4) a
`blockchainAnchor` field completing section 55's full "transaction reconstruction"
checklist:
```json
{
  "event": { "...": "..." },
  "checks": {
    "payloadHashValid": true, "chainLinkValid": true,
    "currentHashValid": true, "signatureValid": true
  },
  "verified": true,
  "blockchainAnchor": {
    "anchored": true,
    "found": true,
    "chainLinkValid": true,
    "transaction": { "id": "...", "status": "CONFIRMED" },
    "block": { "id": "...", "sequence": "12" }
  }
}
```
`blockchainAnchor.anchored` is `false` (with no other fields) until the periodic
anchoring job (or a manual trigger) has rolled this event up — anchoring is
asynchronous, so a freshly-created event being unanchored is normal, not an error.

### `GET /api/v1/audit/reconstruct` (added Phase 11 — the Auditor Portal)
Query: `?resourceType=&resourceId=` — both required, `400` if either is missing.
Every audit event ever recorded against that one resource, in order, each
independently re-verified exactly like `events/:id/verify` above (same `checks` +
`blockchainAnchor` shape per event — this endpoint composes, not duplicates, that
logic), plus `{ resourceType, resourceId, totalEvents, fullyVerified }` summarizing
the whole result:
```json
{
  "resourceType": "Project",
  "resourceId": "...",
  "totalEvents": 3,
  "fullyVerified": true,
  "events": [
    { "event": { "...": "..." }, "checks": { "...": true }, "verified": true,
      "blockchainAnchor": { "anchored": false } }
  ]
}
```
`totalEvents: 0` (with `fullyVerified: true`, vacuously) means no audit history
exists for that resourceType/resourceId — distinguish "nothing found" from "found
and verified" via `totalEvents`, not `fullyVerified` alone. Chain-link validity for
each event is checked against its true predecessor in the full chain, not just
within this filtered result set, so tampering with an event belonging to resource A
correctly fails reconstruction of A while leaving a `fullyVerified: true`
reconstruction of an unrelated resource B unaffected.

## Phase 4 — Implemented Endpoints

All routes below require `blockchain:read`; `POST /anchor` additionally requires
`blockchain:anchor`.

### `GET /api/v1/blockchain/health`
`{ healthy, adapter, details: { totalBlocks, totalTransactions } }` — the
`BlockchainAdapter.healthCheck()` result (section 54).

### `GET /api/v1/blockchain/transactions/:id`
A single ledger transaction.

### `GET /api/v1/blockchain/transactions/:id/verify`
Verifies the transaction's containing block still correctly links to its predecessor
and recomputes to the stored block hash. Returns
`{ found, transaction, block, chainLinkValid }`.

### `GET /api/v1/blockchain/blocks/:id`
A single block (`BlockchainAnchor`) by id.

### `POST /api/v1/blockchain/anchor`
Manually triggers an anchoring run now instead of waiting for the periodic interval
(`BLOCKCHAIN_ANCHOR_INTERVAL_SECONDS`, default 60s) — rolls up to
`BLOCKCHAIN_ANCHOR_BATCH_SIZE` (default 100) not-yet-anchored audit events into one new
blockchain transaction/block. Returns
`{ anchoredCount, transactionId?, blockId? }` — `anchoredCount: 0` when there was
nothing new to anchor (not an error). Safe to call concurrently: overlapping calls
serialize via the same advisory-lock mechanism used for audit-chain appends, so exactly
one call performs the anchor and the rest correctly no-op.

## Phase 5 — Implemented Endpoints

All routes require `budget:read` at minimum; mutating routes require the specific
permission noted.

### `GET /api/v1/fiscal-years` · `POST /api/v1/fiscal-years` (`budget:manage`)
### `POST /api/v1/fiscal-years/:id/activate` · `/:id/close` (`budget:manage`)

### `GET /api/v1/budgets` · `GET /api/v1/budgets/:id`
Query: `?skip=&take=&organizationId=&fiscalYearId=&status=`.

### `POST /api/v1/budgets` (`budget:create`)
Body: `{ fiscalYearId, organizationId, name, description?, lines: [{ code, voteCode,
voteName, programName, subProgramName?, description, authorizedAmount }] }`. Creates a
`DRAFT` budget with its lines in one transaction.

### `POST /api/v1/budgets/:id/submit` (`budget:create`)
`DRAFT → PENDING_APPROVAL`. `400` if the budget isn't currently `DRAFT`.

### `POST /api/v1/budgets/:id/approve` (`budget:approve`)
`PENDING_APPROVAL → APPROVED`, and atomically creates one `Allocation` per
`BudgetLine` — the "Digital Budget Entitlement" (section 10). `400` if not currently
`PENDING_APPROVAL`.

### `POST /api/v1/budgets/:id/reject` (`budget:approve`)
Body: `{ reason? }`. `PENDING_APPROVAL → REJECTED`.

### `GET /api/v1/allocations` · `GET /api/v1/allocations/:id`
Query: `?skip=&take=&organizationId=&fiscalYearId=`. Returns
`{ authorizedAmount, committedAmount, spentAmount, availableAmount, status,
authorizationReference, ... }` — `availableAmount` is computed
(`authorized - committed - spent`), never stored.

### `POST /api/v1/allocations/:id/commitments` (`budget:commit`)
Body: `{ amount, description }`. `409` if `amount` exceeds the allocation's current
available balance — enforced with a row lock, safe under concurrent requests (see
DATABASE.md § Current State).

### `POST /api/v1/commitments/:id/release` (`budget:commit`)
Releases an unused `ACTIVE` commitment back to available. `400` if not `ACTIVE`.

### `POST /api/v1/commitments/:id/expenditures` (`budget:spend`)
Body: `{ amount, description }`. `400` if `amount` exceeds the commitment's amount.
Consumes the commitment fully (any unused remainder becomes available again — see
schema.prisma comment on `Expenditure`) and moves `amount` from the allocation's
committed bucket to its spent bucket in one transaction.

### `POST /api/v1/allocations/:id/adjustments` (`budget:adjust`)
Body: `{ type: "INCREASE" | "DECREASE", amount, reason }`. Creates a `PENDING`
adjustment — does not change any balance until approved.

### `POST /api/v1/adjustments/:id/approve` (`budget:approve`)
Applies the adjustment to the allocation's `authorizedAmount`. `409` if a `DECREASE`
would cut the ceiling below what's already committed+spent.

### `POST /api/v1/adjustments/:id/reject` (`budget:approve`)

## Procurement (Phase 6)

All routes require `procurement:read` at minimum; mutating routes require the specific
permission noted.

### `GET /api/v1/suppliers` · `POST /api/v1/suppliers` (`procurement:manage`)
Body: `{ name, registrationNumber, email?, phone? }`. `409` on a duplicate
`registrationNumber`.

### `GET /api/v1/procurement-plans` · `GET /api/v1/procurement-plans/:id`
### `POST /api/v1/procurement-plans` (`procurement:manage`)
Body: `{ organizationId, fiscalYearId, name, description? }`. Creates a `DRAFT` plan.

### `POST /api/v1/procurement-plans/:id/approve` (`procurement:approve`)
`DRAFT → APPROVED`. Requests can only be raised against an `APPROVED` plan.

### `GET /api/v1/procurement-requests` · `GET /api/v1/procurement-requests/:id`
Query: `?organizationId=&status=`.

### `POST /api/v1/procurement-requests` (`procurement:create`)
Body: `{ procurementPlanId, organizationId, allocationId, title, description,
estimatedAmount }`. `400` if the plan is not `APPROVED`. Creates a `DRAFT` request.

### `POST /api/v1/procurement-requests/:id/submit` (`procurement:create`)
`DRAFT → SUBMITTED`.

### `POST /api/v1/procurement-requests/:id/approve` (`procurement:approve`)
`SUBMITTED → APPROVED`, and atomically creates a budget `Commitment` against the
referenced `Allocation` by calling Phase 5's `AllocationsService.createCommitment()` —
`409` if the allocation's available balance can't cover `estimatedAmount` (same
row-locked check budget's own commitments use, see DATABASE.md § Current State).

### `POST /api/v1/procurement-requests/:id/reject` (`procurement:approve`)
`SUBMITTED → REJECTED`.

### `GET /api/v1/tenders` · `GET /api/v1/tenders/:id`
Query: `?status=`.

### `POST /api/v1/procurement-requests/:id/tenders` (`procurement:create`)
Body: `{ title, description, closingDate, lots: [{ lotNumber, description,
estimatedAmount }] }`. `400` if the request is not `APPROVED`, or lot numbers within
the tender aren't unique. Creates a `DRAFT` tender with its lots in one transaction.

### `POST /api/v1/tenders/:id/publish` (`procurement:publish`)
`DRAFT → PUBLISHED`. Only published tenders before their `closingDate` accept bids.

### `POST /api/v1/tenders/:id/close` (`procurement:publish`)
`PUBLISHED → CLOSED`. Only closed tenders can have bids evaluated/awarded.

### `POST /api/v1/tenders/:id/cancel` (`procurement:approve`)
Any state except `AWARDED`/`CANCELLED` → `CANCELLED`.

### `GET /api/v1/tender-lots/:id/bids`
### `POST /api/v1/tender-lots/:id/bids` (`procurement:bid`)
Body: `{ supplierId, amount }`. `400` if the parent tender isn't `PUBLISHED` and open
(before `closingDate`). `409` on a duplicate bid from the same supplier for the same
lot (`Bid.tenderLotId + supplierId` is unique).

### `POST /api/v1/bids/:id/evaluate` (`procurement:evaluate`)
Body: `{ technicalScore, financialScore }`. `SUBMITTED → EVALUATED`.

### `POST /api/v1/bids/:id/award` (`procurement:award`)
`EVALUATED → AWARDED`; creates the lot's `Award` (`409` if the lot or the bid already
has one — enforced by a DB unique constraint, not a lock, see DATABASE.md § Current
State). Once every lot in a tender has an award, the tender itself moves to `AWARDED`.

## Supplier Management (Phase 7)

Extends the `/api/v1/suppliers` routes Phase 6 created with a separate `supplier`
permission namespace, distinct from `procurement:*`. `GET/POST /api/v1/suppliers`
and `GET /api/v1/suppliers/:id` (the minimal identity used for bidding) remain
owned by Phase 6 and gated by `procurement:read`/`procurement:manage` — unchanged.
Everything below is new, gated by `supplier:*` permissions, and reachable at
sub-paths that don't collide with Phase 6's routes.

### `GET /api/v1/suppliers/:id/profile` (`supplier:read`)
The extended profile: business type, tax identifier, physical address, county,
contact person, in addition to the fields Phase 6's `GET /suppliers/:id` returns.

### `PATCH /api/v1/suppliers/:id` (`supplier:manage`)
Body: any subset of `{ name, email, phone, businessType, taxIdentifier,
physicalAddress, county, contactPersonName }`. Updates only the fields provided.

### `POST /api/v1/suppliers/:id/suspend` (`supplier:manage`)
`ACTIVE → SUSPENDED`. `400` if not currently `ACTIVE`. A suspended supplier is
immediately rejected by `POST /tender-lots/:id/bids` (Phase 6's
`supplier.status !== 'ACTIVE'` check, live for the first time this phase).

### `POST /api/v1/suppliers/:id/reactivate` (`supplier:manage`)
`SUSPENDED → ACTIVE`. `400` if not currently `SUSPENDED` — in particular, there is
no reactivate path from `BLACKLISTED` (see SECURITY.md).

### `POST /api/v1/suppliers/:id/blacklist` (`supplier:manage`)
`ACTIVE|SUSPENDED → BLACKLISTED`. `400` if already `BLACKLISTED`. A one-way door:
no endpoint reverses this status.

### `GET /api/v1/suppliers/:id/owners` (`supplier:read_sensitive`)
### `POST /api/v1/suppliers/:id/owners` (`supplier:manage`)
Body: `{ fullName, nationalIdOrPassport, ownershipPercentage, position?,
isPoliticallyExposedPerson? }`. `400` if the new total disclosed ownership across
all of this supplier's owners would exceed 100% — checked at the application
layer only, not lock-protected (see DATABASE.md § Current State).

### `POST /api/v1/suppliers/:id/owners/:ownerId/remove` (`supplier:manage`)
Deletes the owner row; the removal itself is still recorded as an audit event.

### `GET /api/v1/suppliers/:id/documents` (`supplier:read_sensitive`)
### `POST /api/v1/suppliers/:id/documents` (`supplier:manage`)
Body: `{ documentType, fileName, mimeType, fileContentBase64, expiryDate? }`.
`documentType` is one of `REGISTRATION_CERTIFICATE`, `TAX_COMPLIANCE_CERTIFICATE`,
`CR12`, `PIN_CERTIFICATE`, `OTHER`. Only the document's SHA-256 hash (computed
server-side from `fileContentBase64`, never trusted from the client) and metadata
are persisted — see SECURITY.md for the no-object-storage-yet limitation. Creates
a `PENDING` document.

### `POST /api/v1/supplier-documents/:documentId/verify` (`supplier:verify`)
`PENDING → VERIFIED`. `400` if not currently `PENDING`.

### `POST /api/v1/supplier-documents/:documentId/reject` (`supplier:verify`)
Body: `{ reason }`. `PENDING → REJECTED`. `400` if not currently `PENDING`.

### `GET /api/v1/suppliers/:id/risk-profile` (`supplier:read_sensitive`)
The most recent risk assessment, or `null` if none has been recorded.

### `GET /api/v1/suppliers/:id/risk-profile/history` (`supplier:read_sensitive`)
Every assessment ever recorded for this supplier, newest first.

### `POST /api/v1/suppliers/:id/risk-profile` (`supplier:verify`)
Body: `{ riskLevel: "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", score, factors: [...],
notes? }`. Always creates a new row (append-only — see schema.prisma comment on
`SupplierRiskProfile`); never updates a prior assessment in place.

## AI Risk Engine (Phase 8)

Detectors run automatically at real lifecycle points (tender close, procurement
request approval, PEP-owner-add, document rejection, supplier suspend/reactivate/
blacklist) and can never fail or block the action that triggered them — they only
ever additively create a `RiskAlert` row. All routes require `risk:read` at minimum.

### `GET /api/v1/risk-alerts`
Query: `?status=&severity=&detectorType=&resourceType=&resourceId=`. `status` is one
of `OPEN`/`UNDER_REVIEW`/`CONFIRMED`/`DISMISSED`; `severity` one of
`LOW`/`MEDIUM`/`HIGH`/`CRITICAL`; `detectorType` one of `PRICE_ANOMALY`/
`BID_COLLUSION`/`SPLIT_PROCUREMENT`/`SUPPLIER_RISK`.

### `GET /api/v1/risk-alerts/:id`

### `POST /api/v1/risk-alerts/:id/review` (`risk:review`)
Body: `{ status: "UNDER_REVIEW"|"CONFIRMED"|"DISMISSED", notes? }`. `400` if the alert
is already `CONFIRMED` or `DISMISSED`. **Deliberately not granted to the Procurement
Officer role** — see SECURITY.md § AI Risk Engine for why.

### `POST /api/v1/risk-scans/tenders/:id` (`risk:manage`)
On-demand re-run of price-anomaly + bid-collusion across every lot on the tender.
`404` if the tender doesn't exist.

### `POST /api/v1/risk-scans/organizations/:id` (`risk:manage`)
On-demand re-run of split-procurement for the organization's most recent
SUBMITTED/APPROVED request. `{ scanned: false }` if the organization has none.

### `POST /api/v1/risk-scans/suppliers/:id` (`risk:manage`)
On-demand re-run of supplier-risk assessment. `404` if the supplier doesn't exist.

## Contracts, Invoices & Payments (Phase 9)

`organizationId`/`allocationId`/`commitmentId`/`supplierId` on a Contract are always
derived server-side from the Award's own chain — never accepted as request fields.

### `GET /api/v1/contracts` · `GET /api/v1/contracts/:id` (`contract:read`)

### `POST /api/v1/contracts` (`contract:manage`)
Body: `{ awardId, contractNumber, title, value, startDate, endDate }`. `409` if the
award already has a contract, or `contractNumber` is already in use. `400` if the
award's procurement request has no budget commitment.

### `POST /api/v1/contracts/:id/activate` · `/:id/complete` · `/:id/terminate` (`contract:manage`)
`DRAFT → ACTIVE → COMPLETED`, or `DRAFT|ACTIVE → TERMINATED`. `activate` sets
`signedById`/`signedAt`.

### `POST /api/v1/contracts/:id/purchase-orders` (`contract:manage`)
Body: `{ poNumber, description, amount }`. `400` if the contract is not `ACTIVE`.

### `GET /api/v1/purchase-orders` · `GET /api/v1/purchase-orders/:id` (`contract:read`)

### `POST /api/v1/purchase-orders/:id/issue` · `/:id/cancel` (`contract:manage`)
`DRAFT → ISSUED`, or any non-terminal state `→ CANCELLED`.

### `POST /api/v1/purchase-orders/:id/invoices` (`invoice:submit`)
Body: `{ invoiceNumber, amount, dueDate?, items: [{ description, quantity, unitPrice,
amount }] }`. `400` if the PO is not `ISSUED`. No supplier self-service portal exists
yet — this records an invoice on the supplier's behalf, submitted by internal staff.

### `GET /api/v1/invoices` · `GET /api/v1/invoices/:id` (`invoice:read`)

### `POST /api/v1/invoices/:id/verify` (`invoice:verify`)
`SUBMITTED → VERIFIED`, and atomically creates a `PaymentRequest` for the invoice's
full amount — the real trigger for the multi-signature payment approval workflow.

### `POST /api/v1/invoices/:id/reject` (`invoice:verify`)
Body: `{ reason }`. `SUBMITTED → REJECTED`.

### `GET /api/v1/payment-requests` · `GET /api/v1/payment-requests/:id` (`payment:read`)
Includes the `approvals` recorded so far and `requiredApprovals` (default 2).

### `POST /api/v1/payment-requests/:id/approvals` (`payment:approve`)
Body: `{ decision: "APPROVE"|"REJECT", notes? }`. `403` if the caller verified this
request's own invoice (self-approval is blocked). `409` if the caller already
recorded a decision on this request. Any `REJECT` rejects immediately; the request
moves to `APPROVED` once `requiredApprovals` distinct `APPROVE` decisions exist.
`400` once the request is no longer `PENDING`.

### `POST /api/v1/payment-requests/:id/execute` (`payment:execute`)
Requires an `Idempotency-Key` header — `400` if missing. `400` unless the request is
`APPROVED`. Creates the real budget `Expenditure` (via Phase 5's
`AllocationsService.createExpenditure()`), marks the invoice `PAID`, and the request
`EXECUTED`. A retried request with the **same** key returns the original `Payment`
unchanged, never disbursing twice; the same key against a **different**, already-
executed request is a genuine `409` conflict.

### `GET /api/v1/payments` · `GET /api/v1/payments/:id` (`payment:read`)

### `POST /api/v1/payments/:id/reconciliations` (`payment:reconcile`)
Body: `{ externalReference, status: "MATCHED"|"DISCREPANCY", notes? }`. A manual
reconciliation record — no automated bank-feed integration exists.

## Project Verification (Phase 10)

`organizationId` on a Project is always derived server-side from the Contract —
never accepted as a request field. Milestones may only be added while the project
is `PLANNED`; `activate()` freezes the milestone list (see DATABASE.md § 5 for why).

### `GET /api/v1/projects` · `GET /api/v1/projects/:id` (`project:read`)

### `POST /api/v1/projects` (`project:manage`)
Body: `{ contractId, name, description, location?, startDate, plannedEndDate }`.
`400` if the contract is not `ACTIVE`. `409` if the contract already has a project.

### `POST /api/v1/projects/:id/activate` · `/:id/suspend` · `/:id/resume` · `/:id/cancel` (`project:manage`)
`PLANNED → IN_PROGRESS → {SUSPENDED ⇄ IN_PROGRESS} → COMPLETED`, or any non-terminal
state `→ CANCELLED`. `activate` is also the point at which the milestone list freezes.
`COMPLETED` is never set here directly — see `maybeMarkCompleted` below.

### `GET /api/v1/projects/:id/milestones` · `GET /api/v1/milestones/:id`
`project:read`.

### `POST /api/v1/projects/:id/milestones` (`project:manage`)
Body: `{ sequenceNumber, title, description, plannedAmount, plannedDate }`. `400` if
the project is not `PLANNED`. `409` if `sequenceNumber` is already used on this
project.

### `POST /api/v1/milestones/:id/start` · `/:id/complete` (`project:manage`)
`PENDING → IN_PROGRESS → COMPLETED`. `complete` is also reachable directly from
`PENDING` (skipping an explicit "start" step is allowed). Once every milestone on a
project reaches `VERIFIED` (see inspections below), the project auto-completes —
`ProjectsService.maybeMarkCompleted()`.

### `GET /api/v1/milestones/:id/inspections` · `GET /api/v1/inspections/:id`
`project:read`.

### `POST /api/v1/milestones/:id/inspections` (`project:inspect`)
Body: `{ outcome: "PASSED"|"FAILED"|"NEEDS_REVISION", findings }`. `400` unless the
milestone is `COMPLETED`. `PASSED` moves the milestone to `VERIFIED` (and may trigger
project auto-completion); `FAILED`/`NEEDS_REVISION` sends it back to `IN_PROGRESS`
for rework. `project:manage` does not grant this — recording an inspection is an
Engineer action, distinct from the Project Manager action that marked the milestone
complete (separation of duties, section 18).

### `GET /api/v1/projects/:id/evidence` (`project:read`)

### `POST /api/v1/projects/:id/evidence` (`evidence:upload`)
Body: `{ fileName, mimeType, fileContentBase64, inspectionId? }`. `400` if
`inspectionId` is given but doesn't belong to this project. Computes a SHA-256 hash
server-side, encrypts and stores the bytes (AES-256-GCM, real filesystem storage —
see ARCHITECTURE.md § 7), and anchors the hash on the blockchain immediately (not
via the periodic audit rollup). A failed anchor attempt never blocks the upload —
`blockchainTxRef` simply stays `null` for that record.

### `GET /api/v1/evidence/:id` (`project:read`)

### `GET /api/v1/evidence/:id/download` (`project:read`)
Decrypts the stored bytes and returns `{ fileName, mimeType, contentBase64,
hashVerified }`. `hashVerified` is `false` if the recomputed SHA-256 doesn't match
the hash recorded at upload time (decryption itself still succeeded). If the stored
ciphertext has been tampered with, AES-256-GCM's auth tag check fails during
decryption itself — that case returns `422`, not a `200` with `hashVerified: false`,
since there is no plaintext left to hash at all.

## Citizen Transparency Portal (Phase 12)

Every route below is `@Public()` — **no Authorization header, no permission, no
account of any kind**. Responses are hand-written, privacy-filtered DTOs, never a
reflection of any internal `*View` type — see the module's own doc comment
(`transparency.types.ts`) for the full reasoning behind each field
inclusion/exclusion. Protected by the same global rate limit as every other route
(`ThrottlerGuard`, `APP_GUARD`) — no separate rate-limiting infrastructure exists
for this surface.

### `GET /api/v1/public/projects`
Query: `?search=&status=&skip=&take=`. `search` matches on `name`
(case-insensitive substring).

### `GET /api/v1/public/projects/:id`
Adds `milestones` (no internal id, no actor) and `evidence` (`fileHash`,
`fileName`, `mimeType`, `fileSizeBytes`, `anchored` — never `storageKey` or
`uploadedById`).

### `GET /api/v1/public/tenders`
Query: `?search=&status=&skip=&take=`. `DRAFT` tenders are always excluded —
they aren't yet public knowledge.

### `GET /api/v1/public/tenders/:id`
`404` if the tender is `DRAFT` or doesn't exist (deliberately not distinguished —
the same information-hiding judgment a `404` already makes for permission-gated
resources elsewhere). Adds `lots`, each with `award: null` or `{ supplierName,
awardedAmount, awardedAt }` for the winning bid only — no losing-bid amounts, no
evaluation scores.

### `GET /api/v1/public/suppliers`
Query: `?search=&status=&skip=&take=`. `search` matches on `name`.

### `GET /api/v1/public/suppliers/:id`
Returns `{ id, name, registrationNumber, status, businessType, county }` only —
never `email`/`phone`/`taxIdentifier`/`physicalAddress`/`contactPersonName`, and
never anything from `SupplierOwner` (beneficial ownership, PEP flag).

### `GET /api/v1/public/budgets`
Query: `?organizationId=&fiscalYearId=&skip=&take=`. Sourced from `Allocation`
(only ever created once its Budget is APPROVED — see DATABASE.md § 5) joined to
its organization/fiscal-year/vote names, returning authorized/committed/spent
amounts per line.

### `GET /api/v1/public/verify?hash=`
`hash` must be a 64-character hex SHA-256 digest — `400` otherwise. Looks up
`ProjectEvidence.fileHash`:
```json
{
  "found": true,
  "fileName": "site-photo.jpg",
  "mimeType": "image/jpeg",
  "fileSizeBytes": 204800,
  "projectId": "...",
  "projectName": "Rural Road Rehabilitation",
  "milestoneTitle": "Earthworks",
  "uploadedAt": "2026-09-18T05:33:56.585Z",
  "anchored": true,
  "chainIntact": true
}
```
`{ "found": false }` if no evidence matches. `chainIntact` reuses
`AuditService.verifyEvent()` against the evidence's own `EVIDENCE_UPLOADED` audit
event (recomputed fresh, not a cached flag) and is `undefined` if that event isn't
available (e.g. audit history was truncated in a dev environment) — never the raw
event itself, and never who uploaded the file.

## Whistleblower Portal (Phase 13)

Two distinct halves. The anonymous side is `@Public()` — no Authorization header,
ever — and additionally has its source IP stripped from the ops-level request log
itself (see SECURITY.md § Whistleblower Portal). The investigator side requires
`whistleblower:read`/`investigate`, granted only to Auditor/Internal Auditor.

### `POST /api/v1/public/whistleblower/reports`
Body: `{ category, description, organizationId?, contact?, evidence?: [{ fileName,
mimeType, fileContentBase64 }] }`. `category` is one of `CORRUPTION`, `FRAUD`,
`PROCUREMENT_IRREGULARITY`, `CONFLICT_OF_INTEREST`, `ABUSE_OF_OFFICE`, `OTHER`.
Returns `{ trackingCode, reportId }` — **`trackingCode` is shown exactly once and
is never recoverable again if lost**; only its SHA-256 hash is ever persisted.

### `GET /api/v1/public/whistleblower/reports/:trackingCode`
Returns `{ category, description, status, createdAt, evidence, updates }` — no
`organizationId`, `assignedToId`, or `contact` (a reporter has no need to see
their own contact echoed back, and an investigator's identity is never disclosed
to a reporter). `404` for an unknown code — deliberately generic, not
distinguishing a malformed code from a real-but-wrong one.

### `POST /api/v1/public/whistleblower/reports/:trackingCode/evidence`
Body: `{ fileName, mimeType, fileContentBase64 }`. Same encryption/hashing/
anchoring pipeline as Phase 10's `ProjectEvidence`, reused as-is.

### `POST /api/v1/public/whistleblower/reports/:trackingCode/updates`
Body: `{ message }`. Adds a `REPORTER`-authored entry to the report's
conversation, visible to the investigator and to the reporter's own next status
check.

### `GET /api/v1/whistleblower/reports` (`whistleblower:read`)
Query: `?status=&skip=&take=`. Each item includes the **decrypted** `contact`
field, if the reporter left one.

### `GET /api/v1/whistleblower/reports/:id` (`whistleblower:read`)
Adds `evidence` and the full `updates` conversation (both authors).

### `POST /api/v1/whistleblower/reports/:id/assign` (`whistleblower:investigate`)
Sets `assignedToId` to the calling investigator. No exclusivity enforced — any
investigator with `whistleblower:investigate` can still act on an already-assigned
report.

### `POST /api/v1/whistleblower/reports/:id/status` (`whistleblower:investigate`)
Body: `{ status: "UNDER_REVIEW"|"SUBSTANTIATED"|"UNSUBSTANTIATED" }`.
`SUBMITTED → UNDER_REVIEW → {SUBSTANTIATED, UNSUBSTANTIATED}` (both terminal —
`400` on any other transition, including re-entering the same status).

### `POST /api/v1/whistleblower/reports/:id/updates` (`whistleblower:investigate`)
Body: `{ message }`. Adds an `INVESTIGATOR`-authored entry, `postedById` set to
the calling investigator — visible to the reporter on their next tracking-code
status check.

## OpenAPI / Swagger

`@nestjs/swagger` is wired into `main.ts` and serves interactive API documentation at
`/api/docs` in non-production environments. It is populated automatically as DTOs and
controllers are added in each phase — there is nothing to hand-maintain.
