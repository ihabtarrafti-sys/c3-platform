# C3 Web V0 — staging deployment preparation (Sprint 34 Phase 2B)

**Status: PREPARED, NOT PROVISIONED.** No account, project, database, app
registration, DNS entry, secret, or paid resource has been created. Every step
that creates an external resource is an OWNER ACTION.

Approved staging direction:
- Web: **Cloudflare Pages** → `staging.c3hq.org`
- API: **Railway Docker service** → `api.staging.c3hq.org`
- Database: **Railway PostgreSQL**
- Identity: **Microsoft Entra ID** — identity ONLY. Tenant membership and the
  C3 role always come from the C3 database keyed on the immutable
  (tid, oid) identity; never from M365/SharePoint/Entra groups, app roles,
  email domains, or token claims.

---

## 1. Entra ID — owner registration checklist (create in this order)

### 1a. API registration — "C3 Web V0 API (staging)"
1. New registration → single tenant (`AzureADMyOrg`). Record **API_CLIENT_ID**.
2. Expose an API → set the Application ID URI to **`api://<API_CLIENT_ID>`**.
3. Add a delegated scope **`C3.Access`** ("Access the C3 staging API";
   admins-and-users consentable). Full scope value:
   `api://<API_CLIENT_ID>/C3.Access`.
4. Manifest: `accessTokenAcceptedVersion: 2` (v2 tokens).
5. NO application permissions, NO app roles, NO client secret or certificate
   (the API only validates tokens via the tenant JWKS).

### 1b. SPA registration — "C3 Web V0 (staging)"
1. New registration → single tenant. Record **SPA_CLIENT_ID**.
2. Platform: **Single-page application** (Authorization Code + PKCE; the
   implicit grant checkboxes stay UNCHECKED).
   - Redirect URI: `https://staging.c3hq.org/auth/callback`
   - Post-logout redirect URI: `https://staging.c3hq.org/`
3. API permissions → delegated `api://<API_CLIENT_ID>/C3.Access`; grant admin
   consent for the tenant (avoids per-user consent prompts).
4. NO client secret — ever (PKCE public client).

### 1c. Identities to collect (for seeding)
- **ENTRA_TENANT_ID** — the directory (tenant) GUID.
- **Owner**: Entra **object ID (oid)** + email + display name (Ihab).
- **Operations**: object ID (oid) + email + display name
  (m.khalailah@geekay.com).
Object IDs are in Entra admin center → Users → Overview → Object ID.

## 2. Environment-variable matrix (exact placement)

### Cloudflare Pages (build-time; VITE_* values are PUBLIC by design)
| Variable | Value |
| --- | --- |
| `NODE_VERSION` | `22.14.0` |
| `VITE_AUTH_PROVIDER` | `entra` |
| `VITE_API_BASE_URL` | `https://api.staging.c3hq.org` |
| `VITE_ENTRA_CLIENT_ID` | `<SPA_CLIENT_ID>` |
| `VITE_ENTRA_TENANT_ID` | `<ENTRA_TENANT_ID>` |
| `VITE_ENTRA_API_SCOPE` | `api://<API_CLIENT_ID>/C3.Access` |

Pages project: root directory **`webv0`**, build command
`npm ci --no-audit --no-fund && npm --workspace apps/web run build`, output
directory **`apps/web/dist`**. SPA fallback + security headers ship in
`webv0/apps/web/public/{_redirects,_headers}`. Web Analytics stays OFF.

### Railway API service (runtime; NO admin URL — startup fails closed if present)
| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `API_PORT` | `4000` |
| `LOG_LEVEL` | `info` |
| `TRUST_PROXY` | `true` (Railway terminates TLS at its proxy) |
| `CORS_ORIGIN` | `https://staging.c3hq.org` |
| `DATABASE_URL` | `postgres://c3_app:<APP_PW>@<internal-host>:5432/railway` |
| `DATABASE_AUTH_URL` | `postgres://c3_auth:<AUTH_PW>@<internal-host>:5432/railway` |
| `AUTH_PROVIDER` | `entra` |
| `ENTRA_TENANT_ID` | `<ENTRA_TENANT_ID>` |
| `ENTRA_CLIENT_ID` | `<API_CLIENT_ID>` |
| `ENTRA_ISSUER` | `https://login.microsoftonline.com/<ENTRA_TENANT_ID>/v2.0` |
| `ENTRA_JWKS_URI` | `https://login.microsoftonline.com/<ENTRA_TENANT_ID>/discovery/v2.0/keys` |
| `ENTRA_AUDIENCE` | `api://<API_CLIENT_ID>` |
| `ENTRA_SCOPE` | `C3.Access` (default; explicit for clarity) |

Railway service: Dockerfile deploy, **root directory `webv0`**, Dockerfile path
`apps/api/Dockerfile`, port 4000, health check `/health` (readiness `/ready`).
Use the INTERNAL database hostname; the database is never public.

### Railway migration / seed job (pre-deploy or one-shot; the ONLY place the
privileged URL exists)
| Variable | Value |
| --- | --- |
| `DATABASE_ADMIN_URL` | `postgres://postgres:<RAILWAY_SUPERUSER_PW>@<internal-host>:5432/railway` |
| `DATABASE_URL` | as API (bootstraps the c3_app role/password) |
| `DATABASE_AUTH_URL` | as API (bootstraps the c3_auth role/password) |

Pre-deploy command:
`node node_modules/tsx/dist/cli.mjs packages/persistence/scripts/migrate.ts`

**Secret generation** (owner, locally; store only in Railway variables):
`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`
— one each for `<APP_PW>` and `<AUTH_PW>`. No `DEV_AUTH_SECRET` may exist in
staging (production startup fails closed on its presence). No access token,
password, or client secret is ever stored in source.

## 3. First-tenant seeding (owner-run, idempotent, never automatic)

After migrations, from the migration/seed job environment:

```
node node_modules/tsx/dist/cli.mjs packages/persistence/scripts/seed-staging.ts \
  --tenant-slug geekay --tenant-name "Geekay Esports" \
  --entra-tenant-id <ENTRA_TENANT_ID> \
  --owner-oid <OWNER_OID> --owner-email <owner-upn> --owner-name "Ihab Tarrafti" \
  --ops-oid <OPS_OID> --ops-email m.khalailah@geekay.com --ops-name "M. Khalailah"
```

The command reconciles exactly one tenant + the two Entra identities with
EXACT owner/operations roles, prints a redacted report, refuses ambiguous
identity bindings, and can be re-run safely. Membership binds to the immutable
(tid, oid) — email/display-name changes never affect role or membership.

## 4. Rollback / backups / log redaction
- **Rollback:** Railway one-click redeploy of the previous image. Migrations
  are additive-only in V0; DB rollback = restore from backup.
- **Backups:** enable Railway PostgreSQL daily backups (retain ≥ 7 days)
  BEFORE first real data; verify one restore during the smoke run.
- **Log redaction:** pino redacts authorization/cookie headers; request bodies
  (approval payloads) and token claims are never logged (test-enforced).

## 5. Staging smoke plan (bounded, first real deployment)
1. Unauthenticated: `staging.c3hq.org` shows the deliberate sign-in screen;
   `GET api.staging.c3hq.org/api/v1/people` without a token → 401.
2. Operations signs in through Entra (PKCE redirect) — lands authenticated.
3. Operations sees the People register (empty on first run).
4. Operations submits AddPerson → visible confirmation with the APR id.
5. Operations cannot review or execute (no affordance; direct API probe → 403).
6. Owner signs in through Entra.
7. Owner sees the request in the Approvals inbox.
8. Owner cannot approve their own submissions (SELF_REVIEW_BLOCKED).
9. Owner reviews and approves the Operations request.
10. Approval alone creates no Person.
11. Owner executes.
12. Exactly one Person is created (PER-0001).
13. Duplicate execute is harmless (idempotent=true; still one Person).
14. Approval history and person audit render.
15. Refresh and deep links work (/approvals/APR-0001, /people/PER-0001).
16. Cross-tenant access fails (an identity without geekay membership → 403
    ACCESS_NOT_PROVISIONED; no data).
17. `POST /api/v1/dev/login` → 404 (route not registered) AND the served
    bundle contains no dev-login material.
18. Railway logs for the session contain no approval payload, no bearer token,
    no authorization header value.
Abort criteria: any step failing = stop; no data entry beyond smoke fixtures;
fix-forward or rollback per §4.

## 6. Owner actions required (in order)
1. Approve this provisioning package.
2. Create the two Entra registrations (§1) → supply ENTRA_TENANT_ID,
   API_CLIENT_ID, SPA_CLIENT_ID, and the two object IDs.
3. Create the Railway project (API service + PostgreSQL), set §2 variables,
   enable backups.
4. Create the Cloudflare Pages project (§2 settings).
5. Add DNS: `staging` CNAME → Pages; `api.staging` CNAME → Railway.
6. Run migrations + the seed command (§3), then the smoke plan (§5) jointly
   with the platform engineer.

## 7. Estimated resources that may incur cost
Railway API ~$5–10/mo + Railway PostgreSQL ~$5–10/mo; Cloudflare Pages free
tier; Entra registrations $0 in the existing tenant. **Total ~$10–20/month.**
