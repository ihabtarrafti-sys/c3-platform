# C3 Beta Checkpoint — Sprint 28

**Status:** Prepared — hosted validation PENDING S28 runtime deployment
**Date:** 2026-07-03
**Supersedes:** C3 Beta Checkpoint — Sprint 27
**Head commits:** `d04cd24` (`feat(s28)` logistics read foundation) · `0461d45` (`feat(s28)` UI) · `fe2966f` (`build(s28)` runtime)

Parts 0–13 of the Sprint 27 checkpoint carry over as regression items. Part 14 is new for
Sprint 28. **Do not mark Sprint 28 closed until the S28 runtime is deployed and Part 14
passes.**

---

## Part 0 — Pre-flight

- [ ] HEAD at or after `fe2966f`; working tree clean; pushed
- [ ] `verify:runtime` PASS (S28 bundle SHA-256 `703423d983ea3a9a49d81feaf840f79c902fbea4656e4bada1dd022a7daa72b3`)
- [ ] All six parity scripts pass (s15 87 / s16 220 / s17 51 / s18 37 / s27 28 / s28 35, 0 failures)
- [x] `C3PersonApparelProfiles` **provisioned and REST-verified (2026-07-03, S28-7):**
      internal names exact (`JerseySize`, not `Size`), choices `XS/S/M/L/XL/XXL/3XL`,
      IsActive default Yes, PersonID indexed, zero `field_N` residue; 2 sample rows
      (PER-0001, PER-0002; **PER-0004 deliberately has no row**)
- [x] `C3MissionKitAssignments` **provisioned and REST-verified (2026-07-03, S28-7):**
      internal names exact (`KitStatus`/`ItemCategory`/`AssignmentKey`), all 8 KitStatus +
      3 ItemCategory choices, KitStatus default `NotOrdered`, IsActive default Yes,
      MissionID+PersonID indexed, zero residue; 4 sample rows mirroring mock seeds
- [x] Service-equivalent queries verified: all-kit = 4; TR/2026/006 filter = 3;
      apparel PersonID filter returns the single active profile
- [x] Live payloads through the real compiled mappers: **kit 4/4, apparel 2/2 — zero
      rejects, zero warnings, EXACT MATCH with mock seeds**

## Parts 1–13 — Sprint 27 baseline regression (run unchanged)

- [ ] NavRail visibility (Contracts/Amendments/Intelligence hidden — unchanged in S28)
- [ ] People / AddPerson / Credentials / Journeys / Approvals green
- [ ] Missions + participants render; Situation Room mission scope + TD-26 guard
- [ ] No ErrorBoundary

---

## Part 14 — Apparel + Kit + Person Mission Visibility (NEW in S28)

### 14.1 Mock DSM regression

- [ ] PersonProfile PER-0001: Apparel Profile section shows L / ABDULAZIZ / fit note;
      Missions (1) shows TR/2026/006 (Player, Confirmed); row navigates to Situation Room
      with the mission pre-scoped
- [ ] PersonProfile PER-0004: Apparel section reads "No apparel profile on file."; Missions
      (1) shows SATR/2026/003
- [ ] A person with no assignments shows "Not assigned to any missions."
- [ ] MissionWorkspace TR/2026/006 expanded: PER-0001 shows "Kit: 2 items · 2 fulfilled"
      (Jersey #7 Delivered + Equipment Confirmed); PER-0002 shows 1 item Ordered
      (0 fulfilled); names deep-link to PersonProfile
- [ ] SATR/2026/003 expanded: PER-0004 shows 1 item NotOrdered
- [ ] Readiness and Approvals tabs unchanged; journey/credential flows unchanged

### 14.2 SP DSM hosted smoke (after S28 SPPKG/runtime deployment)

- [ ] Hard refresh → PersonProfile PER-0001: both new sections render with live data; zero
      `[C3/ApparelProfile]` / `[C3/KitAssignment]` rejection warnings; no ErrorBoundary
- [ ] PersonProfile PER-0004: truthful missing-profile copy (no error state)
- [ ] Mission rows navigate to Situation Room mission scope and back without state loss
- [ ] MissionWorkspace: kit summaries and per-item badges as in 14.1; zero-kit participants
      read "No kit assignments recorded." and never render a complete state
- [ ] Participant name deep-links land on the correct PersonProfile
- [ ] **PersonProfile full regression (first touch since S25):** Parts 4–6 of the S25/S27
      checkpoints — profile fields, credentials add/deactivate, journey lifecycle,
      approvals tab — all green
- [ ] Core regression: People/AddPerson, Approvals, Credentials, Journeys, Command Center,
      Situation Room (incl. TD-26 guard still hidden)
- [ ] No write affordances for apparel or kit anywhere

### 14.3 Deferred (recorded)

- Apparel/kit/participant writes → Sprint 29 (governance classification at S29 Phase 0)
- Situation Room logistics readiness + Command Center kit work items → S29+
- Travel and freight domains → future lists (out of kit-assignment scope by design)
