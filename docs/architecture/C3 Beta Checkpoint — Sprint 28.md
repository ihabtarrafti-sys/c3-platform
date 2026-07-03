# C3 Beta Checkpoint — Sprint 28

**Status:** ✅ **COMPLETE — hosted SP validation fully green (2026-07-03, deployed S28 runtime)**
**Date:** 2026-07-03
**Supersedes:** C3 Beta Checkpoint — Sprint 27
**Head commits:** `d04cd24` (`feat(s28)` logistics read foundation) · `0461d45` (`feat(s28)` UI) · `fe2966f` (`build(s28)` runtime)

Parts 0–13 of the Sprint 27 checkpoint carry over as regression items. Part 14 is new for
Sprint 28. Hosted validation was executed against the deployed S28 runtime and passed in full.

---

## Part 0 — Pre-flight

- [x] HEAD at or after `fe2966f`; working tree clean; pushed
- [x] `verify:runtime` PASS (S28 bundle SHA-256 `703423d983ea3a9a49d81feaf840f79c902fbea4656e4bada1dd022a7daa72b3`)
- [x] All six parity scripts pass (s15 87 / s16 220 / s17 51 / s18 37 / s27 28 / s28 35, 0 failures)
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

## Parts 1–13 — Sprint 27 baseline regression (hosted 2026-07-03)

- [x] NavRail visibility (Contracts/Amendments/Intelligence hidden — unchanged in S28)
- [x] People / AddPerson / Credentials / Journeys / Approvals green
- [x] Missions + participants render; Situation Room mission scope stable + TD-26 guard held
- [x] Command Center stable; no ErrorBoundary anywhere

---

## Part 14 — Apparel + Kit + Person Mission Visibility (NEW in S28)

### 14.1 Mock DSM regression — ✅ passed (validation gate + hosted pass)

- [x] PersonProfile apparel + missions sections render with mock seeds; deep-links work
- [x] Missing apparel profile and no-missions empty states truthful
- [x] MissionWorkspace kit summaries and per-item lines correct; fulfilled counting correct
- [x] Readiness and Approvals tabs unchanged; journey/credential flows unchanged

### 14.2 SP DSM hosted smoke — ✅ fully green (2026-07-03, deployed S28 runtime)

- [x] PersonProfile Apparel Profile section renders correctly; JerseySize, NameOnJersey,
      Notes map correctly; missing profile reads "No apparel profile on file."
- [x] PersonProfile Missions section renders assigned missions; rows deep-link to the
      Situation Room with the correct mission scope
- [x] Existing PersonProfile credentials, contracts, readiness, approvals remain stable
      (full regression — first PersonProfile touch since S25)
- [x] Mission Workspace kit assignments render correctly: counts and fulfilled counts
      correct; Jersey/Apparel/Equipment categories correct; AssignmentKey, description,
      status, jersey number, owner display correctly
- [x] Delivered + Confirmed count as fulfilled; Ordered/NotOrdered remain incomplete
- [x] Participant names deep-link to PersonProfile
- [x] Situation Room and Command Center stable; core domains green
- [x] **No mapper warnings; no ErrorBoundary**
- [x] Contracts, Amendments, Intelligence remain hidden; no write affordances anywhere

### 14.3 Deferred (recorded)

- Apparel/kit/participant writes → Sprint 29 (governance classification at S29 Phase 0)
- Situation Room logistics readiness + Command Center kit work items → S29+
- Travel and freight domains → future lists (out of kit-assignment scope by design)
