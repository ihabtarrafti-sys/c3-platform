# Sprint 39 — Missions Domain (Design & Increment Plan) — THE CAPSTONE

**Author:** Architect-of-record · **Date:** 2026-07-08 · **Goal:** the final CP-parity domain. Missions compose everything the platform has built: a direct-audited mission shell (Sprint 38's pattern) + **governed participant membership** (the approval pipeline) with the duplicate-participant guards that were hosted-certified in the SP era (refusal at submit AND at execute — the Set-D discipline).
**Claims discipline:** nothing publicly claimable until hosted-certified and worded by the truthfulness authority.

## Entities

**Mission** — `MSN-XXXX`: name (required ≤160), gameTitle (optional ≤120), startsOn (plain date, required), endsOn (plain date, optional, > startsOn), notes, isActive, version. **Direct-audited CRUD** (create/update/deactivate), capability `canManageMissions` = owner/operations (the CP Set-C correction: ops had improper direct Missions edit, corrected to a deliberate grant here). Audit: `MissionCreated/Updated/Deactivated`.

**Mission participant** — a person's membership in a mission: `(tenant, missionId, personId)` UNIQUE (one row per pair, ever — reactivation reuses the row, never duplicates: the SP APR-0065 semantics), `role` (free text ≤120, e.g. "Player", "Coach"), `isActive`. **GOVERNED**: `AddMissionParticipant` and `RemoveMissionParticipant` ride the approval pipeline. Audit: `MissionParticipantAdded/Removed` (+ reactivation is an Add that flips the existing row).

## The centerpiece guards (SP-certified behavior, rebuilt natively)

1. **Duplicate-PENDING refused at submit**: an open approval (Submitted/InReview/Approved) for the same (mission, person) pair blocks a second submission.
2. **Duplicate-ACTIVE refused at submit AND at execute** (the Set-D double guard): submit-time check is friendly; the execute-time check is authoritative inside the transaction — a pair that became active between approval and execution produces a truthful `ExecutionFailed` (`ParticipantConflictError` equivalent), never a duplicate row.
3. **Reactivation reuses the row**: adding a previously-removed participant flips the existing row active on execute (UNIQUE-constraint-backed), preserving the pair's full audit lineage.
4. Remove: participant must exist and be active (submit-friendly + execute-authoritative).
5. Both operations validate the mission is active and the person exists (composite FKs authoritative).

## Read surfaces (M4)

Missions register (MSN id, name, game, dates, Active/Inactive) + mission detail page (DefinitionList + **participants table** with governed add/remove affordances + the mission's audit history) + person-profile missions section (deferred if time presses; the detail page is the core).

## Increments

- **M1 — domain**: Mission + MissionParticipant entities, `MSN-` ids, input schemas (mission CRUD + the two governed participant payloads), audit actions, `canManageMissions`, `ParticipantConflictError` (new domain error). OPERATION_TYPES 8→10.
- **M2 — persistence + application**: migration 0012 (mission + mission_participant, RLS FORCE, UNIQUE pair, composite FKs), equipment-pattern CRUD for the shell, the governed participant use-cases with all five guards, execute dispatch, export/exit (+2 tables). Tests: the guard matrix is the heart.
- **M3 — API**: registers + detail reads, shell CRUD routes, participant submit routes (standard approval surface for review/execute). HTTP tests incl. both duplicate refusals.
- **M4 — web + deploy**: register + mission detail with participants + dialogs + E2E; staging deploy (0012 paste → API → web) + hosted smoke → **FULL CP PARITY**.
