# Runbook — splitting PRODUCTION from STAGING (Tier 0.5)

**Status: RUNBOOK ONLY — owner infrastructure actions. Nothing in this
document is automated; the code needs zero changes for it (the API is
environment-driven end to end). Do these steps with me on a call/screen
when you decide to open a real production lane.**

## Why a split

Today `staging.c3hq.org` + `api.staging.c3hq.org` is the ONLY hosted lane:
it is simultaneously our certification target and the place real Geekay data
would live. That is fine for a controlled pilot and wrong for real operations:
a certification deploy must never be able to touch live tenant data.

Target shape:

| Lane | Web | API | DB | Purpose |
|---|---|---|---|---|
| staging | staging.c3hq.org | api.staging.c3hq.org | Railway PG (existing) | cert target, fixtures, smokes |
| production | app.c3hq.org | api.c3hq.org | NEW Railway PG (separate project) | real tenants only |

## Owner steps (in order)

### 1. Railway: a separate production project
- New Railway project `c3-web-v0-production` (separate project = separate
  credential blast radius, separate member list — do NOT reuse the staging one).
- Provision PostgreSQL. Note: run migrations 0001→current in order (same
  paste choreography as staging; I produce the consolidated file).
- Deploy `c3-api` service from the same repo/branch, but **only after** the
  staging build being promoted has a green cert. Production deploys are
  promotions of certified staging builds, never fresh builds.

### 2. Production API environment (all set BEFORE first boot)
- `NODE_ENV=production` (env validation then FORBIDS dev auth, requires CORS)
- `AUTH_PROVIDER=entra` + the same `ENTRA_*` values as staging (same app
  registration — or a second registration if you want separate consent
  surfaces; same is fine for V1)
- `CORS_ORIGIN=https://app.c3hq.org`
- `DATABASE_URL` / `DATABASE_AUTH_URL` → the NEW production PG (least-privilege
  roles created by the migration set, same as staging)
- `TRUST_PROXY=true`, `RATE_LIMIT_MAX` same as staging
- R2: a NEW bucket `c3-web-v0-production-documents` + scoped token (never
  share the staging bucket)
- SMTP (optional): same all-or-none rule
- **Never set `DEV_AUTH_SECRET` in production — the process refuses to boot
  if it is even present.**

### 3. Cloudflare
- DNS: `app.c3hq.org` → Pages project `c3-web-v0-production`;
  `api.c3hq.org` → Railway production service
- New Pages project so staging deploys can never overwrite production web.
  Web build for production: `VITE_API_BASE_URL=https://api.c3hq.org`,
  same Entra vars.

### 4. Backups (production is the lane that actually needs them)
- Clone the staging backup setup against the production DB: cron service,
  NEW R2 backup bucket `c3-web-v0-production-backups`, NEW age keypair
  (private key → owner password manager ONLY, labeled "C3 production backup
  key" — the staging key must not unlock production dumps).
- Backup-status env on the production API (`BACKUP_STATUS_*`) so the
  Settings tile reports production backup freshness.

### 5. Tenant provisioning
- Seed the production tenant(s) with the seed command against the production
  DB (owner-run paste; I prepare it). No fixture/test tenants in production,
  ever.

### 6. The promotion law (process, not tooling)
1. Everything certifies on staging first (gate + E2E + hosted smoke).
2. Migrations run on production only after they ran clean on staging.
3. Web deploy to the production Pages project only from a commit that is
   already live-verified on staging.
4. Rollback: Pages previous deployment + `railway rollback` on the API; DB
   migrations are forward-only (additive), which we already enforce.

## What this runbook deliberately does not do
- No IaC/Terraform — two lanes, owner-held credentials; scripts would hold
  secrets we've agreed I never touch.
- No auto-promotion pipeline — promotion is an owner act by design (same law
  as staging deploys).
