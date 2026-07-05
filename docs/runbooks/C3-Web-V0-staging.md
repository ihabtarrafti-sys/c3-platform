# C3 Web V0 — staging runbook

Staging is a **local/containerised** environment. Phase 1 does **not** provision
any paid cloud service, DNS record, production database, or production Entra
application. Those steps are owner-gated (see "Owner-gated" below).

## Prerequisites
- Docker + Docker Compose, OR Node 22+ for the no-Docker path.

## Local development (no Docker)
The automated suite provisions its own ephemeral PostgreSQL via
`embedded-postgres`, so no database is required to run tests:

```
npm install
npm run webv0:gate          # typecheck + unit + DB + API tests
npm run webv0:e2e           # Playwright E2E (starts an embedded-DB API + Vite)
npm run webv0:openapi       # regenerate apps/api/openapi.{json,yaml}
```

To run the servers against a real Postgres:
```
docker compose -f infra/docker-compose.yml up -d      # Postgres on :5432
cp .env.example .env                                   # then edit as needed
npm run webv0:db:migrate                               # creates c3_app + schema
npm run webv0:api:dev                                  # API on :4000
npm run webv0:web:dev                                  # Web on :5173
```

## Staging stack (containerised)
```
export DB_ADMIN_PASSWORD=... DB_APP_PASSWORD=...
export AUTH_PROVIDER=entra ENTRA_ISSUER=... ENTRA_AUDIENCE=... ENTRA_JWKS_URI=...
export WEB_ORIGIN=http://localhost:8080 API_ORIGIN=http://localhost:4000
docker compose -f infra/docker-compose.staging.yml up --build
```
Order of operations (enforced by compose):
1. `postgres` becomes healthy.
2. `migrate` one-shot ensures the least-privileged `c3_app` role and applies all
   migrations via the privileged admin connection, then exits.
3. `api` starts, connecting ONLY as `c3_app` (RLS-enforced).
4. `web` serves the built SPA (nginx, SPA fallback) at :8080.

### Connection roles (never share)
- **Admin / migration**: `DATABASE_ADMIN_URL` (schema owner). Migrations only.
- **Application**: `DATABASE_URL` = `c3_app` (NOSUPERUSER, NOBYPASSRLS). The API.

## Seeding a tenant + first users (staging)
The dev IdP is disabled outside `AUTH_PROVIDER=dev`. For an Entra staging tenant,
insert the tenant and role assignments with the admin connection, e.g.:
```
INSERT INTO tenant (slug, name) VALUES ('geekay', 'Geekay Esports');
-- then app_user + tenant_membership + role_assignment for each Entra identity
```
(A tenant-admin UI is Phase 2 scope.)

## Health & observability
- `GET /health` — liveness. `GET /ready` — DB connectivity (200/503).
- Structured JSON logs (pino) with a per-request `x-correlation-id` echoed on
  every response.

## Owner-gated (do NOT perform without owner approval)
- Provisioning a paid cloud database / container host.
- Creating the production Entra application registration + redirect URIs.
- DNS records under c3hq.org.
- Any production deployment.
