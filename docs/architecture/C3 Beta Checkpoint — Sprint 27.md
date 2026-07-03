# C3 Beta Checkpoint — Sprint 27

**Status:** Prepared — hosted validation PENDING S27 runtime deployment
**Date:** 2026-07-03
**Supersedes:** C3 Beta Checkpoint — Sprint 26
**Head commits:** `f564588` (`fix(s27)` TD-26 containment) · `3275829` (`feat(s27)` participants read foundation)

Parts 0–12 of the Sprint 26 checkpoint carry over as regression items. Part 13 is new for
Sprint 27. **Do not mark hosted activation complete until the S27 runtime is deployed and
Part 13 passes.**

---

## Part 0 — Pre-flight

- [ ] HEAD at or after `3275829`; working tree clean; pushed
- [ ] `verify:runtime` PASS (S27 bundle SHA-256 `faf8c961e70bd5300adbf3b4ebc580b873e3ecee931c00561c31c5b9ab596558`)
- [ ] All five parity scripts pass (s15 87 / s16 220 / s17 51 / s18 37 / s27 28, 0 failures)
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

## Parts 1–12 — Sprint 26 baseline regression (run unchanged)

- [ ] Role resolution; NavRail visibility (Missions visible in SP DSM; Contracts/Amendments/
      Intelligence hidden — unchanged in S27)
- [ ] People / AddPerson / Credentials / Journeys / Approvals paths green
- [ ] Mission Workspace renders both live missions; Situation Room mission scope works
- [ ] ErrorBoundary reset behaviour

---

## Part 13 — Mission Participants + TD-26 containment (NEW in S27)

### 13.1 Mock DSM regression

- [ ] Mission Workspace: TR/2026/006 shows "2 participants", SATR/2026/003 shows "1 participant"
- [ ] Expanding a card lists assignments (name, PER ID + external code, role badge, per diem)
- [ ] "Approve & Confirm Mission" still available for SATR/2026/003 in the Situation Room
      (Mock confirmation flow unchanged); confirming transitions to Confirmed
- [ ] Situation Room zero-gap copy in mission scope with participants present reads
      "No obligation gaps detected for this mission. All assigned participants currently
      meet the evaluated requirements."

### 13.2 SP DSM hosted smoke (after S27 SPPKG/runtime deployment)

- [ ] Hard refresh → Missions: TR/2026/006 count = 2, SATR/2026/003 count = 1;
      zero `[C3/MissionParticipant]` rejection warnings; no ErrorBoundary
- [ ] Expanded details resolve live names: PER-0001 Abdulaziz Alabdullatif (Player, RL/PL/026,
      35 USD/day), PER-0002 Mohammad Alkhalailah (Coach, RL/CH/004, 25 USD/day),
      PER-0004 Elaf Hussein (Player, FC/PL/001, 35 SAR/day)
- [ ] Situation Room, TR/2026/006 scope: participant count = 2; gap computation evaluates
      PER-0001 and PER-0002 (gaps or truthful zero-gap copy — never the readiness claim
      with zero participants)
- [ ] Situation Room, SATR/2026/003 scope: **no "Approve & Confirm Mission" action** (TD-26
      guard); participant count = 1; FinancePending mission generates no obligations (ADR-002)
- [ ] Command Center: work items consume the real participant set; no crash, no false
      "all clear" regression
- [ ] Core regression: People / AddPerson / Credentials / Journeys / Approvals all green
- [ ] No participant or mission write affordances anywhere in SP DSM

### 13.3 Deferred (recorded)

- PersonProfile "Missions" section → Sprint 28 (backlog Track 7)
- Participant writes (governed vs role-gated TBD) → future sprint
- SP mission confirmation write path → TD-26 (open)
