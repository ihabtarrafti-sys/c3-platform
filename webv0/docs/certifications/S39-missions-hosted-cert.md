# Sprint 39 — Missions Domain: Hosted Certification (THE CAPSTONE)

**Author:** Architect-of-record · **Date:** 2026-07-08.
**Result: ✅ HOSTED-CERTIFIED — and with it, FULL CP-PARITY DOMAIN COVERAGE: People, Credentials, Journeys, Members, Kit, Apparel, Missions.**

## Deployment evidence

- **Migration 0012** (owner-run): 12/12 migrations, latest `0012_missions.sql`; `mission` + `mission_participant` both **RLS ENABLE + FORCE**; grants exactly `INSERT, SELECT, UPDATE`; operation-type CHECK carries both mission operations.
- **API** (owner-deployed): `GET /api/v1/missions` and `/missions/:id/participants` anonymous → 401 (live, authenticated); health 200.
- **Web** (Architect-deployed): Pages deployment `1584709c`, bundle `index-IvGFaNlx.js` (1,035,016 B); **A-6 marker scan CLEAN on the exact deploy artifact** (9 markers, case-sensitive; real Entra clientId/scope/API base baked in); safe-order verification passed (direct URL asset 200 → propagation wait → custom-domain real-browser page-load executing the new bundle).

## Hosted smoke (ops = m.khalailah, owner = ihab; Architect-verified in the audit stream)

**The mission shell (direct-audited):** MSN-0001 "Staging Cert Mission" created by OPERATIONS (the deliberate `canManageMissions` grant exercised live — contrast the CP Set-C finding where ops held Missions edit by ACL accident); `MissionCreated` → `MissionUpdated` with before/after images of **ONLY the changed field** (`{"endsOn": null}` → `{"endsOn": "2026-08-15"}`) → `MissionDeactivated`. Final state Inactive, **version 2 = exactly two mutations**. Retired shell offers no affordances (owner-confirmed).

**The governed roster (the Set-D centerpiece, all hosted-witnessed):**

1. **Duplicate-PENDING refused at submit** — with APR-0014 open, a second request for the same pair was refused in the browser; **zero approval rows created**.
2. **Full governed chain** — APR-0014 (AddMissionParticipant) Executed: submitted by m.khalailah, reviewed + executed by ihab (requester ≠ approver), roster showing the person's display name.
3. **Duplicate-ACTIVE refused at submit** — with the pair live, a fresh request refused; zero approval rows.
4. **Governed removal** — APR-0015 Executed; `MissionParticipantRemoved` with the honest before-image `{"role": "Player", "isActive": true}`.
5. **Reactivation reuses THE SAME ROW** — APR-0016 (re-add as Coach) Executed; `MissionParticipantAdded` with before `{"role": "Player", "isActive": false}` → after `{"role": "Coach", "isActive": true}`; **`count(*)` for the pair = 1 across the entire lifecycle** (the SP APR-0065 semantics, rebuilt natively and proven hosted).

Exactly three participant approvals exist (0014–0016) — the two refusals truthfully left no trace but the refusal itself. Every execution actor truthful.

**Certification integrity note:** the first smoke report omitted the shell edit/deactivate steps; the Architect's audit-stream verification caught it before certification (the second consecutive sprint this standard has fired) and the owner completed them. Nothing here is certified ahead of evidence.

**Durable fixtures (never delete — audit evidence):** MSN-0001 (Inactive, 2026-08-01 → 2026-08-15) + participant pair MSN-0001/PER-0001 (Active, Coach) + APR-0014..0016.

## What Sprint 39 proved beyond the features

1. **Both mutation patterns compose in one domain**: a direct-audited shell and governed membership share one page truthfully (immediate-and-recorded vs. unchanged-until-executed copy).
2. **The duplicate guards hold at both gates hosted** — submit-time friendliness and execute-time authority (the execute-time path separately proven by the crafted-race test and the retired-shell HTTP test).
3. **One-row-per-pair is a database fact**, not an application promise: UNIQUE-constraint-backed, lifecycle-proven live.
4. The **changed-fields-only audit discipline** held for its third domain family.

## CP-parity scoreboard — COMPLETE

**People ✅ Credentials ✅ Journeys ✅ Members ✅ Kit ✅ Apparel ✅ Missions ✅** — every operational domain of the certified SharePoint reference now runs natively on the SaaS stack, hosted-certified, with tenant isolation, governed workflows, and append-only audit the CP never had.

## Claims note

No public claim about Missions or "full CP parity" exists or is authorized; any external wording routes through the truthfulness sign-off as a separate step.
