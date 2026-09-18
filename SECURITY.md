# B-PFMPS Security Model

## Honest Framing

Blockchain does not make corruption impossible. It cannot detect a false invoice by
itself. AI can produce false positives and false negatives. An authorized person can
still enter false information, and a compromised identity remains a threat. B-PFMPS is
designed as **corruption-resistant, tamper-evident, cryptographically accountable
financial infrastructure**: it makes unauthorized modification of records extremely
difficult and highly detectable, and it makes every high-value action attributable to a
specific authenticated actor — it does not claim to prevent fraud by trusted, authorized
insiders on its own. That is why AI risk signals always route to human review
(SECURITY.md § AI Governance) and why evidence, multi-signature approval, and immutable
audit trails exist as independent, overlapping controls rather than a single point of
trust.

## Identity & Authentication (Phase 2 — implemented)

- Passwords hashed with **Argon2id** (never bcrypt/scrypt/plaintext) — native binding
  verified.
- Short-lived JWT access tokens (default 15m) + rotating refresh tokens.
- Refresh tokens are stored **hashed** (SHA-256, never plaintext) in `sessions`; reuse of
  a previously-rotated refresh token immediately revokes the entire session chain,
  including the token that replaced it (reuse-detection → replay-attack mitigation) —
  verified via e2e test against both legs of the chain.
- MFA via TOTP (encrypted-at-rest secrets, AES-256-GCM) with one-time-use backup
  recovery codes — full enroll → enable → challenge → consume flow verified live.
- Account lockout after `ACCOUNT_LOCKOUT_THRESHOLD` failed attempts (default 5, for
  `ACCOUNT_LOCKOUT_DURATION_MINUTES` default 15) — verified.
- The refresh cookie is `HttpOnly`, `SameSite=Lax`, path-scoped to `/api/v1/auth`, and
  `Secure` in production (not in local development, where the app runs over plain HTTP
  by design — see DEPLOYMENT.md).
- Every authentication event (login success/failure/lockout, MFA challenge/verify/fail,
  token refresh/reuse-detected, logout) is written to `security_events`.
- **Not yet implemented:** step-up authentication before high-value actions (no such
  actions exist yet — introduced alongside the module that needs them, e.g. payment
  approval in Phase 9), device trust tracking beyond the `devices` table existing,
  login-anomaly detection (impossible travel / new device / unusual hour), forced
  password rotation on first login, and an API-key issuing flow (the `api_keys` table
  exists but has no endpoint yet).

## Authorization

- **RBAC** implemented: `@RequirePermissions('resource:action')` + a global
  `PermissionsGuard`, enforced against the permission set embedded in the access token.
  A global `JwtAuthGuard` requires authentication on every route by default —
  unauthenticated access is opt-in via `@Public()`, not opt-out (fail closed).
- **ABAC** (organization, department, financial threshold, procurement stage,
  jurisdiction) is **not yet implemented** — Phase 2 only has role→permission checks.
  It will be layered on top of the existing guard once a module that actually needs
  those conditions exists (e.g. budget approval thresholds in Phase 5), rather than
  built speculatively now.
- Authorization is enforced **only** in the backend (NestJS guards). The frontend's
  route guard (`apps/web/src/router/index.ts`) is a UX convenience only — it spares an
  authenticated-looking flash before the API would reject the request; it carries no
  trust weight (section 28/29).
- Zero Trust: every request is evaluated independently — an access token proves
  authentication, never authorization, and its permission list is what's actually
  checked per route.
- **Known trade-off:** the access token embeds roles/permissions at issuance time for
  statelessness. A role change takes effect on that user's next token refresh (≤15
  minutes), not instantly. Immediate revocation of a compromised session is still
  available via session revocation (logout-everywhere), which does take effect
  immediately since refresh requires a live, unrevoked session.

## Digital Signatures (Phase 3 — implemented for audit events; Phase 6+ for business actions)

Every audit event is signed at the application layer with Ed25519
(`packages/crypto/src/signing.ts`): actor ID, timestamp, action, resource ID, payload
hash, signature, key identifier, and previous event hash are all captured together
(blockchain transaction reference is added in Phase 4). The signing abstraction is
deliberately key-agnostic — `sign`/`verify` take PEM text — so a government PKI/HSM can
be substituted for the application-managed key (`AUDIT_SIGNING_PRIVATE_KEY` in env)
later without any caller changing. High-value **business** actions (tender publication,
bid evaluation, award, payment approval, etc.) will use this same signing primitive once
those modules exist, starting Phase 6.

## Immutable Audit (Phase 3 — implemented)

Audit events are append-only: no application code issues `UPDATE`/`DELETE` against
`audit_events`, with one narrow, explicitly-scoped exception — see DATABASE.md §
Conventions on `blockchainTxRef`. Each event hash-chains to the previous one
(`currentHash = SHA256(previousHash + payloadHash + timestamp + actorId)`) and is
individually signed, verifiable via `GET /api/v1/audit/verify`, which walks the entire
chain and reports exactly where and why it breaks if it does. As of Phase 4, groups of
events are additionally rolled up and anchored into an independent blockchain ledger
(see § Blockchain Integrity Layer below) — `GET /api/v1/audit/events/:id/verify`
reports both layers together.

Two important correctness properties, both violated by an earlier draft of this
implementation and caught by testing against a real database rather than trusting the
design on paper (full detail in THREAT_MODEL.md Phase 3 and IMPLEMENTATION_PLAN.md):

- **The hash must never depend on data that can legitimately change after the event is
  written.** `audit_events.actorId` is a foreign key with `onDelete: SetNull` (so
  deleting a `User` doesn't cascade through audit history) — but that means its value
  can change out from under a hash computed earlier. The chain hashes a frozen
  `actorIdSnapshot` (plain string, not a relation) instead of the live FK column.
- **Payload hashing must not depend on JSON object key order surviving a database
  round-trip.** PostgreSQL's `jsonb` type explicitly does not preserve object key
  order. Hashing now uses a canonical (recursively key-sorted) serialization, computed
  identically whether the payload just came from the caller or was just read back from
  storage.
- **Concurrent appends must not be able to fork the chain.** A Postgres advisory
  transaction lock (`pg_advisory_xact_lock`) serializes the
  read-latest-event→compute→insert sequence across all requests, including from
  separate server processes — verified safe under 25 genuinely concurrent requests.

**Transaction reconstruction (Phase 11 — the Auditor Portal, section 55).**
`GET /api/v1/audit/reconstruct?resourceType=&resourceId=` gives an Auditor/Internal
Auditor a forensic case file for any one resource in the system: every audit event
ever recorded against it, each independently re-verified (not a cheaper "trust the
stored data" shortcut — every event's `checks` are recomputed fresh, same as
`events/:id/verify`), with blockchain anchor status composed in per event. The
property worth calling out explicitly: chain-link validity for each matched event is
checked against its true predecessor in the *entire* audit chain, not merely the
previous event within the filtered result set — so tampering with an event belonging
to resource A is caught when reconstructing A, while a concurrently-run
reconstruction of an unrelated resource B correctly reports `fullyVerified: true`.
Reconstruction isolates by `resourceId`; it does not report "something, somewhere,
is wrong" under every resource's name just because the chain has a break in it
elsewhere. No new permission — gated on the existing `audit:read`, already
restricted to Auditor/Internal Auditor/Super Administrator.

## Blockchain Integrity Layer (Phase 4 — implemented)

Not blockchain-as-marketing: per section 1/40, PostgreSQL remains the system of record
for everything; the blockchain layer stores and verifies only hashes and transaction
references, and exists specifically so that tampering is detectable even if an attacker
(or a compromised administrator) has full write access to the primary database — a
second, independently-verifiable ledger that a single-database compromise cannot also
silently rewrite.

`BlockchainAdapter` (`packages/blockchain`) is the abstraction every caller depends on;
`DevelopmentLedgerAdapter` (`apps/api/src/modules/blockchain`) is the only
implementation so far — a hash-chained ledger simulation, itself stored in PostgreSQL
for this prototype (`blockchain_transactions`, `blockchain_anchors`), reusing the same
advisory-lock chain-safety pattern proven in Phase 3's audit chain, with its own
distinct lock key (a logically independent chain, even though the physical database is
shared today). A periodic job (`AnchoringService`) rolls up not-yet-anchored
`audit_events` into one blockchain transaction/block on a configurable interval; the
same logic is reachable on demand via `POST /api/v1/blockchain/anchor` for operators who
don't want to wait for the next tick.

**Honest limitation:** because both chains currently live in the same PostgreSQL
instance, this prototype's blockchain layer does **not** yet provide protection against
an attacker who compromises the database host itself (it *does* still protect against
selective tampering with individual `audit_events` rows without also correctly
recomputing every subsequent block's hash chain and signature — which is the more
realistic tampering scenario, and is what the tamper-detection tests actually exercise).
Real independence — the property that actually matters for the "even a compromised
database administrator can't rewrite history" claim in the Honest Framing at the top of
this document — arrives when `DevelopmentLedgerAdapter` is replaced with a
`PermissionedBlockchainAdapter` backed by a separately-operated Hyperledger Fabric/Besu
network, which `BlockchainAdapter`'s interface is already shaped for without any caller
changing.

Verified under 10 genuinely concurrent anchor-trigger requests against 20 pending
events: exactly one performed the anchor, the other nine correctly no-op'd, and the
resulting ledger had exactly one block (no forking) — see IMPLEMENTATION_PLAN.md
Phase 4.

## AI Governance (Phase 8 — implemented)

Every detector (price anomaly, bid collusion, split procurement, supplier risk) is
deterministic/statistical — thresholds, z-scores, coefficients of variation — not a
trained model; there is no `modelVersion` to track because there is no model. None of
them can auto-convict, auto-suspend, auto-blacklist, or auto-reject anything: each one
can only call `RiskAlertsService.raiseAlert()`, an additive write with no code path
back into the business action that triggered it. Every detector invocation is wrapped
so an exception inside it is logged and swallowed, never propagated — a detector bug
must never become the reason a legitimate approve/close/suspend action fails (the same
principle `PermissionsGuard`'s audit-logging comment already establishes for a
different subsystem).

Every alert (`RiskAlert`) is an explainable record — `title`, `description`, and a
structured `evidence` JSON carrying the actual numbers a human needs to judge it (bid
amounts, mean/stddev/z-score, coefficient of variation, contributing supplier-risk
factors with their weights) — not just a bare severity label. High/critical findings
route into a review queue (`status: OPEN`) that only `risk:review` can resolve;
**this permission is deliberately withheld from the Procurement Officer role** — see
below. The original design sketch for this section anticipated a separate
`ai_decisions` table for detector-run auditability; Phase 8 instead routes that through
Phase 3's existing `AuditService` (`RISK_ALERT_RAISED`/`RISK_ALERT_REVIEWED` events),
judged sufficient rather than building a second parallel audit mechanism — see
DATABASE.md § 4 Conventions for the reasoning.

### Separation of duties: who can resolve a risk alert

`risk:review` (confirm/dismiss) is granted only to independent-oversight roles —
Auditor, Internal Auditor, and Approving Officer — and deliberately **not** to
Procurement Officer, even though that role holds nearly every other procurement
permission (`procurement:manage`, `:create`, `:publish`, `:evaluate`, `:award`) and
does get `risk:read` and `risk:manage` (can view alerts and trigger a re-scan).
A Procurement Officer who could also confirm or dismiss an alert about their own
tender/bid/award actions would be marking their own work — exactly the conflict of
interest a corruption-resistant control is supposed to prevent, and it would apply
regardless of that specific officer's honesty: the control has to hold even when a
seat is filled by someone it shouldn't. Verified with a dedicated e2e test using a
role shaped exactly like the real Procurement Officer grant, proving the 403 is
actually enforced rather than merely documented in seed.ts.

## Administrative Controls (Phase 2/14)

No super-administrator can unilaterally erase historical evidence or audit records.
Dangerous administrative actions (e.g. anything touching audit retention, key
rotation, blockchain anchor configuration) require MFA, step-up authentication, and
dual control (a second privileged approver) — all logged.

## API & Input Security (applied from Phase 1 onward)

- Centralized `ValidationPipe` (whitelist, forbid non-whitelisted properties, transform)
  on every route.
- Centralized exception filter — database/internal errors are logged with full detail
  server-side and returned to clients as a generic, safe message.
- `helmet` for security headers, strict CORS allow-list (`CORS_ORIGIN`), request size
  limits, and rate limiting (`@nestjs/throttler`) from Phase 1.
- SQL injection is structurally prevented by using Prisma's parameterized query builder
  exclusively; any future raw SQL requires explicit justification and parameterization
  review.
- File upload restrictions, MIME validation, and a malware-scanning abstraction point
  are introduced with the Evidence Vault (Phase 10).
- IDOR protection: every resource lookup is scoped by the authenticated actor's
  authorization context, not by trusting a client-supplied ID alone.
- SSRF protection is required wherever the backend ever fetches a URL on the
  application's behalf (introduced when such a feature exists — none does in Phase 1).

## Financial Integrity (Phase 5 — implemented for budget commitments)

"Never allow expenditure beyond available authorized budget" (section 9) is enforced
transactionally: every commitment, release, expenditure, and adjustment-approval takes
a `SELECT ... FOR UPDATE` row lock on the target `Allocation` before reading its
current balance, so two concurrent requests against the same allocation cannot both
read a stale "available" figure and both succeed when only one has room — the second
blocks until the first commits, then re-checks against the now-current balance. A
database-level `CHECK` constraint (`committed + spent <= authorized`) backstops this as
defense in depth. Verified under a genuine 10-way concurrent commitment stress test
against a fixed-size allocation: exactly the number of requests that fit the ceiling
succeeded, the rest were correctly rejected (`409`), and the final committed amount
matched the ceiling exactly — zero overshoot (see IMPLEMENTATION_PLAN.md Phase 5).

This is commitment-control accounting (running authorized/committed/spent balances),
not a full double-entry ledger with a chart of accounts — a deliberate scope decision,
documented in schema.prisma and IMPLEMENTATION_PLAN.md, not an oversight. Every
balance-changing transition still atomically moves an amount between exactly one bucket
and another (e.g. consuming a commitment atomically decreases `committedAmount` and
increases `spentAmount` by the same amount in one transaction), which is the property
"double-entry principles where applicable" is actually asking for at this stage.

## Procurement Financial Integrity (Phase 6)

Approving a `ProcurementRequest` is the point where procurement first touches real
money: it creates a budget `Commitment` against the caller-supplied `Allocation` by
calling directly into Phase 5's `AllocationsService.createCommitment()`, rather than
re-implementing "cannot commit beyond available balance." This means procurement
inherits Phase 5's row-locked, CHECK-constraint-backstopped safety property instead of
being a second, independently-reasoned-about place that same bug class could recur —
one correct implementation of "don't overcommit an allocation," not two.

Awarding a tender lot is a different kind of integrity problem: not a running balance,
but "exactly one winner." `Award.tenderLotId` and `Award.bidId` are both DB unique
constraints, so of any number of concurrent award attempts against the same lot, the
database itself guarantees only the first commits — the rest fail their unique-index
check and are mapped to `409 Conflict`. This was chosen deliberately over a lock
(advisory or row) because the invariant is "at most one row" rather than "a balance
that must never go negative" — see DATABASE.md § 4 Conventions for the three
concurrency patterns now in use across the codebase and when each applies.

Every procurement state transition (plan/request/tender/bid submit-evaluate-award)
writes a real, hash-chained, signed audit event (Phase 3) — the second business module,
after budget, to exercise that infrastructure for real financial and procurement
actions rather than IAM housekeeping.

## Supplier Compliance & Corruption-Resistance (Phase 7)

Beneficial ownership disclosure (`SupplierOwner`) is the specific anti-corruption
control section 12 asks for: `isPoliticallyExposedPerson` is a first-class field,
not buried in free text, so that a supplier owned or controlled by a politically
exposed person is a queryable, visible fact to anyone with `supplier:read_sensitive`
— a Ministry Officer or ordinary Procurement Officer only sees `supplier:read`'s
basic profile; ownership, compliance documents, and the risk profile require the
elevated permission. This is route-level RBAC (a separate controller/permission per
sub-resource), not field-level filtering of one response — consistent with every
other module in this codebase, and an honest reflection of "ABAC not yet
implemented" (see § AI Governance / Current Implementation Status below).

Compliance documents (`SupplierDocument`) never have their actual bytes persisted —
only a SHA-256 hash, computed **server-side** from the submitted content (not
trusted from the client), plus metadata. No object storage backend exists yet in
this codebase; Phase 10's evidence vault is where encrypted document storage
actually gets built. A verified document's hash is a genuine integrity primitive
today (proof of exactly what content was reviewed), even without the bytes
themselves being retrievable through this API yet.

The `ACTIVE → SUSPENDED → ACTIVE` / `ACTIVE|SUSPENDED → BLACKLISTED` (terminal)
status machine is not cosmetic: `BidsService.submit()` has rejected bids from a
non-ACTIVE supplier since Phase 6, but that check was unreachable dead code until
this phase added the only endpoints that ever set a non-ACTIVE status. Suspending
or blacklisting a supplier here immediately and verifiably blocks it from bidding
on any open tender lot — proven end-to-end in `supplier.e2e-spec.ts`, not just
asserted by the state machine's existence. Blacklisting is a one-way door: no
endpoint reverses it, the same single-actor-approval limitation already documented
for budget/procurement approval (no multi-signature/policy engine yet).

The total-beneficial-ownership-≤100% invariant is a **known, accepted** gap: it is
checked at the application layer with no lock, so genuinely concurrent owner-adds
can push the recorded total past 100% — proven by a dedicated e2e test that fires
concurrent adds and asserts this can happen, rather than left as an untested
assumption. This was a deliberate choice, not an oversight: it is a low-stakes,
low-concurrency disclosure field (one procurement officer editing one supplier's
ownership record), not a financial balance, and does not justify the row-locking
machinery used for Phase 5's allocations — see DATABASE.md § 4 Conventions for the
full reasoning behind when this codebase does and doesn't reach for a lock.

## Idempotency & Concurrency (Phase 9 — implemented)

Budget commitments (Phase 5) achieve concurrency safety via row-level locking (above) —
sufficient because each request's effect is fully determined by server-side state.
Payment execution needed something more: `Idempotency-Key` support, because a
client-side retry after a dropped response must not re-execute a payment that actually
succeeded server-side — a distinct problem from the one row locking solves.

`POST /payment-requests/:id/execute` requires a client-supplied `Idempotency-Key`
header. The implementation is a **claim-then-work** sequence, not a duplicate-check
run only after disbursing: a `Payment` row is INSERTed first (before any budget
mutation), with `expenditureId` still null; the database's own unique constraint on
`idempotencyKey` is what atomically decides which of any number of concurrent or
retried calls actually proceeds. Only that one caller goes on to create the real
budget `Expenditure` and fill in `expenditureId`. A losing concurrent call, or a
genuine client retry, is handed back the identical `Payment` row without ever
touching the budget a second time. If the work step fails after the claim succeeds, the claim
row is deleted so the key is never permanently unusable — a client that resolves the
underlying problem can retry with a new key.

This ordering was not the first version. An earlier implementation created the
Expenditure first and the Payment second, which meant the idempotency claim happened
*after* the side effect it was supposed to guard — a legitimate retry, arriving after
the payment request had already moved to `EXECUTED`, hit a status check before ever
reaching the replay lookup and was incorrectly rejected. Caught during this phase's
own manual smoke testing and fixed by reordering so the replay check runs
unconditionally, before any status validation — see IMPLEMENTATION_PLAN.md Phase 9.
A second concurrency bug — some losing requests under genuine 5-way concurrent
execution misclassified as "different idempotency key" conflicts because Postgres
does not consistently report which of two simultaneously-violated unique constraints
fired first — was found via a real concurrent stress test and fixed by always
checking directly for an existing row under the given key on any conflict, rather
than branching on which constraint the database happened to report.

Payment approval (multi-signature, section 18) is a separate concurrency problem from
execution: reaching `requiredApprovals` distinct `APPROVE` decisions is a running-count
check, the same shape as Phase 5's allocation balances, so it is row-locked
(`SELECT ... FOR UPDATE` on the `PaymentRequest`) rather than relying on a unique
constraint — see DATABASE.md § 4 Conventions for why these are two different problem
shapes needing two different tools, both used in this one feature. Self-approval is
blocked structurally: the actor who verified an invoice cannot also approve its
payment, and no double approval by the same person is possible (a DB unique
constraint on `PaymentRequest` + approver).

## Evidence Vault & Object Storage Encryption (Phase 10 — implemented)

Phase 10 closes a gap explicitly documented since Phase 7: project evidence
(inspection photos, reports) is now genuinely stored, not hash-only.
`packages/storage`'s `ObjectStorageAdapter` interface and the concrete
`FilesystemObjectStorageAdapter` (`apps/api/src/modules/storage`) encrypt every
file at rest with AES-256-GCM (`packages/crypto`'s new binary-safe
`encryptBuffer`/`decryptBuffer` — added specifically because the existing
`encrypt`/`decrypt` only handle UTF-8 strings and would have silently corrupted
raw binary bytes if reused as-is, caught before ever being exercised). The
SHA-256 hash of every uploaded file is anchored on the blockchain integrity
layer immediately, per file (not via the periodic audit-event rollup — each
piece of evidence is independently significant), and re-verified on every
download.

Tamper detection is real, not aspirational, and has two distinct failure modes
that were both manually verified rather than assumed from reading the code:
1. **Ciphertext tampering** (the on-disk encrypted bytes are altered) — AES-
   256-GCM's authentication tag rejects this during decryption itself, before
   any plaintext or hash comparison is even possible. The download endpoint
   returns `422 Unprocessable Entity` with a clear message, not a raw 500 —
   an earlier version let this crash uncaught, found and fixed by deliberately
   corrupting a stored file and observing the failure mode before writing this
   up as working.
2. **Hash-record tampering** (the recorded `fileHash` itself is altered, but
   the stored ciphertext decrypts fine) — caught by the recomputed-hash-vs-
   recorded-hash comparison on every download, reported as `hashVerified:
   false` rather than silently handing back content that doesn't match its
   own record. Also manually verified: swapping the DB's recorded hash and
   confirming the download endpoint reports the mismatch.

Separation of duties continues here: `project:manage` (Project Manager — marks
milestones COMPLETED) is deliberately distinct from `project:inspect`
(Engineer — records the PASSED/FAILED/NEEDS_REVISION outcome). Neither role
can perform the other's half of "declare done, then independently verify it
was actually done" — the same shape as Phase 6 (evaluate vs. award), Phase 8
(`risk:review` withheld from Procurement Officer), and Phase 9 (submit vs.
verify an invoice, approve vs. execute a payment). A milestone only reaches
`VERIFIED` as the consequence of an Engineer's independent PASSED inspection —
never self-declared by whoever completed the work.

## Public Transparency Surface (Phase 12 — implemented)

The first genuinely unauthenticated API surface in the codebase: every `/public/*`
route bypasses the global `JwtAuthGuard` via the same `@Public()` mechanism
`/auth/login` and `/health` already used, applied at the controller class level so
a route added to this controller later can never accidentally end up requiring
auth by omission. None of these routes carry `@RequirePermissions`, so
`PermissionsGuard`'s existing "no requirement declared, allow through" default
applies even with no `request.user` on the request at all — this is the same
guard logic every other route already relies on, not a special case built for
this phase.

**The core control is not authentication — it's DTO design.** Every response
shape in `transparency.types.ts` is hand-written from scratch, never a re-export
or narrowing of an internal `*View` type used by the corresponding authenticated
module. This is deliberate: an internal type gaining a new field over time (an
actor's email added to `ProjectView` for some future feature, say) can never
silently leak into a public response, because the public DTO has no structural
relationship to it at all — a reviewer has to consciously choose to add a field
here. Concretely excluded from every public response: any individual actor's
identity (uploader, inspector, approver, creator — none of it, anywhere);
supplier contact/tax data (`email`, `phone`, `taxIdentifier`, `physicalAddress`,
`contactPersonName`) and all of `SupplierOwner` (beneficial ownership, the PEP
flag); losing-bid amounts and evaluation scores (only the winning award per
tender lot is shown, once awarded); and evidence file content (only the hash and
metadata — actually downloading a file still requires the internal, permissioned
evidence endpoints).

The public hash-verification tool (`GET /public/verify?hash=`) composes three
already-independently-proven systems without exposing any of their internals:
Phase 10's `ProjectEvidence.fileHash`, Phase 3/11's `AuditService.verifyEvent()`
(reused as-is, not reimplemented, against the evidence's own `EVIDENCE_UPLOADED`
event — a fresh cryptographic recomputation, not a cached flag), and Phase 4's
`BlockchainAdapter.verifyTransaction()`. Only booleans and already-public
metadata (project name, milestone title, file name) cross into the response.

Rate limiting: no new infrastructure was built for this surface. The existing
global `ThrottlerGuard` (registered as `APP_GUARD` since Phase 1) runs ahead of
every route handler regardless of authentication status, so `/public/*` already
inherits the same protection as every authenticated route.

## Whistleblower Portal (Phase 13 — implemented)

Anonymous by design, not by omission — every control here exists specifically
because the alternative (a whistleblower being identifiable, even indirectly)
would defeat the entire point of the feature.

**Access is a possession-based secret, not a login.** A reporter receives a
`WB-`-prefixed tracking code (`generateOpaqueToken(24)`, 192 bits of entropy —
Phase 2's existing crypto utility, not new code) exactly once, in the
submission response. Only `sha256(trackingCode)` is ever persisted
(`Report.trackingCodeHash`) — the exact "never store the secret itself"
discipline already applied to refresh tokens and MFA backup codes. There is no
account, no password, no recovery flow: losing the tracking code means losing
access to that report, by design — the alternative (any recovery mechanism)
would necessarily require collecting an identifying credential.

**No actor, no IP, no user agent — for the anonymous side specifically.**
Every anonymous action (submit, add evidence, reply) still writes a real
audit event, for the same tamper-evidence reason every other action in the
system does, but `AuditService.append()` is called with `actorId`/
`actorEmail`/`ipAddress`/`userAgent` all omitted, and the event `payload` kept
to the bare minimum (`reportId`, `category`, `evidenceCount` — never the
report's own description text, never contact info, never the tracking code
itself). This means the much broader `audit:read` grant (Auditor/Internal
Auditor/Super Administrator) can confirm a report of a given category exists
and roughly when, but never what it said — that requires the separate,
narrower `whistleblower:read`. Investigator actions (assign, change status,
post an update) are audited the normal, fully-attributed way — an
investigator is as accountable for their actions here as anywhere else.

**Source IP is stripped from the ops-level HTTP request log itself**, not
just from application data — a genuinely new category of control for this
codebase. A custom pino `serializers.req` in `app.module.ts` drops
`remoteAddress`/`remotePort` specifically for requests under
`/api/v1/public/whistleblower/*`; every other route's request log is
unaffected. Verified by direct inspection of real log output (see
IMPLEMENTATION_PLAN.md Phase 13 for the debugging account — the first
implementation silently stripped the IP from *every* route due to a
misunderstanding of when pino-http vs. pino itself applies a custom request
serializer, caught by inspecting actual log lines rather than trusting the
code).

**The one genuinely identifying field this module can ever hold is
encrypted, under its own dedicated key.** An optional reporter contact
(email/phone, entirely optional) is AES-256-GCM encrypted
(`packages/crypto`'s `encrypt()`) under `WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY`
— deliberately not reusing `EVIDENCE_ENCRYPTION_KEY` or
`MFA_ENCRYPTION_KEY` — and decrypted only when an authorized investigator
views the report.

**The narrowest permission grant in the entire system.** `whistleblower:read`
and `whistleblower:investigate` are granted to exactly two roles —
Auditor and Internal Auditor — in seed.ts. Every other role, including ones
with broad `*:read` access elsewhere (Procurement Officer, Finance Officer,
Approving Officer, County/Ministry Officer), has neither. This matters more
here than anywhere else in the system: a report may well concern the
conduct of someone holding one of those other permissions, and the whole
point of an independent-oversight-only grant is that the people a report
might be about can never see it through their own role.

Evidence reuses Phase 10's `ObjectStorageAdapter`/`BlockchainAdapter` exactly
as-is (AES-256-GCM at rest, immediate per-file blockchain anchoring) — no new
storage abstraction was needed. `ReportEvidence` has no `uploadedById` column
at all (not even nullable) — there is never an authenticated uploader for
this table to record.

## OWASP ASVS Review (Phase 14)

A structured pass against OWASP's Application Security Verification Standard,
checking claims already made elsewhere in this document against the actual code
rather than restating them — each line below either cites a specific file/behavior
verified during this review or names a genuine, previously-undocumented gap. Scored
informally as **Pass** (implemented and verified), **Partial** (implemented with a
real, named limitation), or **Gap** (not implemented — cross-referenced to the
existing residual-risk lists rather than duplicated here).

**V1 — Architecture, Design and Threat Modeling.** Pass. Every phase in
IMPLEMENTATION_PLAN.md has a corresponding entry in THREAT_MODEL.md (attack surface
→ controls → tests → residual risk), not written after the fact — the threat model
was the basis several concurrency/privacy design decisions were made from (e.g. the
Whistleblower Portal's actor/IP omission, Phase 13).

**V2 — Authentication.** Pass, with one deliberate design note. Argon2id password
hashing, a 12-character minimum (no forced complexity rules) — this is not a gap:
ASVS 4.x and NIST 800-63B both favor length over composition rules, and a
composition requirement would be the *less* current-best-practice choice here.
Account lockout after `ACCOUNT_LOCKOUT_THRESHOLD` (5) failed attempts. TOTP + backup
codes for MFA. **Partial:** no API key issuance and no step-up authentication for
especially sensitive actions (e.g. a payment execution or a whistleblower-report
status change does not require re-authentication beyond a valid session) — both
already tracked in the existing "not yet implemented" list.

**V3 — Session Management.** Pass. Refresh tokens are `httpOnly`, `sameSite: lax`,
`secure` conditional on `NODE_ENV=production` (correct — `secure` cookies are
silently dropped over local `http://` dev, which would have broken local
development if left unconditional), and scoped to `path: /api/v1/auth` — verified
directly in `auth.controller.ts`'s `cookieOptions()`, not assumed. Refresh token
rotation with reuse detection (a replayed, already-rotated-out token invalidates the
whole session family). Access tokens live only in frontend memory, never
`localStorage`/`sessionStorage` (`apps/web/src/api/client.ts`'s own doc comment).

**V4 — Access Control.** Pass. Every route is permission-gated by default
(`JwtAuthGuard` + `PermissionsGuard`, both registered globally, fail-closed — a
route is only reachable without a valid token if explicitly `@Public()`, and a
permission is only bypassed if explicitly undeclared). Verified this session: a
role without `whistleblower:read` gets a clean `403` from every investigator-side
whistleblower route (not just documented — re-confirmed by reading the e2e test
that asserts it). Separation of duties enforced structurally (distinct permissions
to distinct roles in seed.ts) across every phase from 6 onward, not just by
convention — the recurring pattern this project calls out explicitly each time it
appears (Phase 6 evaluate/award, Phase 8 `risk:review`, Phase 9 submit/verify and
approve/execute, Phase 10 manage/inspect, Phase 13's narrowest-grant-in-the-system
`whistleblower:read`/`investigate`).

**V5 — Validation, Sanitization and Encoding.** Pass. Global `ValidationPipe` with
`whitelist: true, forbidNonWhitelisted: true, transform: true` — an unknown field in
any request body is rejected outright (`400`), not silently dropped or accepted;
verified directly this session via the Phase 12 transparency test asserting a
malicious `organizationId` field on a project-creation request is rejected for this
exact reason. Every DTO across all 13 feature phases uses `class-validator`
decorators; none accept unvalidated free-form input. SQL injection: verified this
session — every one of the 5 raw-SQL call sites in the codebase
(`audit.service.ts`, `development-ledger.adapter.ts`, `payments.service.ts`,
`allocations.service.ts`, `health.service.ts`) uses Prisma's tagged-template
`$queryRaw`/`$executeRaw` (automatically parameterized), and a repo-wide grep
confirms zero uses of the genuinely injectable `$queryRawUnsafe`/`$executeRawUnsafe`
anywhere.

**V6 — Stored Cryptography.** Pass. AES-256-GCM for data that must be recovered
(MFA TOTP secrets, evidence files, whistleblower contact info) under distinct,
purpose-specific keys (`MFA_ENCRYPTION_KEY`, `EVIDENCE_ENCRYPTION_KEY`,
`WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY` — verified this session that these are three
separate values, not one key reused three ways). SHA-256 for one-way lookups that
must never be reversed (refresh tokens, MFA backup codes, whistleblower tracking
codes). Ed25519 for audit-event signing. **Partial:** encryption keys are
application-managed environment variables, not HSM/KMS-backed — already documented
as a deliberate, swappable-later prototype choice (SECURITY.md § Digital
Signatures), not new.

**V7 — Error Handling and Logging.** Pass. `AllExceptionsFilter` (verified by
reading it directly this session) guarantees no raw exception message, stack trace,
or database error ever reaches a client — full detail is logged server-side with a
request ID for correlation instead. Structured, request-scoped logging throughout
(`nestjs-pino`). **The one genuinely new logging control from this phase's own
work:** source IP is stripped from the ops-level HTTP request log itself for
`/api/v1/public/whistleblower/*` specifically — verified by direct inspection of
real log lines (see § Whistleblower Portal above).

**V8 — Data Protection.** Pass for classification/minimization; Partial for
retention. Sensitive fields are consistently either hashed (never-recoverable
secrets) or encrypted (recoverable-when-needed sensitive data) — never plaintext;
this was checked file-by-file across every phase, not just asserted. **Gap, newly
named by this review:** no retention/deletion policy or scheduled job exists for
any table — audit events, security events, and whistleblower reports accumulate
indefinitely with no expiry. For an append-only audit trail this is partly by
design (the whole point is immutability), but `security_events` and stale
`sessions`/`devices` rows are reasonable retention-policy candidates that were never
built. Not previously called out explicitly in this document; added to residual
risk below.

**V9 — Communications.** Pass, with the one honest infrastructure caveat this
project has always carried. `helmet()` applied globally — verified directly in
`main.ts` this session, and its `Strict-Transport-Security` header was directly
observed in real response headers during this session's own smoke testing. CORS is
an explicit allow-list from `CORS_ORIGIN`, not `*`. TLS termination itself is a
hosting-platform responsibility (Netlify for the frontend, whatever persistent host
runs the backend — see DEPLOYMENT.md), not something the Node process does directly
— standard practice, not a gap, but worth stating plainly rather than leaving
implicit.

**V10 — Malicious Code (Self-Protection / Supply Chain).** Covered by this phase's
dependency audit rather than restated here: `npm audit` found 9 high-severity
transitive vulnerabilities (`multer` — several DoS vectors, confirmed unreachable
in this codebase since no route uses `FileInterceptor`/multipart uploads anywhere;
`deepmerge-ts`, only reachable via Prisma's own CLI tooling, never at runtime) —
both fixed via minimal, non-breaking `overrides` pinning to patched versions
(`multer ^2.4.0`, `deepmerge-ts ^8.0.2`), re-verified with a full clean reinstall:
`npm audit` now reports 0 vulnerabilities, and the full e2e suite (90/90) and
monorepo build+lint still pass after the change.

**V11 — Business Logic.** Pass. This is the category this project has arguably
invested the most in across every phase: concurrency-safety mechanisms chosen
deliberately by problem shape (advisory lock / row lock / unique constraint / no
lock — DATABASE.md § Conventions catalogs all four with the reasoning for each),
state machines enforced server-side with illegal transitions rejected (`400`) at
every phase from budgets through whistleblower reports, and idempotency where a
client retry could otherwise cause a double side-effect (Phase 9's payment
execution). Rate limiting verified this session as an actual working control, not
just configuration: 105 rapid requests to a real endpoint returned exactly 100
`200`s then `429`s, matching `RATE_LIMIT_MAX=100` precisely (see DEPLOYMENT.md §
Load Testing).

**V12 — Files and Resources.** Pass, and this review found and fixed a genuine bug
along the way rather than only documenting a gap. Every file-accepting endpoint
across Phases 7/10/13 validates content server-side (SHA-256 computed from the
actual decoded bytes, never trusted from the client) and stores through the
`ObjectStorageAdapter` abstraction with path-traversal defense
(`FilesystemObjectStorageAdapter.resolvePath()` rejects any key that would escape
the configured base path) rather than raw filesystem writes. **Checking the actual
request-body size limit (rather than assuming a sane one existed) surfaced two real
problems, not one:** Express/body-parser's undocumented-at-the-call-site default
(100kb) was in effect everywhere, which would silently break the evidence-upload
feature itself for any realistically-sized photo or PDF — a functional bug, not
just a missing security control — and when that limit *was* hit, the resulting
error fell through `AllExceptionsFilter`'s catch-all branch as a raw, unhelpful
`500` instead of a proper `413`, because body-parser's error is a plain `Error`
carrying `status: 413` via the `http-errors` package convention, not a NestJS
`HttpException`. Both fixed: `main.ts` now sets an explicit, considered 15mb JSON
limit (generous enough for a real compliance document or inspection photo, still
bounded against abuse), and `AllExceptionsFilter` now recognizes any non-HttpException
error carrying a legitimate 4xx `status`/`statusCode` and reflects it correctly
(scoped to 4xx only — a claimed 5xx status from a non-HttpException is still not
trusted, preserving the filter's core guarantee of never leaking internal detail).
Verified directly: a ~666KB real evidence upload that previously failed now
succeeds; a genuinely oversized ~27MB payload now returns a clean `413` with a
sensible message instead of an opaque `500`. Permanent regression coverage added in
`app.e2e-spec.ts`.

**V13 — API and Web Service.** Pass. Consistent `/api/v1` versioning, consistent
error shape (`AllExceptionsFilter`), consistent pagination (`skip`/`take` with a
default across every list endpoint), and the OpenAPI/Swagger UI explicitly disabled
outside `NODE_ENV !== 'production'` (verified directly in `main.ts`) — a production
deployment never exposes interactive API documentation publicly.

**V14 — Configuration.** Pass. Fail-closed environment validation at boot (Zod
schema — the app refuses to start with a missing/malformed required variable,
including every encryption/signing key), `.env` correctly excluded from version
control (verified this session: `git check-ignore` confirms all four `.env` files
in the repo — root, `apps/api`, `apps/web`, `packages/database` — are ignored, and
a full-repo grep for the real Neon credentials supplied this session found zero
matches outside the gitignored `.env`), and `.env.example` contains no real secret
values, only placeholders (verified directly this session).

**New residual risks this review surfaced** (not previously documented elsewhere):
1. No data retention/deletion policy for `security_events` or stale
   `sessions`/`devices` rows (V8) — they accumulate indefinitely.
2. No step-up (re-authentication) requirement for high-consequence actions
   (payment execution, whistleblower status changes) beyond holding a valid
   session (V2) — a stolen/replayed access token within its TTL can perform them.
3. The 15mb JSON body limit (V12, fixed above) is a single global value applied to
   every route, not scoped per-endpoint — a route with no legitimate reason to
   accept a large body (e.g. a plain status-change action) still technically
   accepts up to the same 15mb before body-parser rejects it, rather than a
   tighter, route-specific ceiling. A real hardening pass beyond this one could
   scope the limit per-route; not done here since it would require touching every
   controller rather than one central configuration point.

## Data Privacy

Designed against Kenyan data protection expectations and privacy-by-design generally:
data classification, minimization, retention policies, encryption of sensitive fields,
and privacy-aware public reporting (the Citizen Transparency Portal never exposes
personal identifiers, bank details, or whistleblower identity, even though the
underlying transaction is public).

## Current Implementation Status (Phases 1–13)

Implemented now: strict TypeScript, centralized validation pipe, centralized exception
filter (no raw errors leaked), `helmet` security headers, CORS allow-list from env,
structured request-scoped logging, environment variable validation at boot (fail closed
— the app refuses to start with a missing/invalid required variable, including
`JWT_SECRET`/`MFA_ENCRYPTION_KEY`/audit signing key checks), Argon2id password hashing,
JWT access + rotating refresh tokens with reuse detection, TOTP + backup-code MFA,
account lockout, RBAC via permission-scoped guards, append-only security event logging,
an append-only, hash-chained, Ed25519-signed audit trail with a working
tamper-detection verification endpoint, a blockchain integrity layer (development
ledger adapter) that periodically anchors that audit chain with its own independent,
tamper-evident hash chain, row-locked commitment-control accounting on budget
allocations that provably cannot be over-committed even under concurrent load, a full
procurement lifecycle (plan → request → tender → bid → evaluation → award) that draws
on that same budget-commitment safety property and adds unique-constraint-based
"exactly one winner" award integrity, supplier management (extended profile,
beneficial-ownership disclosure with a first-class politically-exposed-person flag,
hash-verified compliance documents, append-only manual risk assessments, and a
suspend/blacklist status machine that provably — not just nominally — blocks bidding),
an AI Risk Engine (four deterministic/statistical detectors wired into real
lifecycle events, a review queue with role-based separation of duties that provably
excludes the role most likely to have a conflict of interest, and a design that makes
autonomous adverse action structurally impossible rather than merely policy-forbidden),
and the full contract-to-payment lifecycle (Contract → Purchase Order → Invoice →
multi-signature-approved, Idempotency-Key-protected Payment → reconciliation) — the
first real payment-execution path in the system, and the first place
`Idempotency-Key` support (deferred since Phase 5) actually exists. Phase 10 adds
project verification (Contract → Project → Milestone → independent Engineer
inspection, with a milestone-list-freezing gate that makes auto-completion
trustworthy) and the first real encrypted object storage backend in the system
(AES-256-GCM at rest, genuine bytes persisted and retrievable — not hash-only),
with two independently-verified tamper-detection paths on evidence download. Phase
11 adds the Auditor Portal's transaction reconstruction: any resource's full audit
history, independently re-verified event-by-event with blockchain anchor status
composed in, isolated correctly by `resourceId` even when tampering exists
elsewhere in the shared chain — no new schema, purely a new, more powerful way to
query and compose the audit/blockchain infrastructure Phases 3–4 already built.
Phase 12 adds the first genuinely unauthenticated API surface: public,
privacy-filtered search over projects/tenders/suppliers/budgets and a public
hash-verification tool that reuses Phases 3/4/10's already-proven verification
logic without exposing any actor identity, sensitive supplier data, or losing-bid
detail — see § Public Transparency Surface above for the full account. Phase 13
adds the Whistleblower Portal: anonymous reporting via a possession-based tracking
code rather than a login, encrypted evidence reusing Phase 10's storage pattern
as-is, a two-way anonymous investigator conversation thread, audit events with no
actor/IP for the anonymous side specifically (while investigator actions remain
fully attributed), source-IP stripping at the ops-log level for this one route
prefix, and the narrowest permission grant in the system
(`whistleblower:read`/`investigate`, Auditor/Internal Auditor only) — see §
Whistleblower Portal above for the full account.

Not yet implemented (tracked in IMPLEMENTATION_PLAN.md against their owning phase):
ABAC, a real permissioned-blockchain adapter (Hyperledger Fabric/Besu — only the
development ledger simulation exists), business-action digital signatures
(tender/bid/award/payment — the signing primitive exists and is proven, just not yet
called from those not-yet-built modules), duplicate-invoice detection (the `Invoice`
entity now exists, but Phase 8's detector suite hasn't been extended to it yet),
supplier compliance documents still remain hash-only (the object storage backend
built in Phase 10 was scoped to project evidence; extending it to supplier documents
is a straightforward follow-up, not a new capability), row-level security, step-up
authentication, login-anomaly detection, API key issuance, a configurable policy
engine (section 52/18 — budget, procurement, and supplier status-change approvals
remain single-approver, fixed-RBAC; payment approval is the one place multi-signature
is actually implemented, but with a fixed threshold, not a configurable policy
engine), no partial-commitment tracking when multiple contracts share one originating
budget commitment (a Phase 5 scope boundary Phase 9 inherits rather than fixes),
payment execution is a simulated abstraction with no real bank/mobile-money
integration, filesystem object storage is a local simulation rather than real
S3/cloud storage (swappable without caller changes, per `ObjectStorageAdapter`, but
not yet swapped), no Invoice-eligibility gating tied to milestone verification (a
residual integration opportunity between Phase 9 and Phase 10, not built in this
pass), and reconstruction (Phase 11) is a single-resource lookup — there is no
cross-resource case view that walks known relationships as one combined timeline
(e.g. Award → Contract → PaymentRequest), and no saved-search/case-notes/export
capability for an investigating auditor. The Citizen Transparency Portal (Phase
12) has no cross-resource public timeline either (a citizen looks up a project,
tender, and supplier separately, not as one connected story), no public
map/geospatial view despite `Project.location` existing as free text, and no
public RSS/webhook feed for external monitoring of newly-published tenders. The
Whistleblower Portal (Phase 13) has no rate limiting specific to report
submission beyond the existing global limit (a low-volume spam/nuisance-report
risk, not a data-exposure one), no automated duplicate/similar-report detection,
no cross-resource link from a report to a related resource elsewhere in the
system (an investigator connects a report to, say, the tender it concerns
manually), and the ops-level IP-redaction fix is application-layer only — a real
deployment behind a reverse proxy or CDN would need an equivalent access-log
exemption configured there too for genuinely complete IP protection, which a
local dev setup can't demonstrate. Nothing in this document describes a control
that is claimed as done without it being reflected as ✅ in
IMPLEMENTATION_PLAN.md.
