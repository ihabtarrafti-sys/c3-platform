# A-6 — Production Dev-Auth Bypass Impossible

**Gate item:** A-6 (AC-13 / E-3), Stage-4 admission gate. **Status: HOSTED-CERTIFIED** · **Date:** 2026-07-07 · repo tip `16daaf9` · **Certified by:** Architect-of-record (all probes read-only).

## The layered guarantee (each layer independently verified)

| Layer | Guarantee | Evidence |
|---|---|---|
| **Env (process refuses to start)** | Production forbids `AUTH_PROVIDER=dev`; fails closed if `DEV_AUTH_SECRET` is even *present*; fails closed if `DATABASE_ADMIN_URL` is present | `env.ts` guards; `env.test.ts` |
| **Route (structurally absent)** | The dev-login route is registered only when the dev provider is active — under Entra the route does not exist in the process | `app.ts` conditional registration; `entraIdentity.test.ts` ("dev-login route does not exist under the entra provider") |
| **Hosted API (live)** | `POST https://api.staging.c3hq.org/api/v1/dev/login` → **404** | probed 2026-07-07 (this record) |
| **SPA bundle (dead-code elimination proven)** | Dev sign-in is eliminated from Entra builds; `verify-entra-bundle.mts` (in gate + CI) proves no dev-login control or dev-auth material in every emitted file — re-verified on every deploy this sprint | verifier runs (Increments 1–3c) |
| **Hosted bundle (live)** | Served bundle `index-mNxUSC98.js` contains none of: `dev/login`, `performDevLogin`, "Development identity provider", `login-email`, `DEV_AUTH` | probed 2026-07-07 (this record) |
| **Token boundary** | Even a forged dev-style token is useless against the Entra adapter: RS256/JWKS-only, tenant-pinned issuer/audience, and authority resolves from DB membership on immutable `(tid,oid)` | `entra.ts`; `api.test.ts` forged-token case; A-1/A-7 hosted certifications |

**Note on environment nuance:** staging runs the production build path (`NODE_ENV=production`, `AUTH_PROVIDER=entra`) — the certification therefore covers the production configuration as deployed. Prior hosted evidence: Phase 2C smoke §17 (same probes at first deployment). Re-certify only if the auth provider wiring or build pipeline changes.
