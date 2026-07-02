# C3 Beta Checkpoint — Sprint 26

**Status:** Authoritative until Sprint 27 closeout
**Date:** 2026-07-02
**Supersedes:** C3 Beta Checkpoint — Sprint 25
**Head commit:** `5cbef34` — `feat(s26): Add mission event read foundation`

This checkpoint is the hosted-validation checklist for the current beta state. Parts 0–11
carry over from Sprint 25 (all previously validated paths are regression items); Part 12 is
new for Sprint 26.

---

## Part 0 — Pre-flight: Environment Readiness

### 0.1 Repository state

- [ ] HEAD at or after `5cbef34`; working tree clean
- [ ] `verify:runtime` PASS (bundle SHA-256 `3431e6b6e19eaa48f0468dd6ddfc8de52174829669440e721c8ec29ad45e77b9`)
- [ ] `.gitattributes` present (runtime bundles `-text`) — Windows checkouts must show
      `verify:runtime` PASS without a rebuild
- [ ] All four parity scripts pass (87 / 220 / 51 / 37, 0 failures)

### 0.2 SharePoint list readiness — S26 additions

- [ ] `C3Missions` — **not yet provisioned.** Schema doc ready:
      `docs/architecture/C3Missions SP List Schema.md`. Until provisioned, SP DSM behaviour
      must be: no Missions nav item, no console errors, `[C3/Mission]` 404 warning only if the
      service is invoked (it is not reachable from nav while guarded).
- [ ] After provisioning: internal-name verification via REST field query
      (`MissionStatus` — not `Status`/`Status0`) before any smoke test.

### 0.3 SharePoint list readiness — S25 baseline (unchanged)

- [ ] `C3People`, `C3Credentials`, `C3Journeys`, `C3Approvals` operational
- [ ] `C3Approvals.OperationType` choice set includes all seven operation types
- [ ] `C3Contracts` provisioning still pending (Contracts remains guarded)

### 0.4 SP security groups / identity

- [ ] Six C3 groups mapped; unknown user resolves to `visitor` (fail-closed)

---

## Part 1 — Role Resolution (regression, unchanged from S25)

- [ ] Owner / operations / visitor resolution against SP groups
- [ ] Empty loginName fails closed to visitor

---

## Part 2 — NavRail visibility (SP DSM)

- [ ] Visible: Command Center, People, Renewals*, Inbox*, Situation Room, Approvals*,
      Settings†, Diagnostics (* non-visitor; † canManageSettings)
- [ ] Hidden: Contracts, Amendments, Intelligence, **Missions (NEW — TD-25)**

## Part 3 — NavRail visibility (Mock DSM)

- [ ] All items visible per role, **including Missions (NEW)**

---

## Parts 4–11 — S25 baseline regression (unchanged)

Run the Sprint 25 checkpoint Parts 4–11 unchanged:

- [ ] Part 4 — People and PersonProfile (SP DSM)
- [ ] Part 5 — AddPerson path (SP DSM): submit → approve → execute → PER-XXXX → profile
- [ ] Part 6 — AddPerson path (Mock DSM)
- [ ] Part 7 — Credential lifecycle paths (SP DSM) incl. recovery
- [ ] Part 8 — Journey lifecycle paths (SP DSM)
- [ ] Part 9 — Contracts and Intelligence re-enable criteria (unchanged — still guarded)
- [ ] Part 10 — Mock DSM regression (all screens; **now 15 screens incl. Missions**)
- [ ] Part 11 — ErrorBoundary reset validation (navigate away/back after a forced crash)

---

## Part 12 — Mission Workspace (NEW in S26)

### 12.1 Mock DSM

- [ ] NavRail shows Missions; click renders MissionWorkspace without errors
- [ ] KPI strip: Total = 2, Generating Obligations = 1 (TR/2026/006 Confirmed),
      Finance Pending = 1 (SATR/2026/003)
- [ ] Two mission cards render with MissionID, name, status badge, game, organizer, entity,
      jurisdiction, operational window (StartDate → EndDate), currency, notes
- [ ] No create/edit/confirm buttons anywhere on the screen
- [ ] Navigating Missions → Situation Room → Missions retains correct rendering
      (ErrorBoundary key reset regression)

### 12.2 SP DSM — pre-provisioning (current state)

- [ ] Missions item absent from NavRail
- [ ] No `[C3/Mission]` console errors during normal navigation
- [ ] All other screens unaffected

### 12.3 SP DSM — post-provisioning (TD-25 exit criteria; future)

- [ ] `C3Missions` provisioned per schema doc; internal names verified via REST
- [ ] Test rows added (see schema doc §9)
- [ ] NavRail guard removed in a dedicated commit
- [ ] Hard refresh → first click into Missions renders rows, zero mapper rejection warnings
- [ ] `getMission` deep-check: `/_api/web/lists/getbytitle('C3Missions')/items?$filter=Title eq 'TR%2F2026%2F006'`
      returns the row (URL-encoded TR code)
- [ ] Row with an invalid MissionStatus choice (if testable) is rejected with a console warning
      and does not render

---

## Notes

- Mission writes intentionally throw in SP DSM — any UI path that reaches
  `confirmMission`/`updateMissionStatus` in SP DSM is a defect (none should exist).
- If a cold-load flash/crash is ever observed on first navigation into Missions in hosted SP
  DSM, apply the TD-23 `isPending` lesson before deep debugging.
