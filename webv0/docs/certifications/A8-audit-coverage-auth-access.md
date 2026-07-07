# A-8 — Audit-Event Coverage of Auth/Access Flows

**Gate item:** A-8 (E-9; 24-mo retention D-24), Stage-4 admission gate. **Reviewer:** Architect-of-record · **Date:** 2026-07-07 · repo tip `806c2b2`.
**Result: NOT SATISFIED — honest gap confirmed, remediation designed below.** Governed-workflow audit coverage is complete and hosted-proven; **auth and access-administration flows do not emit queryable audit events.** No overclaim: the gate item stays open until the Phase-1 remediation ships.

## Coverage matrix (verified from source)

| Flow class | Flows | Audit events? | Where the truth lives today |
|---|---|---|---|
| **Governed operations** | AddPerson submit · review start · approve · reject · execute (success/failure) · person created | ✅ **Complete** — the 7 `AUDIT_ACTIONS` written transactionally by the application use-cases into append-only `audit_event`; record-scoped reads exposed (`/people/:id/audit`, `/approvals/:id/audit`, `/approvals/:id/events`); hosted-proven (PER-0001/APR-0001 timelines) | product audit store |
| **Authentication** | sign-in (session establishment) · token rejection (invalid/expired/wrong-audience) · `ACCESS_NOT_PROVISIONED` attempt · inactive-user denial | ❌ none — `apps/api/src/auth/*` writes no audit events | pino request logs only (Railway platform retention — **not** a 24-month queryable audit store) |
| **Access administration** | membership provisioning · role assignment/change · activate/deactivate (revocation) · external-identity binding | ❌ none — these flows don't exist in-product yet; they are owner-run SQL (seed, A-1/A-7 drills). Even the dev-only `upsertDevMembership` writes no audit event | certification documents + operator discipline (honest, but not a product control) |

**Retention note (D-24):** `audit_event` is append-only with no deletion path — existing events satisfy 24-month retention for the lifetime of the database (plus encrypted backups). The gap is *coverage*, not retention.

**Concrete illustration of the gap:** today's A-7 revocation drill (two `is_active` flips on a real identity) left **no product audit trail** — only this lane's certification record and platform logs. An external customer's auditor would reasonably expect those events in the product's own audit store.

## Remediation design

**Phase 1 — auth-event auditing (small; bundle with the F-1 rate-limit API-hardening increment):**
- Write audit events (append-only, tenant-scoped where resolvable) for: **(a)** `ACCESS_NOT_PROVISIONED` / inactive-user denials — identity key (provider, tid, oid), outcome, timestamp; low volume, high forensic value; **(b)** session establishment, approximated by successful `/api/v1/me` resolution (the SPA calls it once per session load — a truthful "signed in" signal without per-request noise). Token-signature rejections stay in logs/metrics (unauthenticated noise; unbounded audit writes would be their own DoS vector — cap/aggregate if ever elevated).
- Design decision embedded: in a stateless per-request API there is no server "login" moment; `/me` resolution is the honest proxy.
- New `AUDIT_ACTIONS` entries (e.g. `AccessDenied`, `SessionEstablished`) + D.6 labels + tests; no schema change required (reuse `audit_event` with `entity_type='Access'`).

**Phase 2 — access-administration auditing (lands with the tenant/user-administration build, Tier-2 roadmap):** every provision / role change / activation flip / invitation event becomes a first-class governed, audited product flow. That build is where E-9's real weight lands — auditing manual SQL is impossible by definition, which is itself the argument for shipping tenant-admin before external orgs.

**Interim compensating control (now):** access-administration changes remain owner-run, are recorded in this lane's certification documents (as done for the seed and both drills), and the staging population is two named humans. Honest, adequate for internal beta; **not** adequate for external customers.

## Gate consequence

A-8 open. Green path: Phase 1 ships (small) → auth flows covered; Phase 2 ships with tenant-admin → access-admin flows covered. Both are already reflected in the sanitized public roadmap (band 3). No public claim beyond "application workflow history" is permitted meanwhile (already enforced by the claims sign-off).
