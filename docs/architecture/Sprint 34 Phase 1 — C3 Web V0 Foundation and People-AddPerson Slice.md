# Sprint 34 Phase 1 — C3 Web V0 Foundation + People/AddPerson Vertical Slice

**Status:** COMPLETE for owner review. Nothing deployed externally; the frozen
SharePoint 1.0.0.8 baseline is untouched. Automated evidence is green on a real
PostgreSQL (embedded, no Docker required) and a real browser (Playwright).

Locked architecture honoured exactly: Vite + React + TS + Fluent UI v9 +
TanStack Query (web); Fastify + TS REST + generated OpenAPI + PostgreSQL +
Drizzle ORM (api); OIDC abstraction with Entra as the first provider; shared DB
multi-tenancy with `tenant_id` on every operational/governance record,
application-layer enforcement + PostgreSQL RLS as defense in depth, fail-closed
on missing tenant context. No Next.js / PnP.js / GraphQL / tRPC / Prisma; npm
workspaces retained.

---

## 1. Final repository state
- New commits on `master` (HEAD `9a3d075`), Phase-0 report at `673d963`:
  scaffold+domain+authz `4714e53`; persistence+RLS `68a75ac`; application+
  contracts `9f07226`; API+auth+OpenAPI `372bdc1`; web+E2E `9a3d075`.
- Working tree clean apart from the intentionally-untracked `docs/Handoff v2/`,
  `docs/fable/` and this doc set.
- **Frozen SharePoint baseline unchanged**: `git diff 673d963 HEAD -- packages/c3
  packages/c3-spfx-host packages/c3-runtime packages/runtime-sdk` is EMPTY. Only
  additive root-manifest entries (new workspaces + `webv0:*` scripts). No frozen
  package was modified, rebuilt, packaged, or deployed.

## 2. Created package/application structure
```
apps/
  api/   @c3web/api   Fastify server, auth boundary, /api/v1, OpenAPI gen, e2e harness
  web/   @c3web/web   Vite React SPA, URL router, Playwright E2E
packages/
  domain/        @c3web/domain        pure business core (no fw/db/http/SP)
  authz/         @c3web/authz         single server-side authorization module
  api-contracts/ @c3web/api-contracts isomorphic zod wire contract
  application/   @c3web/application   use-cases + persistence ports (hexagonal)
  persistence/   @c3web/persistence   Drizzle + SQL migrations + RLS + tenant ctx
  test-support/  @c3web/test-support  embedded-postgres harness (real PG, no Docker)
infra/  docker-compose.yml (dev PG) + docker-compose.staging.yml
```
Dependency direction: `domain` ← `authz` ← `application` (defines ports) ←
`persistence` (implements ports); `api` wires all; `web` talks only to `api`
over HTTP (never imports persistence). The SharePoint adapters were NOT moved.

## 3. Extracted domain map (SP coupling removed)
From the frozen reference into `@c3web/domain`, with SharePoint numeric Id,
field names, list assumptions, SPFx/browser deps, and Title-as-identity removed:
- `roles.ts` — 7 roles + capability matrix (role RESOLUTION moved to the auth boundary).
- `identity.ts` — canonical identity + fail-closed self-review (SP claim-prefix
  stripping deliberately moved to the auth boundary; a **compiled parity test**
  vs the frozen `utils/identity.ts` proves agreement for all provider-neutral inputs).
- `businessIds.ts` — PER-XXXX / APR-XXXX formatting; numeric suffix never an addressable key.
- `lifecycle.ts` — approval statuses + legal transitions (review vs execution distinct).
- `person.ts` / `approval.ts` — Person entity + AddPerson input/payload (zod, single source).
- `audit.ts` — append-only ApprovalEvent + AuditEvent definitions.
- `errors.ts` — storage-neutral error taxonomy with stable codes.

## 4. Database schema & migrations
Applied from an empty DB by `runMigrations` (privileged admin connection), each
tracked in `_migrations`:
- `0001_schema.sql` — tenant, app_user, tenant_membership, role_assignment,
  business_id_counter, approval, person, approval_event, audit_event. UUID PKs;
  tenant-scoped unique business keys `(tenant_id, person_id)` / `(tenant_id,
  approval_id)`; distinct approval review vs execution columns; triggers:
  updated_at, **immutable approval submission** (payload/submitted_by/… write-once),
  **append-only** approval_event/audit_event; `person.created_by_approval_id`
  UNIQUE = one-person-per-approval idempotency boundary (composite FK to approval).
- `0002_rls.sql` — RLS on all tenant-owned tables; **FORCE** on the data-plane
  tables (owner cannot bypass); tenant context via `current_setting('app.tenant_id')`
  → **missing context = zero rows (fail closed)**.
- `0003_grants.sql` — least-privilege grants to `c3_app`: SELECT/INSERT/UPDATE on
  person/approval/business_id_counter; SELECT/INSERT only on the event streams
  (no UPDATE/DELETE); no DELETE anywhere; no access to identity tables.
Business-ID allocation is an atomic `INSERT … ON CONFLICT DO UPDATE … RETURNING`
(row-locked; **never MAX+1**).

## 5. RLS model
Per-transaction tenant binding: every tenant-scoped access runs inside a
transaction that sets `app.tenant_id` with `is_local = true`, auto-discarded at
COMMIT/ROLLBACK — a pooled connection never carries a prior request's tenant.
The app role is `NOSUPERUSER NOBYPASSRLS`, distinct from the admin/migration
role. Proven (real PG): tenant A cannot read or mutate tenant B; missing context
fails closed; a reused pooled client retains no prior context; admin/app roles
are separate and the app role cannot bypass RLS.

## 6. Authentication boundary
Provider-neutral `AuthAdapter` → `AuthenticatedPrincipal`. Two providers:
- **dev IdP** (`devIdp.ts`) — HS256 signed test tokens, verified exactly like
  production; **hard-disabled when NODE_ENV=production** (env fails closed).
- **Entra OIDC** (`entra.ts`) — RS256/JWKS signature + issuer + audience checks;
  provider claims (`preferred_username`/`upn`/`email`) translated to a canonical
  identity; tenant + role resolved from the directory (privileged connection,
  separate from the RLS app connection). Unit-tested with a local keypair+JWKS —
  **no real Entra credentials needed**.

## 7. Authorization matrix (server-enforced; browser checks are UX-only)
| Capability | owner | operations | read-only (legal/finance/hr/management/visitor) |
| --- | --- | --- | --- |
| read People | ✔ | ✔ | ✔ |
| submit AddPerson | ✔ | ✔ | ✗ |
| begin review / approve / reject | ✔ (not own) | ✗ | ✗ |
| execute | ✔ (not own) | ✗ | ✗ |
| view approvals inbox | ✔ | ✔ | ✗ |
Separation of duties: a submitter may never review/execute their own request
(fail-closed on indeterminate identity). Enforced in `@c3web/authz` and proven
at the API layer (403 SELF_REVIEW_BLOCKED).

## 8. API endpoints + OpenAPI artifact
`/api/v1`: me; people (list, read, audit); approvals (list, submit, read,
begin-review, approve, reject, execute, events, audit); dev/login (dev only);
plus `/health` `/ready`. Every request+response validated by the shared zod
contract; mutations require `expectedVersion` (stale → **409, zero mutation**);
structured error envelope with `correlationId`. **OpenAPI 3.0 generated from the
same zod schemas** → `apps/api/openapi.json` / `openapi.yaml` (15 paths).

## 9. Web routes + reused UI
Real URL router (`react-router-dom`): `/people`, `/people/:personId`,
`/approvals`, `/approvals/:approvalId` — deep links + browser refresh resolve
(SPA fallback). Adapted UI: app shell + role display, People register + AddPerson
panel, Person profile + audit, Approvals inbox, approval detail with review/
approve/reject/execute, inline aria-live notifications, and truthful loading/
empty/denied/failure states. The web app never imports persistence.

## 10. AddPerson lifecycle evidence
Submit → begin-review → approve → execute proven at API and E2E:
submission creates an immutable Submitted approval with a PENDING target and NO
person; approval alone creates no person; execution is ONE transaction that
allocates PER-XXXX, creates exactly one Person, stamps Executed + backfills the
target, appends approval + audit events, commits atomically.

## 11. Transaction / idempotency / concurrency evidence
- Execution is atomic; on rollback no Person remains and no false Executed truth.
- Idempotent: a second execute returns the same person (no duplicate); the
  unique `created_by_approval_id` is the DB-level idempotency boundary.
- Genuine execution fault → ExecutionFailed recorded truthfully; safe retry can
  still reach Executed with exactly one Person (unit-proven via fault injection).
- Stale `expectedVersion` → 409 with zero mutation (API + DB proven).

## 12. Tenant-isolation evidence
API: another tenant gets 404 on read and on mutate; same tenant still sees it.
DB/RLS: cross-tenant read/mutate blocked; missing context fails closed; pooled
connection reuse leaks nothing; admin vs app connection separation verified.

## 13. Test & gate results
- `webv0:typecheck` — all 8 workspaces pass.
- `webv0` test suite — **112 tests green** across 11 files: domain 43 (incl.
  identity parity vs frozen), authz 14, api-contracts 5, application 14 (incl.
  ExecutionFailed + retry), persistence 16 (DB integration on real PG), api 20
  (14 integration + 6 Entra boundary).
- Playwright E2E — **1/1 green**: the full AddPerson workflow through a real
  browser (submit → requester-cannot-review → owner review/approve → no person
  yet → execute → exactly one person → history/audit → deep-link+refresh →
  read-only sees no write affordance).

## 14. Staging-readiness
Containerised artifacts: `apps/api/Dockerfile`, `apps/web/Dockerfile` +
`nginx.conf` (SPA fallback), `infra/docker-compose.staging.yml` (postgres +
migrate one-shot + api + web, with admin/app role separation), `.dockerignore`,
and `docs/runbooks/C3-Web-V0-staging.md`. A local containerised environment and
CI pipeline are authorized; no external provisioning was performed.

## 15. Acceptance criteria — evidence
1. web + API run locally from documented commands — ✔ (runbook; E2E boots both).
2. PostgreSQL starts from Docker Compose — ✔ `infra/docker-compose.yml` (tests
   also run against embedded PG with no Docker).
3. all migrations apply from an empty DB — ✔ (test asserts `_migrations` + tables).
4. all automated tests pass — ✔ 112 + E2E.
5. tenant isolation proven at API and RLS layers — ✔.
6. Operations cannot self-approve or execute — ✔ (403 at API).
7. approval alone does not create a Person — ✔ (API + E2E).
8. execution creates exactly one Person transactionally — ✔.
9. rollback cannot leave false execution truth — ✔.
10. duplicate execution is idempotent — ✔.
11. stale-version mutation returns 409 — ✔.
12. audit and approval events are append-only — ✔ (trigger + grant; DB test).
13. URL navigation and refresh work — ✔ (E2E reload on a deep link).
14. the complete AddPerson workflow passes E2E — ✔.
15. the frozen SharePoint baseline remains unchanged — ✔ (empty git diff).

## 16. Decisions still requiring owner input
- Production **Entra app registration** (issuer/audience/JWKS/redirects) and the
  claim→role mapping strategy (token app-role claim vs directory membership).
- Hosting target (container platform) + managed **PostgreSQL** provider, aligned
  with the c3hq.org Cloudflare footprint.
- **Tenancy provisioning** UX: a tenant-admin / user-role management surface
  (currently admin-seeded) — required before onboarding real tenants.
- Whether to slim the API image by pruning the frozen SPFx workspaces from the
  container install (Phase 2 optimization).
- Go-ahead to begin using c3hq.org DNS / any paid infrastructure.

## Recommended Sprint 34 Phase 2 scope
1. **Tenant & identity administration**: tenant provisioning + user/role
   management UI over `tenant_membership`/`role_assignment`; wire the Entra
   adapter end-to-end in staging (real OIDC login), retire the dev IdP from
   non-dev environments.
2. **Second governed domain — Credentials** (AddCredential + DeactivateCredential):
   proves the pattern generalises (typed payloads, ETag/version concurrency,
   audit) beyond AddPerson.
3. **Contracts read-only + People linkage**: read models, role-gated truthful
   denial (mirrors the certified S33 Visitor boundary), person→contracts view.
4. **Operational hardening**: image slimming, OpenTelemetry traces, a CI
   pipeline running `webv0:gate` + E2E, and a first **staging** deploy (owner-
   gated infrastructure) — still no production cutover.
5. **SharePoint importer (design only)**: begin the read-only `sp-importer`
   spec (frozen lists → relational), no data movement yet.

**No production deployment, DNS change, paid infrastructure, or Entra app
creation was performed. Stopping here for owner review of the Web V0 direction.**
