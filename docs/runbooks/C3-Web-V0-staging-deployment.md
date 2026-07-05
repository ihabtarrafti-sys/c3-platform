# C3 Web V0 — staging deployment preparation (Sprint 34 Phase 2A)

**Status: PREPARED, NOT PROVISIONED.** No account, project, database, app
registration, DNS entry, or paid resource has been created. Every step below
that creates an external resource is an OWNER ACTION.

Approved staging direction:
- Web: **Cloudflare Pages** → `staging.c3hq.org`
- API: **Railway Docker service** → `api.staging.c3hq.org`
- Database: **Railway PostgreSQL**
- Identity: **Microsoft Entra ID** (identity only — tenant membership and C3
  role always come from the C3 database, never from M365/SharePoint groups)

---

## 1. Railway — API service

| Setting | Value |
| --- | --- |
| Service type | Dockerfile deploy from the GitHub repo |
| Dockerfile path | `apps/api/Dockerfile` (build context = repo root) |
| Exposed port | `4000` |
| Health check path | `/health` (liveness; `/ready` = DB readiness, 200/503) |
| Health check timeout | 30 s, start period ≥ 20 s |
| Region | closest to owner/EU users |
| Custom domain | `api.staging.c3hq.org` (owner adds CNAME in Cloudflare DNS) |

**Migration / pre-deploy command** (Railway "pre-deploy" step, runs the same
image with the PRIVILEGED URL that the service itself never receives):

```
node node_modules/tsx/dist/cli.mjs packages/persistence/scripts/migrate.ts
```

Pre-deploy environment: `DATABASE_ADMIN_URL` (privileged), `DATABASE_URL`
(c3_app, for role/password bootstrap), `DATABASE_AUTH_URL` (c3_auth, same).

**API service environment variables** (service runtime — note NO admin URL;
startup fails closed if one is present):

```
NODE_ENV=production
API_PORT=4000
LOG_LEVEL=info
TRUST_PROXY=true                  # Railway terminates TLS at its proxy
CORS_ORIGIN=https://staging.c3hq.org
DATABASE_URL=postgres://c3_app:<APP_PW>@<internal-host>:5432/railway
DATABASE_AUTH_URL=postgres://c3_auth:<AUTH_PW>@<internal-host>:5432/railway
AUTH_PROVIDER=entra
ENTRA_TENANT_ID=<tenant-guid>
ENTRA_CLIENT_ID=<api-app-client-id>
ENTRA_ISSUER=https://login.microsoftonline.com/<tenant-guid>/v2.0
ENTRA_JWKS_URI=https://login.microsoftonline.com/<tenant-guid>/discovery/v2.0/keys
ENTRA_AUDIENCE=api://c3web-staging
```

**Database connectivity:** use Railway's INTERNAL hostname for both URLs
(private network); do not expose the database publicly. The public/proxied
connection string is used only by the owner for emergency admin access.

**Role separation on Railway PostgreSQL:** Railway provisions a superuser.
That superuser URL = `DATABASE_ADMIN_URL` (pre-deploy only). The migration
runner creates `c3_app` (RLS-bound) and `c3_auth` (SELECT-only) with the
passwords embedded in the two runtime URLs above.

**Secret generation** (owner, locally):
`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
— one each for `<APP_PW>` and `<AUTH_PW>`. Store only in Railway variables.
No `DEV_AUTH_SECRET` may exist in staging (startup fails closed if present).

**Rollback:** Railway keeps previous deployments — one-click redeploy of the
prior image. Migrations are additive-only in V0 (no destructive migration may
ship without an explicit down-plan); DB rollback = restore from backup.

**Backups:** enable Railway PostgreSQL daily backups (retain ≥ 7 days) BEFORE
first real data. Verify one manual backup/restore cycle during the smoke run.

**Log redaction:** pino already redacts `authorization`/`cookie` headers and
never logs request bodies (approval payloads) or token claims. Railway log
retention is the vendor default; no sensitive material should appear.

## 2. Cloudflare Pages — web

| Setting | Value |
| --- | --- |
| Project root | repository root (monorepo) |
| Build command | `npm ci --no-audit --no-fund && npm --workspace apps/web run build` |
| Output directory | `apps/web/dist` |
| Node version | `22.14.0` (env `NODE_VERSION=22.14.0`) |
| Custom domain | `staging.c3hq.org` |
| SPA fallback | `apps/web/public/_redirects` (committed) |
| Security headers | `apps/web/public/_headers` (committed) |

Build environment variables:

```
NODE_VERSION=22.14.0
VITE_API_BASE_URL=https://api.staging.c3hq.org
VITE_ENTRA_CLIENT_ID=<spa-app-client-id>        # Phase 2B SPA sign-in
VITE_ENTRA_TENANT_ID=<tenant-guid>
VITE_ENTRA_API_SCOPE=api://c3web-staging/C3.Access
```

Web Analytics stays OFF (established c3hq.org policy).

## 3. Entra ID — app registration package (prepare only)

Two registrations, single tenant (Geekay). **Entra establishes identity only;
the C3 database establishes tenant membership and C3 role.** No M365 or
SharePoint group is ever an authorization boundary for the SaaS.

**Registration A — API (`C3 Web V0 API (staging)`)**
| Item | Value |
| --- | --- |
| Application ID URI | `api://c3web-staging` |
| Scope | `C3.Access` — "Access the C3 staging API" (admin+user consentable) |
| Audience (validated) | `api://c3web-staging` |
| Allowed account type | single tenant (`AzureADMyOrg`) |
| Token version | v2 (`accessTokenAcceptedVersion: 2`) |
| App roles | none — deliberately NOT used; role comes from `role_assignment` |
| Secrets/certificates | none required (the API only VALIDATES tokens via JWKS) |

**Registration B — SPA (`C3 Web V0 (staging)`)**
| Item | Value |
| --- | --- |
| Platform | Single-page application (PKCE, no client secret — ever) |
| Redirect URI | `https://staging.c3hq.org/auth/callback` |
| Logout URI | `https://staging.c3hq.org/` |
| API permission | delegated `api://c3web-staging/C3.Access` |
| Allowed account type | single tenant |
| Token version | v2 |

**Required claims in the access token:** `preferred_username` (or `upn`/`email`
fallback — the boundary translates), `name`, standard `iss`/`aud`/`exp`.
Tenant restriction = single-tenant issuer validation (`ENTRA_ISSUER` pins the
tenant GUID). Claim-to-role strategy: **directory lookup** (`c3_auth` SELECT on
`tenant_membership`/`role_assignment`) — a forged/added token claim can never
grant a C3 role.

**Staging identities:** Owner = Ihab's account; Operations =
`m.khalailah@geekay.com` (existing certified operations identity). Both must be
seeded in the C3 database (below) — Entra sign-in alone grants nothing.

## 4. First-tenant seeding (staging)

Run once via the pre-deploy/admin connection (psql or a one-shot script):

```sql
INSERT INTO tenant (slug, name) VALUES ('geekay', 'Geekay Esports');
INSERT INTO app_user (email, display_name) VALUES
  ('<owner-upn>', 'Ihab Tarrafti'),
  ('m.khalailah@geekay.com', 'M. Khalailah');
INSERT INTO tenant_membership (tenant_id, user_id)
  SELECT t.id, u.id FROM tenant t, app_user u WHERE t.slug='geekay';
INSERT INTO role_assignment (tenant_id, user_id, role)
  SELECT t.id, u.id, CASE WHEN u.email='<owner-upn>' THEN 'owner' ELSE 'operations' END
  FROM tenant t, app_user u WHERE t.slug='geekay';
```

(A tenant-admin UI replaces this in Phase 2B.)

## 5. Staging smoke plan (bounded, first real deployment)

1. Unauthenticated: `staging.c3hq.org` shows sign-in only; direct
   `GET api.staging.c3hq.org/api/v1/people` without a token → 401.
2. Operations signs in through Entra (PKCE) — lands authenticated.
3. Operations sees the People register (empty on first run).
4. Operations submits AddPerson → visible confirmation with the APR id.
5. Operations opens the approval: no review/approve/execute affordance; direct
   API probe `begin-review` with the ops token → 403.
6. Owner signs in through Entra.
7. Owner sees the request in the Approvals inbox.
8. Owner CANNOT approve a request they submitted themselves (verify by having
   Owner submit one and confirm SELF_REVIEW_BLOCKED / no affordance).
9. Owner begins review and approves the Operations request.
10. Approval alone creates no Person (People register still empty).
11. Owner executes.
12. Exactly one Person appears (PER-0001).
13. A second execute (direct API, same version) returns idempotent=true; still
    exactly one Person.
14. Approval history (events) and person audit render.
15. Browser refresh + deep links (`/approvals/APR-0001`, `/people/PER-0001`) work.
16. Cross-tenant probe: a token for a user with no `geekay` membership → 401
    (no membership); a second seeded tenant's owner sees zero geekay rows.
17. `POST /api/v1/dev/login` → 404 (route not registered).
18. Railway logs for the session contain no approval payload body, no bearer
    token, no `authorization` header value (redaction verified).

Abort criteria: any step failing = stop, no data entry beyond the smoke
fixtures, fix-forward or rollback per §1.

## 6. Owner actions required (in order)

1. Approve staging provisioning (this document).
2. Create the two Entra app registrations (§3) and supply the four IDs.
3. Create the Railway project (API service + PostgreSQL), set variables (§1),
   enable backups.
4. Create the Cloudflare Pages project (§2).
5. Add DNS: `staging` CNAME → Pages; `api.staging` CNAME → Railway.
6. Run first deploy + seeding (§4) + smoke plan (§5) together with the
   platform engineer.

## 7. Estimated resources that may incur cost

| Resource | Est. monthly |
| --- | --- |
| Railway API service (0.5–1 vCPU / 512 MB–1 GB) | ~$5–10 |
| Railway PostgreSQL (1 GB) + backups | ~$5–10 |
| Cloudflare Pages (staging traffic) | $0 (free tier) |
| Entra ID app registrations | $0 (existing tenant) |
| **Total** | **~$10–20/month** |
