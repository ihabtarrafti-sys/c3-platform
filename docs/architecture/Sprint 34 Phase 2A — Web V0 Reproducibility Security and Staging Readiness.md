# Sprint 34 Phase 2A — Web V0 Reproducibility, Security Review and Staging Preparation

**Status:** COMPLETE for owner review. Nothing deployed externally, no DNS
change, no paid infrastructure, no Entra registration created, frozen
SharePoint untouched (source diff vs `673d963` still empty; runtime bundle
hash re-verified PASS, read-only).

Date: 2026-07-05 · Entry HEAD `205712a` → exit HEAD: see §1.

---

## 1. Git state
- Entry: tree clean (intentional untracked `docs/Handoff v2/`, `docs/fable/`),
  HEAD `205712a`, origin/master `0558a6c` (7 commits ahead).
- Pushed `master` → **HEAD = origin/master = `205712a`** verified; Phase 2A
  commits then added: `56456bf` (security hardening), `3213bf2` (containers +
  CI + drizzle), plus this documentation commit (pushed at close).
- No `git clean` used at any point.

## 2. Clean-clone reproducibility (all from a fresh clone of origin/master)
| Step | Command | Result |
| --- | --- | --- |
| Clone | `git clone --branch master <repo>` | HEAD `205712a` |
| Install | `npm ci --no-audit --no-fund` | 1565 pkgs, 72 s, lockfile-exact |
| Typecheck | `npm run webv0:typecheck` | 8/8 workspaces pass |
| Tests | `npm run webv0:test` | **112/112 pass** (real embedded PG) |
| Fresh-DB migrations | migrate CLI vs empty PG 18.4 | 0001–0003 applied; `c3_app` non-superuser/non-bypass |
| OpenAPI | `npm run webv0:openapi` + byte-compare | **regenerated == committed (no drift)** |
| Web prod build | `vite build` | ✔ (4.98 s) |
| API prod artifact | (container image; see §7) | boot proven via E2E server + prod-graph sim |
| E2E | `playwright test` | **1/1 pass** (29.6 s) |

Notes: (a) fresh clones show 4 phantom-modified FROZEN files — CR-at-EOL only
(`git diff --ignore-cr-at-eol` is empty); historical mixed line endings +
`autocrlf`, pre-existing, content byte-identical. (b) The Playwright browser
binary comes from Playwright's own cache (installed by `npx playwright
install` — CI does this explicitly); no other global package is relied on.

## 3. Frozen-workspace dependency audit
Method: full resolution diff of `package-lock.json` @`0558a6c` vs HEAD.
- **Zero in-place version changes** (0 changed entries); 297 added (Web V0),
  184 removed — all removed entries were NESTED duplicates under
  `packages/c3/node_modules/*` and `packages/c3-spfx-host/node_modules/*`.
- Of the removed nested entries: 104 re-resolve to the SAME version hoisted;
  **80 re-resolve to patch-bumped versions** within declared ranges (Fluent UI
  v9 family — c3 had 9.74.1, spfx-host 9.74.2, both now hoisted 9.74.3;
  @tanstack/query 5.101.1→5.101.2; fast-uri, tslib/picomatch shuffles).
- **Isolation held where it matters:** react 17.0.1 stays nested under
  c3-spfx-host (18.3.1 hoisted); TypeScript 5.8.3 nested for SPFx (5.9.3
  root); vite 6.4.3 confined to apps/web (5.4.21 root for c3); zero duplicate
  Fluent/TanStack copies remain.
- **Impact:** the deployed certified 1.0.0.8 artifacts are commits/deployed
  bytes — unaffected (runtime hash re-verified PASS). A bit-exact rebuild of
  the frozen baseline uses commit `0558a6c` (its lockfile is intact in git
  history). Rebuilding frozen from HEAD would compile against the patch-bumped
  graph — and rebuilding frozen is prohibited anyway.
- **Correction applied:** none to the frozen packages (exact restoration would
  require editing frozen package.json files — prohibited — because the two
  frozen workspaces pinned different nested patch versions). Instead CI now
  guards frozen sources, and the report records the baseline-rebuild rule.
- **Safer isolation without changing package managers:** give the Web V0
  stack its own npm root (own package.json + lockfile, e.g. under `web/`),
  leaving the frozen root lockfile permanently untouched. Recommended at
  Phase 2B/cutover, not mid-phase.
- **Node engines:** c3-spfx-host requires `>=22.14 <23`; Web V0 runs on 22 and
  24. CI and containers pin **22.14.0**, satisfying both. Local Node 24 works
  (EBADENGINE warnings only).

## 4. Security findings and fixes (adversarial review)
| # | Finding | Fix |
| --- | --- | --- |
| F1 | dev-login route registered in all environments (runtime-guarded only) | Route now registered ONLY when the dev IdP is active; absent from production processes; hidden from OpenAPI |
| F2 | Production did not fail when DEV_AUTH_SECRET merely present | env fails closed on presence |
| F3 | Running API held migration/admin DB credentials (membership resolution) | New SELECT-only `c3_auth` role (migration 0004 + bootstrap); production env REFUSES `DATABASE_ADMIN_URL` and requires `DATABASE_AUTH_URL` |
| F4 | No explicit JWT algorithm allow-list | `HS256` (dev) / `RS256` (Entra) enforced |
| F5 | Proxy-header trust not configurable | `TRUST_PROXY` explicit opt-in; default false |
| F6 | Client correlation id echoed verbatim (log injection) | Sanitized to `[A-Za-z0-9_-]{1,64}`, else replaced |
| F7 | No explicit body bound | 128 KiB limit; 413 truthful, zero mutation |
| F8 | CORS `credentials:true` unnecessary (bearer auth); localhost origin default in prod | credentials removed; production requires explicit CORS_ORIGIN |
| F9 | No log redaction config | pino redacts authorization/cookie; API responses `no-store` + `nosniff` |
| F10 | Weak dev secret allowed | 16-char minimum; dev provider requires the dev directory explicitly |
| dep | drizzle-orm GHSA (identifier escaping, HIGH) | upgraded ^0.36.4 → **^0.45.2**; production `npm audit`: **0 vulnerabilities** |

Reviewed with no change needed: tenant resolution (server-side only; wire
schemas strict — a supplied `tenant_id` is rejected, test-proven), RLS policies
(FORCE on data tables), tenant-context wrapper (transaction-local GUC),
pool cleanup (proven no-leak), AddPerson authorization + requester/reviewer
separation (fail-closed identity), approval immutability (DB trigger),
execution idempotency (unique keys + idempotent path), optimistic concurrency
(version-guarded UPDATE), append-only events (trigger + grants), error
envelope (no stack traces on the wire; 5xx logged server-side only).

## 5. Dev-auth production proof
- `NODE_ENV=production` + `AUTH_PROVIDER=dev` → startup throws (test).
- `NODE_ENV=production` + unset provider (default dev) → startup throws (test).
- `NODE_ENV=production` + `DEV_AUTH_SECRET` present with entra → throws (test).
- dev-login route not registered under entra: POST → 404 AND absent from the
  route table (test), absent from OpenAPI (14 paths).
- CI images job boots the built API image with production+dev-auth env and
  asserts the refusal message.

## 6. RLS and tenant-context review
Unchanged mechanism, re-verified + extended: per-transaction
`set_config('app.tenant_id', …, is_local=true)`; FORCE RLS on data tables;
missing context = zero rows; pooled-connection reuse leaks nothing; `c3_app`
NOSUPERUSER/NOBYPASSRLS. NEW: `c3_auth` least-privilege proven by test —
resolves memberships, cannot write identity tables, cannot read business data,
cannot bypass RLS. 17 persistence integration tests green.

## 7. Container hardening
- **API image:** pinned `node:22.14.0-slim`, multi-stage, non-root (`node`),
  `npm ci --omit=dev -w apps/api` (production chain only), test-support +
  embedded-postgres purged AND asserted absent in-image, HEALTHCHECK
  (/health), exec-form CMD → SIGTERM reaches the graceful handler, no emit →
  no source maps. `tsx` promoted to a runtime dependency.
- **Web image:** pinned build Node + `nginxinc/nginx-unprivileged:1.27-alpine`
  (non-root, :8080); nginx.conf with security headers + CSP, SPA fallback,
  immutable `/assets`, `no-cache` shell, gzip.
- **Compose staging:** API receives ONLY c3_app/c3_auth URLs; migrate one-shot
  holds admin; web on 8080.
- **Verification:** Docker is not available on this machine. The API image's
  dependency graph was verified by a context-exact simulation (the same files
  the Dockerfile COPYs + the same `npm ci` flags): 99 packages, no dev deps,
  no embedded-postgres, and the pruned tree **boots in production mode with
  the Entra provider**. Cloudflare-path web equivalents (`_redirects`,
  `_headers`) committed. **Image build/execution itself is unverified locally;
  the CI `images` job builds both and smoke-checks the production dev-auth
  refusal.**

## 8. CI workflow and gate results
`.github/workflows/webv0-ci.yml` (push master + PRs; no deploy secrets; frozen
SPFx never built): **gate** job = npm ci → NUL/truncation audit
(`scripts/webv0-nul-audit.mts`, also added to the local `webv0:gate`) →
8 typechecks → full Vitest (real-PG integration) → OpenAPI drift check → web
production build → `npm audit --omit=dev --audit-level=high` (fail policy:
high/critical in the production graph; dev-graph findings reported
non-blocking) → frozen-source guard. **images** job = builds both hardened
images + production dev-auth refusal boot smoke. **e2e** job = separate
required Playwright run with failure traces.
Local gate at close: NUL audit 102 files clean; typecheck 8/8; **Vitest
129/129**; E2E 1/1; OpenAPI no drift; prod audit 0 vulnerabilities. (The
workflow's first hosted run happens on push to GitHub.)

## 9–10. Cloudflare + Railway configuration
Complete provider-exact configuration prepared in
[`docs/runbooks/C3-Web-V0-staging-deployment.md`](../runbooks/C3-Web-V0-staging-deployment.md):
Railway Dockerfile path/health/pre-deploy migration command/variables with
admin-vs-app-vs-auth credential separation/internal-only DB networking;
Cloudflare Pages root, build command, output dir, Node pin, staging variables,
committed `_redirects`/`_headers`; secret generation, rollback, backup,
log-redaction and first-tenant seeding procedures.

## 11. Entra registration package
Prepared (not created): API registration `api://c3web-staging` with scope
`C3.Access`, v2 tokens, single-tenant, NO app roles (deliberate); SPA
registration with PKCE, redirect `https://staging.c3hq.org/auth/callback`,
logout URI, delegated scope; required claims + issuer-pinned tenant
restriction. **Entra establishes identity; the C3 database establishes tenant
membership and role** — no M365/SharePoint group is an authorization boundary.

## 12. Staging smoke plan
18-step bounded plan in the deployment runbook §5, covering every mandated
check (unauthenticated refusal → Entra sign-ins → submit/review separation →
no-person-before-execute → exactly-one-person → idempotent re-execute →
history/audit → refresh/deep links → cross-tenant failure → dev-login absent →
log redaction), with abort criteria.

## 13. Exact owner actions required
1. Approve staging provisioning (this report + deployment runbook).
2. Create the two Entra app registrations; supply tenant GUID + 2 client IDs.
3. Create Railway project (API service + PostgreSQL), set §1 variables,
   enable backups.
4. Create Cloudflare Pages project (§2 settings).
5. Add DNS: `staging` + `api.staging` CNAMEs under c3hq.org.
6. Schedule the joint first-deploy + seeding + smoke session.

## 14. Estimated cost
~**$10–20/month** (Railway API ~$5–10 + Railway PostgreSQL ~$5–10; Cloudflare
Pages free tier; Entra $0 in the existing tenant).

## 15. Blockers
- **B1 (implementation):** the web SPA has no Entra sign-in flow yet (dev
  login only). The API side is complete and test-proven; the SPA needs the
  PKCE/MSAL flow + token acquisition for `C3.Access` (small, well-bounded —
  first Phase 2B item; steps 2/6 of the smoke plan depend on it).
- **B2 (environment):** Docker unavailable locally — image execution deferred
  to the CI `images` job (first run on push).
- **B3 (process):** owner-gated resources (Entra, Railway, Cloudflare, DNS)
  not yet created — by design.

## 16. Recommendation
**Authorize the staging deployment, sequenced as:** (1) owner creates the
Entra registrations now; (2) Phase 2B implements the SPA Entra sign-in against
them (local verification with the staging registrations and no deployed
infrastructure); (3) then provision Railway + Cloudflare and run the smoke
plan. The foundation is reproducible from a clean clone, security-reviewed
with all ten production guarantees enforced and tested, containerized with
hardened images, CI-gated, and carries zero known production-graph
vulnerabilities. Proceeding to real staging is low-risk once B1 lands.
