# Sprint 34 Phase 2C — First Hosted Staging

**Status: HOSTED-GREEN.** Date: 2026-07-06. Entry HEAD `3c7cb17` → exit HEAD:
see closure commit. Web `staging.c3hq.org` + API `api.staging.c3hq.org` +
Railway PostgreSQL live; real Entra sign-in certified for Owner and
Operations; the complete governed AddPerson workflow executed hosted.

## Provisioned resources (budget ≤ $20/mo)
- **Railway** project *C3 Web V0 Staging*, env `staging`
  (id `23ba4593-78f4-4632-b859-69d291bddde4`): PostgreSQL (private-network
  only; public TCP proxy REMOVED after the one-shot migration/seed) +
  `c3-api` (hardened Dockerfile, 1 replica, deployed via `railway up` from the
  exact approved commit; domain `api.staging.c3hq.org`, cert VALID).
  Account is on the TRIAL ($5/30 days) — upgrade to Hobby ($5/mo) before the
  credit ends; usage hard-limit set by owner. Estimate $5–13/mo.
- **Cloudflare Pages** `c3-web-v0-staging` (direct-upload mode by owner
  decision; git-connect can be added later): entra bundle, custom domain
  `staging.c3hq.org`. $0.
- **DNS**: `staging` CNAME (Pages-managed) + `api.staging` CNAME
  `860m8b6w.up.railway.app` (**DNS only** — a proxied orange-cloud record
  breaks two-level-subdomain TLS without paid ACM; hosted-proven) +
  `_railway-verify.api.staging` TXT. Apex/MX/SPF/DKIM untouched (verified).

## Database
Migrations 0001–0005 applied from empty; role separation verified LIVE
(c3_app non-superuser/no-bypass + fail-closed empty reads without tenant
context; c3_auth resolves memberships, cannot write identity data, cannot
read operational data). Seed (owner-run, twice): tenant `c3-internal`,
owner=ihab@c3hq.org (oid 892a…ba62), operations=m.khalailah@c3hq.org
(oid 7dde…b1fb) — run 2 reported "no changes" (idempotency hosted-proven).
Post-provisioning DB access is via `railway ssh` into the API container
(private network) — no public exposure.

## Hosted defects found and fixed (defect protocol followed)
| # | Defect | Root cause | Correction |
| --- | --- | --- | --- |
| D1 | Sign-in loop; Microsoft "We couldn't sign you in" | Entra API registration defaulted to v1 access tokens (`requestedAccessTokenVersion: null`) → issuer rejected → 401 → client fired acquireTokenRedirect FROM /auth/callback | Owner set `requestedAccessTokenVersion: 2`; web fix `9fb9da7`: no interactive reauth from the callback route + one-redirect-per-60s guard |
| D2 | Post-fix, failures bounced to Microsoft logout page | Session failure path called interactive logoutRedirect | Web fix `a324a40`: `AuthClient.clearLocalSession()` (local-only clear) + truthful "Last attempt: <API reason>" notice on the sign-in screen — which then diagnosed D3 in one attempt |
| D3 | 401 `unexpected "aud" claim value` | v2 tokens carry the BARE client-id GUID as aud, not `api://…` | Railway `ENTRA_AUDIENCE` set to the bare GUID (config only); runbook corrected |

Both web fixes gate-green (161/161 + entra-bundle proof) before deploy; one
coherent commit + one redeploy each.

## Real Entra authentication certification (hosted)
Deliberate sign-in screen → Microsoft redirect → /auth/callback → deep link
restored → **Ihab = owner**, **Mohammad = operations** (roles from the C3
database; token roles/groups ignored — API logs show 20+ authenticated 200s,
0 residual 401s) → refresh survives → sign-out safe → dev-login 404 hosted →
tokenless/forged bearer → 401 → CORS allows exactly `https://staging.c3hq.org`.

## Governed AddPerson smoke (hosted, synthetic fixture)
Fixture: **C3 Staging Certification Person / STG-2C-7Q4K9** (ign field; the
slice form exposes fullName/ign/team — certification label in team).
- Operations submitted **APR-0001** (banner: "A person is not created until an
  owner executes it"); People stayed empty; Operations had no review buttons.
- Owner-submitted **APR-0002** (STG-2C-SELF) proved the self-review refusal;
  it remains Submitted as a certification artifact.
- Owner chain on APR-0001: InReview → Approved (People still empty) →
  **Execute → exactly one person PER-0001** (created_by APR-0001); post-execute
  no Execute affordance (duplicate-execution guarded by DB constraints +
  integration tests).
- DB evidence (tenant-scoped via private network): 1 person; event chain
  Submitted(ops)→InReview→Approved→Executed(owner) + APR-0002 Submitted(owner);
  audit trail incl. PersonCreated; approval payload immutable (v0→…); logs
  clean of tokens/payloads/secrets (only internet scanner-probe 404s).
- **Durable staging fixtures (do not delete): PER-0001, APR-0001 (Executed),
  APR-0002 (Submitted, self-review artifact).**

## Rollback
Web: `wrangler pages deploy` any prior bundle (deployments retained).
API: Railway dashboard → redeploy previous deployment. DB: additive-only
migrations; Railway backups (owner to enable before real data). DNS: remove
the two `api.staging` records to detach the API host. Full teardown: delete
the Railway project + Pages project + 3 DNS records.

## Limitations / follow-ups
- Railway TRIAL plan — upgrade to Hobby before credit exhaustion.
- Railway deploys are CLI-driven (`railway up`) from the approved commit;
  GitHub auto-deploy is an optional owner dashboard step.
- Cloudflare Pages is direct-upload; git-connected builds optional later.
- Railway Postgres backups not yet enabled (owner dashboard step).
- Duplicate-execute hosted probe not exercised end-to-end (no UI affordance
  post-execution; protection is constraint + integration-test proven).
- COO visual redesign deliberately NOT implemented (pending cross-lane packet).
