# B-PFMPS Architecture

## 1. Purpose

B-PFMPS is corruption-resistant, tamper-evident, cryptographically accountable public
financial management and procurement infrastructure. It does **not** claim blockchain
makes corruption impossible. It makes unauthorized modification of financial and
procurement records difficult and highly detectable, and makes every high-value action
attributable to an authenticated, authorized actor.

## 2. Layered Architecture

```
CLIENT (Vue 3 SPA — role-specific portals)
   │
   ▼
API Gateway (NestJS HTTP layer: versioning, rate limiting, validation)
   │
   ▼
Identity / Authentication (sessions, JWT, MFA, device tracking)
   │
   ▼
Authorization / Policy Engine (RBAC + ABAC + configurable PolicyRule)
   │
   ▼
Application Services (budget, procurement, supplier, contract, payment, project)
   │
   ▼
PostgreSQL / Neon (system of record — transactional, constrained, indexed)
   │
   ▼
Blockchain Integrity Layer (hash anchoring + verification, abstracted adapter)
   │
   ▼
AI Risk Engine (explainable, deterministic-first detectors; human review required)
   │
   ▼
Evidence Storage (encrypted object storage + SHA-256 hash + blockchain anchor)
   │
   ▼
Audit / Reporting / Public Transparency (append-only, hash-chained, publicly verifiable)
```

Each layer only calls the layer(s) directly below it through a typed interface —
business services never talk to Prisma/blockchain/storage clients directly except
through their respective module's service class. This keeps the boundaries in section
37 real, not aspirational, and is what lets any layer (e.g. the blockchain adapter) be
swapped later without touching business logic.

## 3. Guiding Principles

- **Zero Trust** — every request is authenticated and authorized independently; being
  logged in is necessary but never sufficient.
- **Least privilege** — RBAC/ABAC grants the minimum permission needed for a role,
  scoped by organization, department, financial threshold, and procurement stage.
- **Defense in depth** — validation, authorization, and audit logging are enforced at
  the API layer, not just the UI.
- **Secure by default / fail closed** — ambiguous or failed authorization, verification,
  or integrity checks reject the action rather than allowing it.
- **Separation of duties** — no single actor can both request and approve high-value
  financial actions (enforced later via multi-signature approval policies in Phase 9).
- **Immutable auditability** — audit events are append-only, hash-chained, and
  periodically anchored to the blockchain integrity layer.
- **Explicit authorization** — every protected endpoint declares the permission(s) it
  requires; there is no implicit "authenticated users can access everything".

## 4. Repository Structure (monorepo, npm workspaces)

```
bp-fpmps/                      (repo root — package name: bp-fpmps)
├── apps/
│   ├── web/                   Vue 3 + TypeScript + Vite frontend
│   └── api/                   NestJS + TypeScript backend (modular monolith)
├── packages/
│   ├── database/              Prisma schema, migrations, generated client wrapper
│   ├── crypto/                Hashing / signing primitives (Phases 2–3)
│   ├── blockchain/            BlockchainAdapter interface/types (Phase 4; concrete
│   │                          adapters live in apps/api — see § Module Boundaries)
│   ├── storage/                ObjectStorageAdapter interface/types (Phase 10; concrete
│   │                          adapters live in apps/api, same pattern as blockchain/)
│   ├── shared/                Shared TypeScript types/DTOs used by web + api
│   └── config/                Shared lint/tsconfig base and env schema
├── docs/                      Supplementary docs (diagrams, ERDs, sequence diagrams)
├── infra/                     Deployment/infrastructure config (Netlify, CI, Docker)
├── tests/                     Cross-cutting E2E/security test suites (Playwright)
├── IMPLEMENTATION_PLAN.md
├── ARCHITECTURE.md
├── DATABASE.md
├── API.md
├── SECURITY.md
├── THREAT_MODEL.md
└── DEPLOYMENT.md
```

This is intentionally a **modular monolith**, not microservices. Module boundaries
inside `apps/api/src/modules/*` are drawn so that any module (e.g. `risk-engine`,
`blockchain`) can be extracted into its own service later without a rewrite, per
section 37/42 of the governing spec: don't build unnecessary microservice complexity
during the initial prototype.

## 5. Backend Module Boundaries (planned, populated phase by phase)

```
apps/api/src/
├── main.ts
├── app.module.ts
├── common/           filters, interceptors, guards, decorators, pipes
├── config/           typed configuration + validation (Joi/Zod)
├── modules/
│   ├── health/        ✅ Phase 1
│   ├── iam/            ✅ Phase 2 (users, roles, permissions, auth, sessions, MFA)
│   ├── audit/          ✅ Phase 3 (append-only audit events, hash chain, signing);
│   │                       extended in Phase 11 with transaction reconstruction —
│   │                       no new business entity, just a new query shape over
│   │                       the existing chain
│   ├── blockchain/     ✅ Phase 4 (development ledger adapter, anchoring job)
│   ├── budget/         ✅ Phase 5 (fiscal years, budgets, allocations, commitments)
│   ├── procurement/    ✅ Phase 6 (plans, requests, tenders, bids, evaluation, awards)
│   ├── supplier/       ✅ Phase 7 (profile, ownership, documents, risk profiles)
│   ├── risk/           ✅ Phase 8 (price anomaly, bid collusion, split procurement, supplier risk)
│   ├── contracts/      ✅ Phase 9 (contracts, POs, invoices, multi-sig payments)
│   ├── storage/        ✅ Phase 10 (ObjectStorageAdapter DI token + filesystem adapter)
│   ├── projects/       ✅ Phase 10 (projects, milestones, inspections, evidence vault)
│   ├── transparency/   ✅ Phase 12 (public, unauthenticated read-only search +
│   │                       hash verification — @Public() routes, no new schema)
│   └── whistleblower/  ✅ Phase 13 (anonymous reporting + investigator
│                           workflow — two controllers, one @Public(), sharing
│                           one service; no new schema pattern, reuses Phase
│                           10's ObjectStorageAdapter/BlockchainAdapter as-is)
```

## 6. Frontend Portals (planned)

A single Vue 3 SPA (`apps/web`) with role-aware routing (Vue Router + Pinia auth
store), presenting distinct portal experiences from one codebase:

1. Administration Portal · 2. Finance Portal · 3. Procurement Portal ·
4. Supplier Portal · 5. Auditor Portal · 6. Project Verification Portal ·
7. Citizen Transparency Portal (public, unauthenticated) · 8. Whistleblower Portal
   (public-facing, anonymous-friendly)

Backend authorization is authoritative in every case; frontend routing/UI gating is a
convenience only, per section 28/29.

## 7. Blockchain vs. Database (section 40)

PostgreSQL/Neon is the **system of record** for all operational data (users, suppliers,
budgets, procurement, invoices, reporting). The blockchain integrity layer stores only:
hashes, critical state-transition events, signatures, transaction references, evidence
hashes, and periodic audit anchors. Large documents (contracts, photos, reports) live in
encrypted object storage; only their SHA-256 hash is anchored on-chain. `packages/blockchain`
defines the `BlockchainAdapter` interface (section 54); the concrete
`DevelopmentLedgerAdapter` (`apps/api/src/modules/blockchain`, Phase 4 ✅) implements it
as a self-contained, hash-chained ledger simulation — itself stored in PostgreSQL for
this prototype, kept in its own tables with no foreign key to `audit_events` (a loose
string reference only), and swappable for a real permissioned ledger (Hyperledger
Fabric/Besu) later without any caller changing. See SECURITY.md § Blockchain Integrity
Layer for the honest limitation this implies today (both chains share one physical
database) and THREAT_MODEL.md Phase 4 for the full threat model.

As of Phase 10, "encrypted object storage" above is real, not aspirational:
`packages/storage` defines the `ObjectStorageAdapter` interface, mirroring
`BlockchainAdapter`'s exact pattern, and `FilesystemObjectStorageAdapter`
(`apps/api/src/modules/storage`) is a concrete local implementation — files are
AES-256-GCM encrypted at rest and genuinely written to/read from disk, not
hash-only. This is the same "prove it against a real local stand-in, swappable
later" judgment already made for `DATABASE_URL` (local Postgres vs Neon) and
`BLOCKCHAIN_ADAPTER` (development ledger vs a future permissioned chain) — a
future S3-compatible adapter is a drop-in `ObjectStorageAdapter` implementation,
no caller changes required. Evidence hashes are anchored immediately per-file
via a direct `blockchain.anchorHash()` call rather than through the periodic
`AuditService` rollup, since each piece of evidence is independently significant.

## 8. Hosting Architecture

- **Frontend (`apps/web`)** — static build deployed to **Netlify**. Only `VITE_*`
  (public, build-time) variables are ever embedded in this bundle.
- **Backend (`apps/api`)** — NestJS is a **persistent, stateful server process**
  (long-lived DB connection pool, WebSocket support, scheduled jobs for blockchain
  anchoring). This is not a good fit for Netlify Functions' short-lived, per-invocation
  execution model, so the API is deployed as its own persistent service (e.g. a
  container on Render/Fly.io/Railway/ECS — see DEPLOYMENT.md) rather than forced into
  Netlify Functions. Netlify's `netlify.toml` proxies `/api/*` to that backend origin so
  the browser only ever talks to one origin. This decision is revisited in DEPLOYMENT.md
  section "Why not Netlify Functions for the API".
- **Database** — Neon serverless PostgreSQL, reached only from the backend, never
  directly from the browser.

## 9. Verification Notes (Phase 1)

For the great majority of this project, no real Neon project credentials were
available. To actually prove the Prisma schema, migrations, and NestJS↔PostgreSQL
connectivity work (rather than just asserting it), a local PostgreSQL 16 instance
was started via Docker and used as `DATABASE_URL` for verification. Neon is
wire-compatible PostgreSQL, so no application code changes are required to point at
a real Neon connection string — only the `.env` value changes (see DEPLOYMENT.md).
This substitution is recorded here for transparency, per the governing instruction
not to claim something works without having verified it. Phase 14 confirmed this
claim directly: real Neon pooled/direct connection strings were supplied and worked
immediately with zero code changes — only schema deployment against that real
project remains a pending, explicit human step (see DEPLOYMENT.md § Local
Development).
