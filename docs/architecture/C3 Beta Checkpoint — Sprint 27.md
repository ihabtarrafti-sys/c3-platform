# C3 Beta Checkpoint — Sprint 27

**Status:** ✅ **COMPLETE — hosted SP validation fully green (2026-07-03, deployed S27 runtime)**
**Date:** 2026-07-03
**Supersedes:** C3 Beta Checkpoint — Sprint 26
**Head commits:** `f564588` (`fix(s27)` TD-26 containment) · `3275829` (`feat(s27)` participants read foundation)

Parts 0–12 of the Sprint 26 checkpoint carry over as regression items. Part 13 is new for
Sprint 27. Hosted validation was executed against the deployed S27 runtime and passed in full.

---

## Part 0 — Pre-flight

- [x] HEAD at or after `3275829`; working tree clean; pushed
- [x] `verify:runtime` PASS (S27 bundle SHA-256 `faf8c961e70bd5300adbf3b4ebc580b873e3ecee931c00561c31c5b9ab596558`)
- [x] All five parity scripts pass (s15 87 / s16 220 / s17 51 / s18 37 / s27 28, 0 failures)
- [x] `C3MissionParticipants` **provisioned and REST-verified (2026-07-03, S27-7):**
  - [x] Created clean via REST (no grid import); internal names exact:
        `MissionID`, `PersonID`, `ExternalCode`, `ParticipantRole` (not `Role`/`ParticipantRole0`),
        `PerDiemRate`, `IsActive` — zero `field_N` residue
  - [x] `ParticipantRole` choices exactly `Player/Coach/Manager/Analyst/Staff`
  - [x] `IsActive` default = Yes (rows posted without the field read back `true`)
  - [x] Indexes on `MissionID`, `PersonID`
  - [x] 3 sample rows added mirroring Mock DSM seeds (schema doc §9)
  - [x] Service-equivalent queries: `$top=500` all-rows returns 3;
        `$filter=MissionID eq 'TR%2F2026%2F006'` returns exactly PER-0001 + PER-0002
  - [x] Live payload through the real compiled `spMissionParticipantMapper`:
        **3 mapped, 0 rejected, 0 warnings — exact match with mock seeds**
  - [x] Name-resolution precondition: PER-0001/0002/0004 all exist in live `C3People`

## Parts 1–12 — Sprint 26 baseline regression (hosted 2026-07-03)

- [x] Role resolution; NavRail visibility (Missions visible in SP DSM; Contracts/Amendments/
      Intelligence hidden — unchanged in S27)
- [x] People / AddPerson / Credentials / Journeys / Approvals paths green
- [x] Mission Workspace renders both live missions; Situation Room mission scope works
- [x] No ErrorBoundary anywhere during the hosted pass

---

## Part 13 — Mission Participants + TD-26 containment (NEW in S27)

### 13.1 Mock DSM regression — ✅ passed (validation gate + hosted pass)

- [x] Mission Workspace: TR/2026/006 shows "2 participants", SATR/2026/003 shows "1 participant"
- [x] Expanding a card lists assignments (name, PER ID + external code, role badge, per diem)
- [x] "Approve & Confirm Mission" still available in Mock DSM (confirmation flow unchanged)
- [x] Situation Room zero-gap copy with participants present reads the truthful
      "…All assigned participants currently meet the evaluated requirements."

### 13.2 SP DSM hosted smoke — ✅ fully green (2026-07-03, deployed S27 runtime)

- [x] Mission Workspace loads with no ErrorBoundary; TR/2026/006 count = 2,
      SATR/2026/003 count = 1; **no mapper warnings observed**
- [x] Participant names resolve correctly from C3People; PersonID, role, ExternalCode,
      and PerDiemRate render correctly; per diem displays in the mission operating currency
- [x] No participant write controls exist
- [x] Situation Room participant counts correct; zero-participant copy truthful
- [x] **"Approve & Confirm Mission" hidden in SP DSM** (TD-26 guard verified hosted)
- [x] Command Center remains stable
- [x] Core regression green: People/AddPerson, Approvals, Credentials, Journeys
- [x] Contracts, Amendments, and Intelligence remain hidden
- [x] No ErrorBoundary anywhere

### 13.3 Deferred (recorded)

- PersonProfile "Missions" section → Sprint 28 (backlog Track 7)
- Participant writes (governed vs role-gated TBD) → future sprint
- SP mission confirmation write path → TD-26 (open)
