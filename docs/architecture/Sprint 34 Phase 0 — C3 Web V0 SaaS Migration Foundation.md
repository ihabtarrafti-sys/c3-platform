# Sprint 34 Phase 0 — C3 Web V0 SaaS Migration Foundation

**Status:** architecture extraction + migration plan only. No code, no deploy,
no ACL/schema/data/fixture change. For lead-architect + owner approval before
any Web V0 work begins.

Date: 2026-07-05 · Author: platform engineering (agent).

---

## 1. Verified repository state

- **HEAD = origin/master = `0558a6c`** (docs(s33) Correction Set E closure).
- **Tracked tree clean.** Intentional untracked: `docs/Handoff v2/`, `docs/fable/`
  (owner handoff material, deliberately untracked — never `git add -A`).
- **Certified runtime references:** SPFx solution **1.0.0.8**; runtime asset
  `5c064623998529ae923d0d0c165aceb6b193f6de797e87d3a1c6cec0e81e1a34`; live host
  `5808eff3…`, chunk `0d5d907e…` (byte-verified). Internal V1 hosted behavior
  certified across Owner/Operations/Management/Visitor.
- **Workspaces:** `packages/runtime-sdk` (@geekay/platform-sdk 0.1.0, frozen SDK),
  `packages/c3` (@geekay/c3 — the product: types/services/hooks/screens/components/
  utils), `packages/c3-runtime` (runtime build wrapper), `packages/c3-spfx-host`
  (c-3-spfx-host 0.0.1 — SPFx web part shell).
- **Product package census (`packages/c3/src`):** 20 type files, 12 service
  interfaces, 12 Mock adapters, 12 SharePoint adapters, 8 SP field mappers,
  ~75 hooks, 15 screens, ~40 components, 27 utils; 21 compiled-from-source
  parity suites in `scripts/`.

**Load-bearing finding:** the codebase was **built deployment-agnostic by
design** — ADR-001 (Deployment-Agnostic Architecture), ADR-004 (Stable Service
Contract), ADR-005 (Translation Layer Architecture), ADR-007 (Host
Independence). The service-interface layer is already the stable port; the
SharePoint adapters are an isolated translation edge. This migration is
therefore an **adapter swap + host swap**, not a rewrite.

---

## 2. Reusable-component map

| Layer | Files | Classification |
| --- | --- | --- |
| **Domain types** (`types/*`, 20) | people, contracts, credentials, journeys, mission, logistics, milestones, finance, obligations, missionReadiness, roles, workItems, situation, users, diagnostics, adapterInfo, screens, amendments, protocols | **Reusable unchanged** — zero SP imports (only `adapterInfo`/`diagnostics` carry a `'mock'\|'sharepoint'` mode *label*). One coupling smell: domain types carry a leaked SP `Id: number` alongside the canonical business ID → see §9. |
| **Service interfaces** (`interfaces/I*.ts`, 12 + `approvalPayloads`, `ServiceRegistry`) | IPerson/IContract/ICredential/IJourney/IMission/IApprovals/IApparelProfile/IFinance/IMilestone/IAmendment/IUser/IDiagnostics | **Reusable unchanged** — these ARE the ports for the new persistence adapter. |
| **Business-logic utils** (`utils/*`, non-mapper) | kitLifecycle, missionReadiness, gapComputation, renewalCompute, participantSubmissionGuard, rolePolicy, identity, approvalInboxView, approvalPayloadUtils, financeUtils, dateUtils, credentialLabels, milestoneUtils, urgency, userUtils, participantWrites, workItemGenerators/*, workItemPriority | **Reusable unchanged** — pure, SP-independent; already unit-proven by parity suites. |
| **Error taxonomy** (`services/errors.ts`, ~16 classes) | Concurrency, RowNotFound, DataIntegrity, InvalidTransition, ParticipantConflict, DuplicatePendingRequest, ContractsListUnprovisioned/ReadFailed/ReadIntegrity, ApprovalQueryIntegrity, WritePermission, … | **Reusable after extraction** — semantics are domain-level; a few names ("ListUnprovisioned") are SP-flavoured and should be renamed to storage-neutral terms. |
| **Mock adapters** (`mock/*`, 12) | In-memory implementations of every interface | **Reusable after extraction** — become the test double AND the executable reference for the API/DB contract. |
| **React hooks** (`hooks/*`, ~75) | TanStack Query wrappers, capability/role hooks, submit/execute hooks | **Reusable after extraction** — UI-facing; retarget `useSP()`/service registry from SP to an HTTP API client. 7 hooks touch SP-only diagnostics. |
| **Screens + components** (15 + ~40) | Command Center, People, PersonProfile, Missions, MissionWorkspace, Contracts, ContractProfile, Renewals, SituationRoom, ApprovalInbox, Diagnostics, panels, WorkItemCard, NavRail, NotificationRegion, ErrorBoundary | **Reusable after extraction** — Fluent UI v9; portable to any React host. NavRail/routing is internal state (no URL router) → **reusable after extraction** to a real router. |
| **Notification / failure** (`components/NotificationRegion`, ErrorBoundary, ToasterGuard; `utils/approvalInboxView`) | Toaster-independent inline aria-live feedback (RISK-1), fail-closed empty/denied/error states | **Reusable unchanged** — deliberately host-independent. |
| **Concurrency/ETag** (in SP adapters + `errors.ConcurrencyError`) | IF-MATCH ETag MERGE, 412 conflict handling | **SharePoint-coupled** at the wire; the *concept* (optimistic concurrency) is reusable — maps to a DB `version`/`xmin` column. |
| **SP field mappers** (`mappers/sp*Mapper.ts`, 8; plus `utils/sp*Mapper.ts` duplicates) | SP item → domain object, hard-reject on integrity failure, canonical-ID derivation | **SharePoint-coupled** — belong to the SP *importer*, not the app core. The validation/derivation rules within them are reusable. |
| **SharePoint adapters** (`sharepoint/*`, 12) | Native `fetch` `_api/…`, form digest, OData filters, ETag | **SharePoint-coupled** — become the integration edge / importer. |
| **Host layer** (`hosts/SharePointHost`, `spRoleResolver`, `bootstrap/*`, `App.tsx` tabster sandbox, whole `c3-spfx-host` pkg) | SPFx mount, SP group→role resolution, cold-load/modal fixes (TD-33/34) | **SharePoint-coupled / obsolete for SaaS** — replaced by a web host + real auth. TD-33/34 fixes are SPFx-specific and **retire** with SharePoint. |
| **Finance / Milestone SP adapters** | Stubs (`return []` / throw not-implemented) | **Incomplete / deferred** — Mock has full logic; SP never implemented. Implement directly in Web V0. |
| **Amendment / Activity / Document SP adapters** | Stubs | **Incomplete / deferred** — schemas deferred. |
| **Platform SDK** (`packages/runtime-sdk`) | Frozen platform SDK | **Reusable after extraction** if still needed; candidate to **retire** if it only abstracts SPFx. |
| **Parity suites** (`scripts/s*-parity-*.mjs`, 21) | esbuild-compile real source + exercise | **Reusable after extraction** — keep the domain-logic assertions; drop SP-static-discipline checks; migrate to the new test runner. |

**Net:** ~70% of `packages/c3` (types, interfaces, utils, errors, hooks,
screens, components, mocks) is reusable unchanged or after extraction. The SP
coupling is concentrated in ~20 files (12 adapters + 8 mappers) plus the host
packages.

---

## 3. Complete functionality classification

Do **not** treat the SharePoint NavRail as the full product vision. Combining
the shipped surface with the vision/roadmap docs:

| Function | Classification |
| --- | --- |
| Command Center (work queue, role-gated CTAs) | **Implemented & hosted-proven** |
| People register + Person Profile | **Implemented & hosted-proven** |
| Credentials (add/deactivate, governed) | **Implemented & hosted-proven** |
| Journeys (initiate governed; Suspend/Resume/Complete/Cancel exemptions) | **Implemented & hosted-proven** (initiate partial-stamp recovery = **source/test-only**) |
| Missions (read) | **Implemented & hosted-proven** |
| Mission participants (add/remove governed, reactivation, dup guards) | **Implemented & hosted-proven** |
| Kit / logistics (create/transition/deactivate, ETag) | **Implemented & hosted-proven** |
| Apparel profiles (create/edit, ETag) | **Implemented & hosted-proven** |
| Approvals (full lifecycle, self-approval block, requester immutability) | **Implemented & hosted-proven** |
| Contracts (read-only, canonical-ID, role-gated, truthful denial) | **Implemented & hosted-proven** |
| Renewals (derived from contracts) | **Implemented & hosted-proven** |
| Situation Room (mission readiness) | **Implemented & hosted-proven** |
| Inbox | **Implemented & hosted-proven** |
| Diagnostics | **Implemented, SharePoint-specific** (mode/adapter probe) |
| Settings | **Hidden / stubbed** ("coming soon"; `canManageSettings` gate) |
| Finance (mission finance lines) | **Stubbed in SP / implemented in Mock** → Deferred; build in Web V0 |
| Milestones | **Stubbed in SP / implemented in Mock** → Deferred; build in Web V0 |
| Mission confirmation (write) | **Deferred (TD-26)** |
| Documents | **Missing** (metadata modelled, storage deferred) |
| Notifications (inline region) | **Implemented & hosted-proven**; async/email = **missing** |
| Search | **Missing** (no global search) |
| Reporting / analytics | **Missing** |
| Tenant administration | **Missing** (single-tenant; roles via SP groups) |
| Amendments | **Stubbed / deferred** |

---

## 4. Proposed relational (PostgreSQL) domain model

Principles preserved: canonical business IDs as domain identity (never SP
numeric Id; never parse Title as identity), immutable approval submissions,
**separate approval vs execution state**, append-only audit, soft-deactivation
history, optimistic concurrency, tenant ownership, role boundaries.

**Conventions:** every table has `id uuid pk default gen_random_uuid()`,
`tenant_id uuid not null references tenant(id)`, `created_at`/`updated_at`,
`version integer not null default 0` (optimistic concurrency — replaces ETag),
soft-delete via `is_active boolean` where SP kept history. Business keys are
`unique (tenant_id, business_id)`.

Core tables:

- **tenant** (`id`, `name`, `slug` unique) — new for SaaS.
- **app_user** (`id`, `tenant_id`, `email` unique-per-tenant, `display_name`,
  `is_active`) + **user_role** (`user_id`, `role` enum) — replaces C3_Users +
  SP site groups. Role enum = owner/operations/legal/finance/hr/management/visitor.
- **person** (`id`, `tenant_id`, `person_code` = "PER-XXXX" business key, name,
  ign, nationality, primary_role, personnel_code, team, game_title, department,
  is_active, notes). `unique(tenant_id, person_code)`.
- **contract** (`id`, `tenant_id`, `contract_code` = "GKE-…" business key,
  `person_id fk`, type, stage enum, disposition enum, currency, monthly_comp,
  start_date, end_date). Read-only in V1.
- **credential** (`id`, `tenant_id`, `credential_code` = "CRED-XXXX",
  `holder_person_id fk`, type enum, sub_type, reference_number, issued_by,
  issued_date, expiry_date, valid_from_date, is_active, supersedes_credential_id).
- **journey** (`id`, `tenant_id`, `journey_code` = "JRN-XXXX", `person_id fk`,
  type, status enum [Active/Suspended/Completed/Cancelled], initiated_by,
  initiated_at, completed_at, contract_id?, mission_id?, obligation_assignments jsonb).
- **mission** (`id`, `tenant_id`, `mission_code` = "TR/…"/"SATR/…", name,
  status enum, currency, start/end date).
- **mission_participant** (`id`, `tenant_id`, `mission_id fk`, `person_id fk`,
  role enum, external_code, per_diem_rate numeric, is_active).
  `unique(tenant_id, mission_id, person_id)` — enforces one row per pair; the
  soft `is_active` preserves history (matches the certified reactivation model).
- **kit_assignment** (`id`, `tenant_id`, `mission_id fk`, `person_id fk`,
  item_category enum, assignment_key, description, jersey_number,
  status enum [NotOrdered…Confirmed/Returned/Missing/Replaced],
  status_notes text (append audit), is_active). Business key
  `unique(tenant_id, mission_id, person_id, item_category, assignment_key)`.
- **apparel_profile** (`id`, `tenant_id`, `person_id fk`, jersey_size, …,
  is_active). `unique(tenant_id, person_id)` (one active profile).
- **mission_finance_line** / **mission_milestone** — new (were SP stubs);
  build in Web V0.
- **document** (`id`, `tenant_id`, owning entity ref, blob key, mime, name,
  uploaded_by) — metadata table; blobs in object storage.

Governance & audit:

- **approval** — the immutable submission + separable execution state:
  `id`, `tenant_id`, `approval_code` = "APR-XXXX" (derived from a per-tenant
  sequence, **not** the row PK), `operation_type` enum, `target_person_code`,
  `target_id`, `status` enum [Submitted/InReview/Approved/Rejected/Executed/
  ExecutionFailed], `submitted_by`, `submitted_at`, `payload jsonb` (typed by
  operation_type; **immutable after insert** — enforced by a trigger/RLS that
  denies UPDATE of payload/submitted_by), `reviewed_by`, `reviewed_at`,
  `rejection_reason`, `executed_at`, `execution_error`, `version`. Requester
  immutability = row-level policy: the submitter may INSERT but not UPDATE/DELETE.
- **approval_event** (append-only audit): `id`, `approval_id fk`, `at`, `actor`,
  `from_status`, `to_status`, `note`. One row per lifecycle transition.
- **audit_event** (generic append-only): entity, entity_id, action, actor,
  before/after jsonb, at — for all governed writes and exemptions.

**Approval payload strategy:** keep the existing discriminated-union payload
types (`approvalPayloads.ts`) as the `jsonb` shape, validated at the API layer
by the *same* TypeScript types (shared domain package). Do not normalize
payloads into columns — they are an immutable snapshot of intent.

**Migration mappings (SP → relational):** SP list item `Id` → **discarded** (a
mapping table `sp_import_map(sp_list, sp_id, entity, entity_id)` is retained
only for the import run, never as domain identity). SP `Title`/business columns
→ business_code. SP `IsActive` → `is_active`. SP ETag → `version` (reset to 0 on
import). SP claims/bare-email identity → `app_user.email` (canonicalized via the
existing `utils/identity.ts` normalizer — reused verbatim).

---

## 5. Web V0 architecture — options and recommendation

**Option A — Next.js (App Router) full-stack**, React Server Components + Route
Handlers as the API, Drizzle/Prisma over Postgres, Auth.js (SSO), deployed to a
Node host (or Vercel-style). One repo, one deploy unit.

**Option B — Vite + React SPA (reuse existing Fluent UI code) + a separate Node
API (Fastify/NestJS)**, Drizzle over Postgres, OIDC (Auth.js/Authelia/Entra),
deployed as static SPA + containerized API.

**Recommendation: Option B (Vite React SPA + dedicated Fastify API).**
Rationale grounded in this codebase:
- The existing UI is a **Fluent UI v9 SPA with TanStack Query and a service
  registry** — it drops into Vite with near-zero rework; RSC (Option A) would
  force a re-architecture of the hooks/registry we want to *keep*.
- A **separate API** makes backend authorization the enforced boundary (the
  mandate's core SaaS requirement) and gives a clean, versionable contract for
  future mobile/API clients — directly satisfying §5 "future mobile/API
  compatibility."
- The c3hq.org web app already exists as a **static Astro site on Cloudflare**;
  a Vite SPA + API fits that operational model without introducing a Node
  render tier on the marketing domain.
- Smallest production-worthy shape that grows into multi-tenant SaaS.

Concrete stack:
- **Frontend:** Vite + React 18 + Fluent UI v9 + TanStack Query (reuse
  hooks/screens/components). Real router (TanStack Router / React Router) to
  replace internal-state NavRail.
- **API:** Fastify (Node/TypeScript), thin controllers → application services
  (the existing interfaces become the service layer) → persistence.
- **Persistence:** PostgreSQL via **Drizzle ORM** (typed, migration-first,
  lightweight). Optimistic concurrency via `version` column check on UPDATE.
- **Auth/SSO:** OIDC (Entra ID for Geekay continuity, provider-agnostic).
  Session cookie (httpOnly, SameSite) → API; JWT for future service/mobile.
- **Tenant isolation:** `tenant_id` on every table + **Postgres Row-Level
  Security** keyed to the request's tenant claim; API sets
  `SET LOCAL app.tenant_id` per transaction. Defense in depth (API filter + RLS).
- **AuthZ enforcement:** server-side `rolePolicy`/capability checks on every
  mutation (reuse `utils/rolePolicy.ts` + capability map); never trust the client.
- **Audit/event:** append-only `audit_event`/`approval_event`, written in the
  same transaction as the governed mutation.
- **Approval execution:** transactional — approve and execute are distinct
  endpoints; execution stamps only after the operational row is written in the
  same transaction (no partial-as-success). ExecutionFailed on rollback.
- **Jobs/notifications:** start synchronous inline (reuse NotificationRegion);
  add a lightweight queue (pg-boss on the same Postgres) for email/async later.
- **Documents:** S3-compatible object storage (Cloudflare R2 / MinIO local),
  metadata in `document`.
- **Search:** Postgres full-text (tsvector) in V0; Meilisearch later if needed.
- **Testing:** Vitest (unit — reuse the parity assertions), API integration
  tests against a throwaway Postgres (Testcontainers), Playwright E2E (already
  in use on the website).
- **Observability:** structured logs (pino), OpenTelemetry traces, health/ready
  endpoints.
- **Deployment:** containerized API + static SPA; local dev via docker-compose
  (Postgres + API + object storage). **Secrets** via env + a secrets manager
  (never in repo).
- **Migration tooling:** a standalone **SharePoint importer** (reuses the SP
  adapters + mappers) that reads the frozen lists and writes the relational
  model idempotently, keyed on business codes.

---

## 6. Proposed repository structure (extraction boundary)

A pnpm/turbo monorepo; the SharePoint adapter becomes an **integration edge**,
not the core:

```
c3/  (new or renamed from c3-fable)
  packages/
    domain/          # ← extract from packages/c3/src/{types,utils(non-mapper),errors}
                     #   pure, framework-free; the shared contract (REMAIN, extracted)
    app-services/    # ← the interface implementations as real application services
                     #   (governed writes, approval execution, validation)  (REWRITE core, reuse rules)
    persistence/     # ← Drizzle schema + repositories implementing the ports (NEW)
    authz/           # ← rolePolicy + capability map + RLS helpers  (EXTRACT from utils)
    web/             # ← Vite React app: screens/components/hooks/tokens  (EXTRACT + reroute)
    api/             # ← Fastify server wiring app-services + persistence + auth  (NEW)
    sp-importer/     # ← SharePoint adapters + mappers, run-once import  (RENAME from services/sharepoint)
    mock/            # ← in-memory adapters as test doubles/reference  (EXTRACT from services/mock)
  tests/             # ← Vitest + integration + Playwright  (EXTRACT parity assertions)
  legacy-spfx/       # ← packages/c3-spfx-host + c3-runtime, FROZEN reference  (RETIRE after cutover)
```

Package fate:
- **Remain / extract:** `domain`, `authz`, `mock`, `web` (from `packages/c3/src`).
- **Rename:** `services/sharepoint` → `sp-importer`.
- **Rewrite:** `app-services` (governed writes as transactional server logic),
  `persistence` (new), `api` (new).
- **Retire (after cutover):** `packages/c3-spfx-host`, `packages/c3-runtime`,
  `hosts/*`, `bootstrap/*`, tabster sandbox, SPFx-specific TD-33/34 code,
  `packages/runtime-sdk` if it only abstracts SPFx.

Clean boundaries: **domain** (no deps) ← **app-services** (domain + ports) ←
**persistence** & **authz** ← **api** (wires all) ← **web** (talks only to
`api` over HTTP). `sp-importer` depends on domain + persistence only, at the
edge. No layer imports SharePoint except `sp-importer`.

---

## 7. First vertical slice — recommendation

**Recommended: People + AddPerson governed approval (with tenant + auth).**

Why over the alternatives:
- **Contracts read-only + People linkage** proves persistence + read authz but
  **not governed writes, approval/execution separation, or audit** — the
  riskiest, most differentiating parts of C3.
- **Missions + participant governance** proves governance but pulls in
  participant/kit/reactivation complexity — too broad for slice 1.
- **People + AddPerson** is the smallest slice that exercises *every*
  foundational concern end to end: OIDC login, tenant isolation (RLS),
  server-side role/capability authz, relational persistence, a **governed write**
  (Submit → Approve → Execute as separate states), **immutable payload +
  requester immutability**, **append-only audit**, **optimistic concurrency**,
  React UI (reuse PeopleWorkspace + AddPersonPanel + ApprovalInbox), and a real
  deploy. It is the exact chain already hosted-certified on SharePoint, so
  behavior parity is verifiable against a known-good reference.

**Acceptance criteria (slice 1):**
1. OIDC login establishes a tenant-scoped, role-bearing session.
2. Two tenants cannot see each other's people/approvals (RLS-enforced; proven
   by a cross-tenant read returning zero + a direct API probe returning 403).
3. Operations sees "Submit for Approval" (never direct create); Owner sees
   Approve/Execute; Visitor/Management see neither — enforced **server-side**,
   verified by API calls, not just UI.
4. AddPerson: Submit inserts an immutable approval (payload/submitted_by
   UPDATE denied); Approve sets reviewed_by/reviewed_at (no person yet);
   Execute creates exactly one person with a canonical PER-XXXX and stamps
   executed_at **in one transaction**; rollback → ExecutionFailed, no person.
5. Self-approval blocked (canonical identity comparison, reused normalizer).
6. Duplicate/idempotent execution creates no second person.
7. Optimistic concurrency: a stale `version` on approve/execute → 409, no write.
8. Every transition writes an `approval_event`; the person creation writes an
   `audit_event` — both queryable.
9. React PeopleWorkspace + AddPersonPanel + ApprovalInbox render against the
   live API; inline notification region shows success/refusal.
10. Deployed to a staging environment via the standard pipeline; local dev via
    docker-compose; gate (lint + typecheck + unit + API integration + one E2E)
    green.

---

## 8. Migration sequence (frozen SP baseline → Web V0)

1. **Foundation (Sprint 34 P1):** monorepo scaffold; extract `domain`, `authz`,
   `mock`; stand up `persistence` (Drizzle + Postgres + RLS) and `api`
   (Fastify + OIDC) skeletons; docker-compose local dev; CI gate. No features.
2. **First slice:** People + AddPerson governed chain (per §7 acceptance).
3. **Remaining governed domains:** Credentials, Journeys (+ lifecycle
   exemptions), Mission participants (+ reactivation/guards), Kit, Apparel —
   port screens/hooks, implement transactional execution + audit per domain.
   Implement **Finance & Milestones directly in Web V0** (never completed in
   SP) and **Mission confirmation** (TD-26, deferred in SP).
4. **Contracts + Renewals + Situation Room + Command Center + Inbox** —
   read models, work-item generation, role-gated truthful states (reuse utils).
5. **SharePoint data import:** run `sp-importer` against the frozen 1.0.0.8
   lists → relational model, idempotent, business-code-keyed; reconcile counts
   against the certified baseline (People 15, Approvals 51, … GKE-PL-2026-001).
6. **Parallel operation:** SharePoint remains read-only fallback; Web V0 is
   authoritative for new writes; import re-runs are additive/idempotent.
7. **Validation:** re-run the role-certification matrix (Owner/Operations/
   Management/Visitor) against Web V0; confirm governed writes, audit,
   concurrency, sensitive-data boundaries, protected-record integrity.
8. **Cutover + SharePoint retirement:** freeze SP writes, final import,
   flip authoritative source; archive the SPFx packages as `legacy-spfx`.

**Build in Web V0, not SharePoint:** Finance, Milestones, Mission confirmation,
Documents, Search, Reporting, Tenant administration, async/email notifications.

---

## 9. Risks and open decisions

**Architectural decisions required before implementation:** (a) API framework
(Fastify recommended) and ORM (Drizzle recommended); (b) OIDC provider (Entra
vs. neutral); (c) tenancy model — shared-DB + RLS (recommended) vs. schema/DB
per tenant; (d) hosting target (containers on Cloudflare/other vs. a Node PaaS)
— must align with the existing c3hq.org Cloudflare footprint; (e) approval
`approval_code` sequence-per-tenant generation.

**Data-migration risks:** SP `Id` leakage — several domain types carry
`Id: number`; these must be dropped, not mapped, or SP numeric ids will
re-contaminate the domain. Title-as-identity legacy (already guarded) must stay
guarded in the importer. Date/timezone (SP UTC-8 storage) — normalize to
`timestamptz` at import (reuse the credential-date learnings). Credential
Issue/Expiry field ordering (a Phase-1C harness artifact, code is correct) —
verify at import.

**SaaS / multi-tenancy risks:** RLS misconfiguration = cross-tenant leak — must
be defense-in-depth (API filter **and** RLS) with an explicit cross-tenant test
in the gate. Role model currently sourced from SP groups; the new
`user_role` table + admin UI is **missing but required**.

**Security risks:** authorization must move fully server-side (SP ACLs did the
enforcing; a SPA cannot). Requester immutability + self-approval + approval/
execution separation must be **DB-and-API-enforced**, not UI-enforced. Secrets
management is new surface.

**Reusable-but-dangerously-SP-coupled components:** the `sp*Mapper` files
(canonical-ID derivation is reusable, but they hard-code SP field names and
belong in the importer, not the app); domain types carrying `Id: number`; the
`useSP()`/service-registry indirection (reusable shape, but its SP diagnostics
branch must not leak into the API client); TD-33/34 tabster/cold-load fixes
(look like general React fixes but are **purely SPFx workarounds** — do not
carry them into the SPA).

**Decisions safe to keep reversible:** search engine (Postgres FTS → Meilisearch
later); job queue (inline → pg-boss → dedicated); object store (MinIO local →
R2/S3); observability vendor; exact router library.

**Functionality gaps (missing but required for SaaS):** tenant administration,
user/role management UI, documents storage, async/email notifications, global
search, reporting, Finance/Milestone/Mission-confirmation implementations.

---

## 10. Proposed Sprint 34 Phase 1 scope (for approval)

**Phase 1 = Foundation + First Vertical Slice (People + AddPerson), nothing more.**

In scope:
- Monorepo scaffold (pnpm/turbo) with the §6 package boundaries.
- Extract `domain`, `authz`, `mock` from `packages/c3` **unchanged** where the
  §2 map says "reusable unchanged"; rename `services/sharepoint` → `sp-importer`
  (no logic change yet).
- `persistence`: Postgres + Drizzle schema for tenant, app_user, user_role,
  person, approval, approval_event, audit_event; RLS policies; migrations.
- `api`: Fastify + OIDC session auth + tenant middleware + the People and
  Approval endpoints (submit/review/approve/execute) with server-side authz.
- `web`: extract PeopleWorkspace, AddPersonPanel, ApprovalInbox,
  NotificationRegion, NavRail (rerouted) onto a real router, pointed at the API.
- Tests: Vitest unit (reuse parity assertions for identity/rolePolicy/approval
  model), API integration (Testcontainers Postgres) incl. the cross-tenant
  isolation test, one Playwright E2E of the AddPerson chain.
- Local dev (docker-compose) + CI gate + one staging deploy.
- The §7 acceptance criteria are the Phase 1 exit gate.

Explicitly **out** of Phase 1: all other domains, SharePoint import of real
data, cutover, Finance/Milestones/Documents/Search/Reporting/Tenant-admin,
production deployment, and any change to the frozen SharePoint 1.0.0.8 baseline
or its certified data/fixtures.

**No implementation or deployment has been performed. Awaiting lead-architect +
owner approval of the Web V0 direction before Sprint 34 Phase 1 begins.**
