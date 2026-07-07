# A-2 — Internal Security Review (webv0)

**Gate item:** A-2, Stage-4 admission gate (Block A). **Scope:** the shipped webv0 surface — API (Fastify), SPA (Vite/React), persistence (PostgreSQL/RLS), auth (Entra RS256 / dev IdP), deploy artifacts. **Reviewer:** Architect-of-record · **Date:** 2026-07-07 · repo tip `f94fa22`.
**Result: PASS for the gate bar — no open HIGH/CRITICAL findings on the shipped product surface.** One MEDIUM (rate limiting) recommended for remediation before external admission; the *independent* assessment (C-2) remains a separate, owner-commissioned item.

## Verified strengths (with evidence)

**Runtime / API**
- Fail-closed env validation (`env.ts`): prod forbids `AUTH_PROVIDER=dev`, fails on mere *presence* of `DEV_AUTH_SECRET` or `DATABASE_ADMIN_URL`, requires explicit `CORS_ORIGIN`, pins tenant-specific v2 issuer (rejects common/organizations/consumers). Covered by `env.test.ts`.
- Bearer-only auth, no cookies → no credentialed CORS/CSRF surface; all `/api/v1` routes authenticated via a single onRequest hook; 401 (unauthenticated) vs 403 `ACCESS_NOT_PROVISIONED` (authorization) distinction enforced.
- Entra adapter: `algorithms: ['RS256']` allow-list; application-only tokens rejected (`idtyp=app`); delegated `scp` must include `C3.Access`; membership resolved from DB on immutable `(tid,oid)` — token roles/groups/tenant claims cannot escalate (test-proven, `entraIdentity.test.ts`); no auto-provisioning.
- Request hygiene: zod validation on every route (`fastify-type-provider-zod`); 128 KiB body limit; correlation-id log-injection guard (`^[A-Za-z0-9_-]{1,64}$`); `trustProxy` opt-in only; `x-content-type-options: nosniff` + `cache-control: no-store` on all API responses; structured error envelope (no stack traces to clients); 5xx logged server-side only.
- Logging: pino redacts authorization/cookie headers; request bodies and token claims never logged (test-enforced, incl. "no token logging" web test).

**Data layer** (hosted-proven via A-1)
- RLS ENABLE+FORCE on data tables; fail-closed on missing tenant context; transaction-local tenant binding (pool-leak-proof); `c3_app` NOSUPERUSER/NOBYPASSRLS; `c3_auth` SELECT-only on identity tables, no business-data access; `c3_backup` the sole documented BYPASSRLS exception, read-only (all posture test-proven in `db.test.ts`; A-1 record adds hosted evidence).
- Append-only `approval_event`/`audit_event` (trigger + grant enforced); immutable approval submission (trigger); optimistic concurrency (version guard); one-person-per-approval DB idempotency.

**SPA / delivery**
- Dev sign-in dead-code-eliminated from Entra bundles — `verify-entra-bundle.mts` proves absence in every emitted file (in gate + CI, re-verified this session); dev-login route structurally absent under the entra provider (404, test-proven).
- MSAL: sessionStorage token cache (accepted decision D-31); tenant-specific authority; PKCE; no client secret; open-redirect guard on callback (`safeInternalPath`, test-proven).
- Cloudflare `_headers`: CSP `default-src 'self'; script-src 'self'` (no unsafe-eval/inline scripts), connect-src limited to the API + login.microsoftonline.com, `frame-ancestors 'none'`, nosniff, DENY framing, restrictive Permissions-Policy, `no-transform`.
- Dependency audit: **production graph 0 vulnerabilities** (`npm audit --omit=dev`).
- Source secret scan: no hardcoded credentials/keys in `webv0/**/src` (pattern scan).

## Findings

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| F-1 | **MEDIUM** | **No API rate limiting** (`@fastify/rate-limit` absent). Exposure is abuse/resource-exhaustion, not credential attack (no password endpoints; Entra holds the credential surface; unauthenticated requests are rejected cheaply). Acceptable for the current staging population; **remediate before external admission** (per-identity + per-IP limits, 429 with structured envelope). | **✅ REMEDIATED + HOSTED-VERIFIED 2026-07-07** — `@fastify/rate-limit` 11.1.0, 300 req/min per client (`RATE_LIMIT_MAX`; production fails closed on 0), health/ready exempt, structured 429 envelope, limiter ordered before auth so unauthenticated 401 spam is counted (commit `65741cb`); hosted evidence: live `x-ratelimit-*` headers + intact 401 envelope on `api.staging.c3hq.org` same day. Scope note: keying is **per client IP** (`req.ip`, proxy-aware) — per-identity keying is a C-2-era enhancement candidate, not a gap in the shipped control. |
| F-2 | LOW (dev-only) | 5 npm-audit vulnerabilities in the **dev tool graph** (vite dev server / vitest UI chain: path-traversal, fs.deny bypass, vitest-UI RCE). None shipped: production bundle excludes them; tests run headless (`vitest run`); dev server is localhost-only use. Fix available via vite/vitest major upgrades. | Open — schedule upgrade with the next toolchain refresh; not an emergency |
| F-3 | INFO (accepted) | sessionStorage token cache (XSS-readable in principle) — accepted decision D-31, mitigated by the strict CSP (`script-src 'self'`, no inline/eval) and no third-party scripts. CSP `style-src 'unsafe-inline'` is required by Fluent/Griffel (industry-standard trade-off). Non-prod CORS localhost default applies only where prod fail-closed guard cannot be reached. | Accepted, documented |

## Gate consequence

A-2 at the **internal-review** level: **satisfied — no open high/critical on the shipped surface; F-1 closed 2026-07-07.** The gate's C-2 (independent assessment) is explicitly NOT claimed by this document; this review prepares for it. Re-run this review when: the toolchain upgrade lands (close F-2), or any new domain/route ships (the Sprint 35 member routes + gateways were added post-review and are covered by their own test evidence; fold into the next review pass).
