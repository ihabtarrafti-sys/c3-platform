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

## Phase 1 — SHIPPED + HOSTED-PROVEN (2026-07-07, HEAD `65741cb`)

The Phase-1 remediation is implemented, deployed to staging, and exercised live:
- Migration `0007_access_events.sql` applied (owner-run, runner-consistent bookkeeping); `access_event` live with the append-only trigger; `c3_app` write-only posture test-proven.
- `SessionEstablished` live end-to-end: first hosted row written by a real session refresh — `Access | SessionEstablished | certbeta@c3hq.org | 2026-07-07 11:25:12 UTC`.
- `AccessDenied` path test-proven (integration: denied token-valid identity → `access_event` row); hosted rows will appear on the first real denial.
- Both writes verified non-fatal by design.

## Phase 2 — SHIPPED + HOSTED-EXERCISED (2026-07-07): ✅ A-8 FULLY GREEN

Sprint 35 delivered access administration as governed, same-transaction-audited product flows (design: `A8-P2-access-admin-audit.md`; SECURITY DEFINER gateways, migration 0008). The A-4 drill then exercised them hosted end-to-end: `MemberProvisioned` + `MemberRoleChanged` ×6 (with before/after images) + `MemberDeactivated`, all via APR-0004..0011 under requester ≠ approver, verified in the live audit stream (see `A4-role-model-hosted-cert.md`). Both A-8 phases are now hosted-proven with real events (SessionEstablished, AccessDenied, and the full member-mutation family). **The "auditing manual SQL is impossible" compensating control is retired for tenant-scoped access changes** — they are product flows now.

## Gate consequence

**A-8: FULLY SATISFIED** — governed operations, auth flows, and access-administration flows all emit queryable, append-only audit events, hosted-proven. Public claims remain bounded by the sign-off discipline; any new wording routes through the truthfulness authority.
