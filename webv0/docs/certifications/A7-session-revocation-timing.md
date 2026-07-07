# A-7 — Session Revocation & Token-Expiry Timing

**Gate item:** A-7 (E-8), Stage-4 admission gate. **Status: INVESTIGATION COMPLETE — timing verified from source + tests; hosted revocation drill specified below (10 min, joint) to upgrade to Hosted-certified.** **Date:** 2026-07-07 · repo tip `6897eb7`.

## The architecture answer (why revocation is fast here)

C3's API is **stateless bearer-auth with per-request authority resolution**. There is **no server-side session, no membership cache, no token cache**:

1. Every `/api/v1` request passes the `onRequest` hook → `authAdapter.authenticate(token)` (`app.ts`).
2. `authenticate()` verifies the token cryptographically (RS256/JWKS, issuer, audience, exp/nbf enforced by jose **per request**), then calls `directory.resolveMembership()` — a **fresh SQL query on every request** (`directory.ts`; no memoization anywhere).
3. The membership query requires `u.is_active = true` and joins membership + role. Any of: `is_active=false`, membership row removed, role removed, external-identity unbound → `resolveMembership` returns `null` → `AccessNotProvisionedError` → **403 ACCESS_NOT_PROVISIONED**.

## Timing matrix (the verified answer)

| Event | Takes effect | Mechanism |
|-------|--------------|-----------|
| **DB revocation** (`is_active=false` / membership or role removal) | **Next API request** (effectively immediate; only in-flight requests already past the hook complete) | per-request DB resolution; no cache to expire |
| **Microsoft access-token expiry** | Entra v2 default **60–90 min**; enforced per-request (jose `exp`) → 401 → single reauth hand-off, never a silent retry | token gates *authentication* only — **authority never outlives the DB check regardless of token validity** |
| **Sign-out** | Immediate locally (sessionStorage cleared + provider logout); nothing server-side to linger (no server session exists) | stateless design |
| **Token theft scenario** | A stolen still-valid token dies at the **next request after DB revocation** — revoking the person in C3 kills the token's usefulness without waiting for expiry | DB is the authority, not the token |

**Client behavior on revocation mid-session:** API calls surface the truthful 403; session re-resolution maps `ACCESS_NOT_PROVISIONED` → the dedicated unprovisioned screen (`session.tsx` → `AppShell`), not an error loop. 401 (expired token) triggers exactly one reauthentication hand-off; governed mutations are never auto-retried (test-proven).

## Evidence already held

- **Test:** "an inactive user fails closed even with a valid token and existing membership" (`entraIdentity.test.ts`) — the exact revocation semantic.
- **Test:** 401-once reauth semantics + 403-no-reauth (`auth.test.ts`).
- **Hosted (same code path):** pre-seed, the real `certbeta@c3hq.org` identity signed in with a valid Microsoft token and was denied (no membership) — the identical `resolveMembership → null → 403` path revocation produces.

## Hosted revocation drill (to upgrade to Hosted-certified — 10 min, joint)

1. Owner signs in at staging as `certbeta@c3hq.org` (valid session, People visible).
2. Owner runs (same railway-ssh psql path as the seed): `UPDATE app_user SET is_active=false WHERE email='certbeta@c3hq.org';`
3. Owner refreshes / clicks People → expect **access denied (unprovisioned screen)** on the immediate next request, token untouched.
4. Restore: `UPDATE app_user SET is_active=true WHERE email='certbeta@c3hq.org';` → next request works again.
5. Architect records both observations here.

## Findings / recommendations

- **No defect.** The per-request-resolution design gives near-immediate revocation — stronger than typical cached-session architectures. Accepted trade-off: one membership SELECT per request (fine at current scale; if ever cached, the cache TTL becomes the revocation SLA and must be a deliberate, documented decision).
- Token lifetime is Microsoft-governed (default 60–90 min) and does **not** bound revocation; no action needed.

**HOSTED DRILL RESULT: PENDING — the drill has not been run.** A-7 remains at *source/test-verified + timing-analysis-complete* until the joint drill above is executed and its observations are recorded here. Do not represent A-7 as Hosted-certified before that.
