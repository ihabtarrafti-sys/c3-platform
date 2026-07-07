# Sprint 36 — Credentials Domain: Hosted Certification

**Author:** Architect-of-record · **Date:** 2026-07-07.
**Result: ✅ HOSTED-CERTIFIED** — deployed, owner-visually-verified, and exercised end-to-end on staging through the real governed flow, same day the sprint was designed and built.

## Deployment evidence (2026-07-07)

- **Migration 0009** applied by the owner (runner-consistent): migrations 0001→0009; `credential` table with **RLS ENABLE + FORCE** (verified `true/true`); `c3_app` grants exactly `INSERT, SELECT, UPDATE` — no DELETE; operation registry CHECK extended.
- **API**: owner-deployed; new-build fingerprint verified (`GET /api/v1/credentials` anonymous → 401, route exists).
- **Web**: Pages deployment `910cb1a4`, bundle `index-DQ9YmnC7.js`, dev-marker scan CLEAN, safe-order verification passed (direct URL asset → propagation wait → custom-domain browser page-nav).

## Hosted smoke (owner-driven, Architect-verified read-only in the product audit stream)

Governed AddCredential exercised live in `c3-internal`:
- **APR-0012 `AddCredential` Executed** — submitted by m.khalailah (operations), reviewed + executed by ihab (owner): requester ≠ approver held.
- **CRED-0001** live: person `PER-0001`, type "Staging Certification License", **`issued_on = 2026-01-02`, `expires_on = 2031-12-30` — byte-for-byte identical to the values typed in the form.** The CP-era date-swap defect class is confirmed dead under hosted conditions (UI form → wire → DB → read-back).
- **`CredentialCreated` audit row** in the tenant stream, actor = the executor, same transaction as the creation.
- Owner visual confirmation: Credentials register renders CRED-0001 with the **Active** derived-status badge; PER-0001's profile shows the Credentials section.

**Durable fixture:** CRED-0001 + APR-0012 (never delete; audit evidence, joining PER-0001/APR-0001..0011).

## What Sprint 36 proved beyond the feature

1. The governance machine is **genuinely generic**: a third domain family (after Person and Members) rode the identical submit → review → execute pipeline with zero changes to the pipeline itself.
2. The **derived-status pattern** (Active / Expires soon / Expired / Inactive, pure read-side, no schedulers) is live — the honest seed of the readiness/Situation-Room direction.
3. Lifecycle completeness from birth: credentials were in the export bundle and the exit-ceremony deletion order **before** they ever existed on staging.

## Claims note

No public claim about Credentials exists or is authorized. Any future wording routes through the truthfulness sign-off; the roadmap's band framing is unchanged.
