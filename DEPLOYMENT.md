# B-PFMPS Deployment Architecture

## Overview

| Component | Host | Notes |
|---|---|---|
| Frontend (`apps/web`) | **Netlify** | Static Vite build, SPA redirects, `netlify.toml` |
| Backend (`apps/api`) | Persistent container host (Render / Fly.io / Railway / ECS — any host that runs a long-lived Node process) | Not Netlify Functions — see below |
| Database | **Neon** (serverless PostgreSQL) | Reached only from the backend |
| Object storage (Phase 10+) | S3-compatible bucket | Reached only from the backend |

## Why Not Netlify Functions for the API

NestJS here is a persistent server: it holds a pooled database connection, is designed
to support WebSocket connections (real-time notifications, live audit/risk feeds), and
will run scheduled background jobs (blockchain anchoring, notification delivery). Netlify
Functions are short-lived, per-invocation, stateless — a poor fit for a pooled DB
connection and unsuitable for WebSockets or long-running scheduled jobs. Forcing NestJS
into that model would mean re-establishing a database connection on every invocation
(latency + Neon connection-limit pressure) and abandoning WebSocket support. The backend
is therefore deployed as its own persistent service, and `netlify.toml` proxies
`/api/*` requests from the Netlify-hosted frontend origin to that backend origin, so the
browser only ever talks to one origin (avoiding CORS complexity and keeping cookies,
where used, first-party).

## Environment Separation

Three environments — `development`, `staging`, `production` — each with its own Neon
project/branch and its own `.env` (never shared, never committed). Neon's branching
feature is well suited to giving each PR/staging environment its own database branch
later; that is a Phase 14 hardening concern, not required for Phase 1.

## Frontend — Netlify

`apps/web/netlify.toml`:
- Build command: `npm run build` (from `apps/web`)
- Publish directory: `dist`
- SPA fallback: all routes rewrite to `/index.html` (Vue Router history mode)
- Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`,
  `Content-Security-Policy` (tightened per-phase as real external origins are known)
- Only `VITE_*`-prefixed environment variables are ever read by the frontend build.
  **Never** place `JWT_SECRET`, `DATABASE_URL`, encryption keys, or any backend secret
  in a Netlify frontend environment variable — those live only in the backend host's
  environment configuration.

## Backend

- Build: `npm run build --workspace=apps/api` → `apps/api/dist`
- Start: `node apps/api/dist/main.js`
- Required environment variables: see `.env.example` (private section).
- `DATABASE_URL` should be Neon's **pooled** connection string for the running app;
  `DIRECT_DATABASE_URL` (Neon's direct/non-pooled string) is used only for
  `prisma migrate deploy` during release.
- Migrations run as an explicit release step (`prisma migrate deploy`), never
  automatically on every boot, and never by hand-editing the production schema.

## Local Development (this environment's verification setup)

For the great majority of this project's development, no real Neon project was
available in this environment. To verify the stack end-to-end without fabricating
results, local development used:

```bash
docker run --name bpfmps-postgres -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=bpfmps -p 55432:5432 -d postgres:16
```

with `DATABASE_URL=postgresql://postgres:postgres@localhost:55432/bpfmps` in
`apps/api/.env`. Because Neon is standard PostgreSQL, switching to a real Neon project
for any real environment is purely a connection-string change — no schema or code
changes are required, and Phase 14 confirmed this directly: real Neon pooled/direct
connection strings were supplied and dropped into `apps/api/.env` with zero code
changes needed. **Schema deployment against that real Neon project was attempted
(`prisma migrate deploy`) and blocked by this environment's own safety tooling as a
"production deploy" action** — a reasonable guardrail for a real, credentialed cloud
database that this agent should not unilaterally alter. This is deliberately left as
a pending, explicit human action rather than worked around: the person running this
should execute `npm run prisma:migrate:deploy` (from `packages/database`, with
`DATABASE_URL`/`DIRECT_DATABASE_URL` in `apps/api/.env` pointed at the real Neon
project) themselves, then `npm run prisma:seed`, to actually stand up the schema on
Neon. Everything else in this document describing Neon is accurate and current
(connection string format, pooled-vs-direct usage, `connection_limit` tuning below);
only the one-time schema deployment itself remains undone by design.

## CI/CD

A real GitHub Actions pipeline exists at `.github/workflows/ci.yml` (section 35):
checkout → install → build every package → generate the Prisma client → apply
migrations → seed → lint → build (api + web) → the full e2e suite (90 tests across
12 spec files as of Phase 13), running against a genuine ephemeral PostgreSQL 16
service container (not a mock), on every push and pull request to `main`/`master`.
Every secret-shaped environment variable the pipeline needs (`JWT_SECRET`,
`MFA_ENCRYPTION_KEY`, `EVIDENCE_ENCRYPTION_KEY`,
`WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY`, the audit-signing Ed25519 keypair) is
generated fresh at the start of each run and discarded with the runner — deliberately
never a stored repository secret, since there is nothing here that needs to persist
or be protected: the database is a throwaway container seeded with clearly-labeled
DEMO/TEST data (section 47) and destroyed at the job's end. **Honest scope note: this
workflow was written and every command in it individually verified to work correctly
against the same local Postgres this project develops against, but the workflow file
itself has not yet been run by GitHub Actions**, since that requires the repository
to actually exist on GitHub — which is the next step, described below. No deploy
step exists yet; see the note in `.github/workflows/ci.yml`'s own header comment for
why that's deliberately deferred rather than half-built.

## GitHub Repository

This project's repository is `https://github.com/clement645/anticorruption`. As of
this document, the local working tree has not yet been pushed there — publishing the
first commit(s) to a real, shared remote is treated as a deliberate, confirmed action
(see IMPLEMENTATION_PLAN.md Phase 14), not something done automatically alongside
everything else in this pass.

## Backup & Disaster Recovery (Phase 14)

**Database.** Neon's own infrastructure is the primary backup/DR mechanism, not
anything this application builds itself — matching the general principle already
used elsewhere in this project (rely on the managed platform's real capability
rather than half-reimplementing it):
- **Point-in-time recovery**: Neon retains a continuous history of every project
  (retention window depends on plan) and can restore to any point within it, or
  create a new branch from any historical point without touching the live database
  — the standard way to investigate/recover from an accidental bad migration or a
  bulk-delete mistake without a separate backup pipeline to maintain.
- **Branching for recovery drills**: because a Neon branch is a genuine
  copy-on-write clone, a real recovery drill (restore to a point in time, verify
  the schema and a sample of business data, discard the branch) can be performed
  routinely against a throwaway branch without any risk to the live database or
  any custom tooling — this is the concrete DR *procedure* this design recommends,
  not just a capability note. Not yet exercised in this pass (see Residual risk).
- **Migration safety**: `prisma migrate deploy` (used in CI and for release, never
  `migrate dev` against a real environment) only ever applies forward migrations
  already reviewed and tested locally/in CI — the actual highest-leverage
  "disaster" this system can inflict on itself is a bad migration, and the
  mitigation is process (review + CI verification before deploy), not a
  runtime safety net.
- **Application-level immutability as a second, independent line of defense**: the
  audit trail (Phase 3) and blockchain integrity layer (Phase 4) are themselves a
  form of tamper-evident backup for the *history* of what happened, distinct from
  Neon's own infrastructure-level backup of current state — even in a scenario
  where current-state data were somehow corrupted, the hash-chained audit log
  (assuming it, too, wasn't corrupted in the same incident) would let an
  investigator reconstruct what the correct state should have been.

**Object storage** (evidence vault, Phase 10/13). The local filesystem adapter used
throughout this project is explicitly documented (SECURITY.md, IMPLEMENTATION_PLAN.md)
as a local simulation with no independent backup story of its own — a real deployment
swapping to the reserved S3-compatible `ObjectStorageAdapter` slot gets that bucket's
own versioning/replication for free, the same "swap the adapter, not the caller"
design Phase 10 built specifically to make this possible without any application code
changing.

**RTO/RPO**: not formally set in this pass — doing so meaningfully requires an actual
production deployment with real traffic/SLA expectations to size against, which this
prototype does not have. What this section commits to instead is the *mechanism*
(Neon PITR + branching, forward-only reviewed migrations, independent audit trail) a
real RTO/RPO target would be built on top of.

**Residual risk:** no actual recovery drill has been performed against the real Neon
project (branch-restore-verify-discard) — the mechanism is real and available, but
"documented as available" and "exercised at least once" are different claims, and
only the first is true as of this pass.

## Load Testing & Capacity (Phase 14)

A real load test (`autocannon`, not a design estimate) was run against the local dev
API (`apps/api`, local Postgres) to find and fix a genuine capacity issue rather than
just assert the system would perform adequately.

**Method:** `npx autocannon -c <connections> -d 15 http://localhost:3000/api/v1/...`
against three endpoints of increasing realism: `/health` (no DB access — a pure
Node/Express/NestJS routing-overhead baseline), `/health/ready` (one trivial `SELECT
1` DB round-trip), and `/public/projects` (a real business query: `findMany` + `count`
in one transaction, joined to `organization`, against a table with 821 rows —
realistic accumulated volume from this project's own extensive e2e testing, not a
synthetic dataset).

**Finding:** at 20 concurrent connections, `/public/projects` managed only ~200 req/s
median with a heavy latency tail (p99 570ms, max 2.3s) — markedly worse, proportionally,
than the two trivial endpoints. Re-running at 5 concurrent connections *increased*
median throughput to ~395 req/s with tight, low latency (p50 11ms) — the classic
signature of connection-pool queuing, not raw per-request slowness: beyond the pool's
effective concurrency, additional concurrent requests wait rather than being served in
parallel, and the queuing overhead itself measurably hurts aggregate throughput.
Confirmed root cause: no explicit Prisma `connection_limit` was ever configured
anywhere in this project — Prisma's undocumented-at-the-call-site default
(`num_physical_cpus * 2 + 1`, ~9 on this 4-core sandbox) was silently governing
production-relevant concurrency this whole time.

**Fix:** added `connection_limit=20&pool_timeout=10` to `DATABASE_URL` (both the local
`.env` and the `.env.example` template, with the reasoning documented inline there).
Re-running the identical 20-connection test after the fix: median throughput more
than doubled (200 → 434 req/s) and the latency tail collapsed (p99 570ms → 81ms, max
2.3s → 308ms) — verified before/after, not assumed from the change alone.

**Rate limiting, verified as a control, not just configured:** 105 rapid sequential
requests to `/health` returned `200` for the first 100 and `429` for the remaining 5
— exactly matching `RATE_LIMIT_MAX=100`/`RATE_LIMIT_TTL=60`. The load test above was
run with `RATE_LIMIT_MAX` temporarily raised (to measure raw capacity rather than the
rate limiter's own deliberate ceiling) and restored to its production value
immediately afterward — the rate limiter itself is a real, working control, verified
directly, not merely present in the code.

**Guidance for a real deployment (Neon):** `connection_limit` should be set based on
how many app instances share the Neon project's own connection ceiling on the pooled
endpoint (Neon's PgBouncer-style pooler multiplexes many app-level connections over
fewer actual Postgres backend connections — this is exactly why `DATABASE_URL` is
meant to be the **pooled** connection string, not the direct one, for the running
app) — a single fixed number copied from this local test is a starting point for
tuning, not a production-ready value on its own, and is flagged as such rather than
presented as a solved problem.

**Residual risk:** load testing covered read-heavy public endpoints only, at moderate
concurrency (5-20 connections) for short durations (15s) against local Postgres —
not a sustained, high-concurrency, write-heavy test (e.g. concurrent payment
execution or evidence upload at scale), and not against real Neon (where network
latency and the pooler's own behavior would change the numbers). This is real evidence
of a real, fixed problem — not a comprehensive capacity/performance certification.
