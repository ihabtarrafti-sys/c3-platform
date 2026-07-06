# Sprint 34 Phase 2B — Web V0 Dependency Isolation and Entra Identity Integration

**Status:** COMPLETE for owner review. Nothing deployed externally; no Entra
registration, DNS record, Railway/Cloudflare project, database, secret, or
paid resource created; frozen SharePoint untouched (source content-identical;
committed runtime asset re-verified at the certified hash `5c064623…`).

Date: 2026-07-06 · Entry HEAD `e9eea2b` (verified = origin/master, clean tree).

## 1. Part 1 — standalone webv0/ npm root
- `git mv` moved the whole Web V0 stack (apps, six packages, infra, scripts,
  tsconfig/vitest/env templates) into **`webv0/`** with its OWN package.json
  and package-lock.json.
- Repository-root manifests **restored byte-exact to `0558a6c`** (verified the
  correct restoration point: manifests unchanged through the docs-only
  `673d963`). Sprint 34 docs, git config, and the intentional untracked
  handoff/fable paths untouched.
- Six proofs, all green in a CLEAN CLONE:
  1. root `npm ci` = frozen graph only (1518 pkgs; zero Web V0 packages) and
     the **nested per-workspace Fluent 9.74.1/9.74.2 restored to the exact
     certified versions** (Phase-2A dedupe drift fully reversed);
  2. webv0 `npm ci` = standalone product graph (308 pkgs) — the full gate ran
     **with no parent node_modules present**, so resolution is provably
     self-contained (this exposed and fixed an incomplete initial lockfile
     that had been masked by parent-root resolution walk-up);
  3. no webv0 imports outside webv0/ — the identity parity test now uses an
     in-tree static fixture (verbatim copy of the frozen module @0558a6c with
     a provenance header);
  4. no frozen imports into webv0;
  5. committed SharePoint runtime asset hash = certified `5c064623…` (the
     gitignored local `dist-runtime` comparison is N/A in a clean clone and
     rebuilding frozen is prohibited);
  6. both roots reproduce independently from a fresh clone.
- CI now runs with working-directory `webv0` and guards the frozen sources AND
  the restored root manifests. Dockerfiles rebuilt for the webv0 context (the
  frozen workspace is no longer in any image build context at all).

## 2–6. Browser authentication (Parts 2, 6)
- **@azure/msal-browser**, Authorization Code + **PKCE**, **redirect** flow,
  behind a provider-neutral **AuthClient** (initialize / signIn /
  completeRedirect / signOut / silent getAccessToken / interactive
  reauthenticate / getSession). No raw OAuth crypto; no client secret in the
  browser; **single-tenant authority only**; MSAL PII logging disabled.
- **`/auth/callback`** completes the redirect and restores the intended deep
  link (open-redirect-guarded). Protected routes `/people`,
  `/people/:personId`, `/approvals`, `/approvals/:approvalId`: anonymous
  access renders the deliberate sign-in screen with the deep link preserved;
  refresh and deep links work after authentication.
- API client: token acquired per request; `Authorization: Bearer` attached;
  tokens never logged (test-enforced); **401 → one reauthentication hand-off,
  never an automatic mutation retry; 403 → truthful authorization denial**;
  server correlation ids preserved.
- Signed-in identity displayed from the session; the C3 role comes ONLY from
  `/api/v1/me` — never token claims.
- Dev identity flow retained for local/E2E; in the entra build it is
  dead-code-eliminated (build-time constant + dead-branch dynamic import) and
  **`scripts/verify-entra-bundle.mts` PROVES the production bundle contains no
  dev-login control, route string, or dev-auth material** (in the gate and CI;
  it caught two real leaks during development and drove the fix).

## 3. Part 3 — immutable identity model
Migration `0005_external_identity`: membership binds to
**(provider='entra', issuer_tenant_id=tid, subject=oid)** via
`external_identity` (UNIQUE) → `app_user` → membership/role. Email,
preferred_username, UPN, display name are mutable PROFILE attributes
(`app_user`, + `last_seen_at`) and never keys — changing them cannot change
role or membership (test-proven, including a mutated-token-claim case where
the principal identity stays the admin-controlled stored email). Existing dev
identities preserved as (dev, dev, email) via backfill without weakening the
production model.

## 4. Part 4 — token validation rules (all enforced + tested)
RS256 allow-list · JWKS signature · tenant-specific **v2** issuer (env
validation refuses common/organizations/consumers and requires the issuer to
embed ENTRA_TENANT_ID) · audience · exp/nbf · **tid required + pinned** ·
**oid required** · **scp must contain C3.Access** · application-only tokens
(idtyp=app / no scp) rejected · role/group/wids/custom claims never read — a
forged claim cannot grant C3 authority (test: a provisioned operations
identity with `roles:["owner"]` stays operations; an unprovisioned identity
with owner claims gets 403).

## 5. Part 5 — registration model
Two separate single-tenant registrations prepared (not created): API with
identifier URI `api://<API_CLIENT_ID>`, delegated scope `C3.Access`, v2
tokens, no app permissions, no secret; SPA platform with auth-code+PKCE, no
implicit grant, redirect `https://staging.c3hq.org/auth/callback`, post-logout
`https://staging.c3hq.org/`, delegated `api://<API_CLIENT_ID>/C3.Access`, no
secret. Full owner checklist in the deployment runbook §1.

## 7. Part 7 — membership/role resolution flow
Verified token → (tid, oid) → `external_identity` lookup over the SELECT-only
`c3_auth` connection → active `app_user` → `tenant_membership` +
`role_assignment` → principal (identity = stored profile email). Unknown or
inactive identity: **no tenant context, no role, no data — truthful 403
`ACCESS_NOT_PROVISIONED`** (distinct from 401), rendered in the web app as a
deliberate "access not provisioned" screen. **No auto-provisioning from a
valid token** (DB-asserted). No M365/Entra groups, app roles, email domains,
or token roles map to C3 authority.

## 8. Part 8 — seed command
`npm run seed:staging -- --tenant-slug … --entra-tenant-id … --owner-oid … --ops-oid …`
(privileged admin connection only; never runs at API start). Idempotent
reconciliation of exactly one tenant + two Entra identities with EXACT
owner/operations roles; prints a redacted report (object IDs masked); refuses
ambiguous bindings (oid→different-email rebinding, email owned by a different
identity, owner=operations). Awaits the owner's real object IDs — nothing
seeded.

## 9–10. Tests and the complete gate
**161/161 Vitest + 1/1 Playwright E2E**, all from the CLEAN CLONE with the
standalone webv0 root: domain 43 · authz 14 · api-contracts 5 · application 14
· **web 12** (MSAL config, token attachment, silent success,
interaction-required, 401-once/403-no-reauth, logout, refresh restoration,
safe callback paths, no token logging) · persistence 23 (incl. migrations
0001–0005, RLS, c3_auth, **seed idempotency + refusals**) · api 50 (incl. the
Entra claim matrix and **DB-backed immutable-identity resolution**: owner→
owner, operations→operations, email-mutation preservation, unknown/inactive
fail-closed, claim no-escalation, cross-tenant collision at the tid gate,
dev-login route absent under entra).
Clean-clone gate: npm ci (both roots, independently) · NUL audit (127 files) ·
typecheck 8/8 · full Vitest · OpenAPI regenerated == committed · web
production build · **entra bundle dev-auth absence** · API production graph
(92 pkgs, no dev deps/test-support/msal) boots NODE_ENV=production/entra ·
E2E · `npm audit --omit=dev` = **0 vulnerabilities** · frozen source
content-identical + certified runtime hash PASS.
Known benign: 4 frozen files show CR-at-EOL phantom diffs on Windows
autocrlf clones (content-identical; CI on Linux unaffected).

## 11+. Owner package, blockers, recommendation
See the final report in chat and
[`docs/runbooks/C3-Web-V0-staging-deployment.md`](../runbooks/C3-Web-V0-staging-deployment.md)
(registration checklist §1, environment matrix §2, seed §3, smoke plan §5,
owner actions §6, cost §7).
