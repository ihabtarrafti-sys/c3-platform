# C3 Architecture Baseline — Sprint 14
## Architecture Hardening and Production Readiness
### v0.14.0-hardening

**Status:** FROZEN  
**Sprint:** 14 — Architecture Hardening and Production Readiness  
**Date:** 2026-06-29  
**Supersedes:** C3 Architecture Baseline — Sprint 13

---

## Sprint Objective

Sprint 14 was a deliberate hardening sprint: no new product features, no UI changes unless forced by refactors. The goal was to identify and fix structural debt that would become a production liability before the SharePoint integration layer. Seven tasks were completed, with the following constraint applied to every change:

> A refactor must reduce production risk, not just make the code look cleaner.

All changes preserve Sprint 13 observable behaviour. The regression suite (Gaps, TR/2026/006, SATR/2026/003, Command Center, Milestones, Finance, People Workspace, Add Credential, Start Journey) passed clean.

---

## What Changed in Sprint 14

### S14-1 — Extract `computeGapsForPeople`

**Before:** The ownership-state algorithm (Unrouted / Routed / Covered tristate) was duplicated across two hooks: `useOperationalGaps` and `useMissionGaps`. Both hooks implemented the same sort logic independently.

**After:** `packages/c3/src/utils/gapComputation.ts` is a pure function module with zero React dependencies. It exports:

- `PersonInfo` — normalisation interface; each hook maps its own source type before calling
- `ComputeGapsOptions` — `{ missionEndDate?: string }` for horizon-aware urgency
- `computeGapsForPeople` — canonical ownership-state and sort implementation

Both hooks are now orchestration layers: fetch → map to PersonInfo → call computeGapsForPeople → return.

**Architectural invariant:** There is exactly one implementation of the gap ownership algorithm. Any change to urgency computation or ownership rules is a one-file edit.

**Production risk eliminated:** Prior to S14-1, a bug fix in one hook's ownership logic would silently leave the other hook divergent. That class of drift is now structurally impossible.

---

### S14-4 — Narrow `ProtocolContext`

**Before:** `ProtocolContext` carried `mission?: Mission`, importing the Mission domain type into the protocol layer. Protocol functions only ever accessed `context.mission?.Span` (for `ObligationSpan`) and `context.mission?.Jurisdiction`.

**After:**

```typescript
interface ProtocolContext {
  span?:         ObligationSpan;   // mission span, if known
  jurisdiction?: string;           // future jurisdiction-aware protocols
}
```

The `Mission` domain type is no longer referenced anywhere in the protocol layer. The `onboardingProtocol.ts` resolveSpan path was simplified (removed the unreachable `context.mission?.Span` branch).

**Architectural invariant:** Protocol definitions (`protocols.ts`, `onboardingProtocol.ts`) have zero dependency on the Mission domain. Mission context is injected as primitive values, not as an entity.

**Production risk eliminated:** Protocol layer can evolve independently of Mission schema changes. The SharePoint integration will not require protocol rewrites when Mission fields change.

---

### S14-2 — Resolve Mission Participant Representation

**Before (dual-source problem):**

```
Mission.ParticipantPersonIDs: string[]   // redundant copy
MissionParticipant.PersonID              // authoritative record
```

Both expressed the same fact. The WorkItem generator pipeline read `mission.ParticipantPersonIDs`. `SituationRoom` also read `selectedMission.ParticipantPersonIDs.length` for the participant count chip. The two sources could silently diverge in a production SharePoint list setup.

**After:**

- `Mission.ParticipantPersonIDs` **removed** from the `Mission` interface
- `IMissionService.listAllMissionParticipants(): Promise<MissionParticipant[]>` added — batch fetch across all missions
- `useAllMissionParticipants` hook builds `participantPersonIdsByMission: Map<string, string[]>` (missionId → personId[])
- `useWorkItems` calls `useAllMissionParticipants` and passes the map into `generateWorkItems`
- `generateWorkItems` signature extended: 4th param `participantPersonIdsByMission: Map<string, string[]> = new Map()`
- `SituationRoom` participant count chip reads from `useMissionParticipants(selectedMission.MissionID)` — which shares the `['missions', missionId, 'participants']` TanStack Query cache key with `useMissionGaps`, so no additional network call

**Finance line clarification:** `MissionFinanceLine.ParticipantID` is confirmed to be in the PersonID namespace. Finance domain is unaffected by this change.

**Architectural invariant:** `MissionParticipant.PersonID` is the sole authoritative source of participant identity. Nothing reads `Mission.ParticipantPersonIDs` (the field does not exist).

**Production risk eliminated:** In SharePoint, `ParticipantPersonIDs` had no native multi-value SP list equivalent — it was flagged as High risk in the S14-7 risk assessment. The field is gone. Participant data flows through the dedicated Participants list, which has a natural SP list representation.

---

### S14-3 — Split `workItemGenerators.ts`

**Before:** A 628-line monolithic file containing constants, 7 helper functions, 5 generators, and the `generateWorkItems` pipeline. The entire WorkItem generation domain in one file.

**After:** `packages/c3/src/utils/workItemGenerators/` directory:

| Module | Contents |
|---|---|
| `helpers.ts` | Constants (`DEPARTURE_PRESSURE_WINDOW_DAYS`, `URGENCY_ORDER`, `PRIORITY_ORDER`) + 7 pure functions (`toCapabilitySlug`, `pickMostUrgent`, `groupByCapability`, `resolveOwnerSource`, `isoDaysFromToday`, `getDaysUntilDeparture`, `sortWorkItems`) |
| `gapGenerators.ts` | `generateJourneyInitiation`, `generateObligationRouting`, `generateCredentialItems` |
| `missionGenerators.ts` | `generateMissionDeparturePressure` |
| `milestoneGenerators.ts` | `generateMilestoneWorkItems` |
| `index.ts` | `generateWorkItems` — 6-step pipeline entry point |

**Implementation exception:** TypeScript resolves `@c3/utils/workItemGenerators` to the `.ts` file before the directory. The original `workItemGenerators.ts` was converted to a zero-logic re-export barrel rather than deleted (deletion is blocked by Windows mount filesystem permissions on the Linux build container). This is functionally equivalent: TypeScript follows the re-export and resolves `generateWorkItems` to `workItemGenerators/index.ts`. The barrel contains no logic.

**Architectural invariant:** Each generator type is independently auditable. A bug in MissionDeparturePressure generation is a `missionGenerators.ts` edit; it cannot affect milestone or gap generators. The 6-step pipeline is readable end-to-end in `index.ts`.

---

### S14-5 — GapFilter Audit (Documentation)

Corrected misleading comment in `useOperationalGaps` that said "Sprint 8: filter is unused." All three `GapFilter` fields (`obligationId`, `capabilityType`, `personIds`) ARE handled internally by the hook's filtering logic. No UI consumer currently passes a non-null filter — each field awaits a UI consumer in a future sprint. The comment now accurately documents this state.

---

### S14-6 — Journey Definition ADR

`docs/adr/ADR-003-journey-definition.md` — defines Journey as operational engagement accountability, not task tracking. Key decisions:

- One Active Journey per type per person
- `MissionID` on Journey is informational only (does not determine gap scope)
- `Covered` ownership state requires an Active Journey AND a matching `obligationAssignment`
- `Journey.AssignedTo` = governance (who owns the Journey); `ObligationAssignment.assignedTo` = execution (who does the work)
- `ObligationAssignment` records live in a dedicated SharePoint list (not embedded in Journey or Mission)

---

### S14-7 — SharePoint Integration Risk Assessment

`docs/architecture/SharePoint Integration Risk Assessment.md` — field-level risk register across all 5 data domains (Missions, Participants, Obligations, Finance, Milestones).

Critical finding: `obligationAssignments` has no SharePoint equivalent yet → `Covered` ownership state is structurally blocked in production until the Assignments list is provisioned and `SharePointMissionService` is extended.

High findings: choice field string matching fragility, date format normalisation, `Category` type exhaustive Record pattern.

---

## Architecture State Post-Sprint 14

### Invariants Now Established

1. **Single gap ownership implementation.** `computeGapsForPeople` in `gapComputation.ts` is the only place the Unrouted / Routed / Covered algorithm lives.

2. **Single participant identity source.** `MissionParticipant.PersonID` is authoritative. `Mission` carries no participant data.

3. **Protocol layer has no domain type dependencies.** `ProtocolContext` accepts primitive values only. Protocols are stable across Mission schema evolution.

4. **WorkItem generators are independently auditable.** One module per generator category. `generateWorkItems` pipeline is readable in its entry point.

5. **Finance domain is decoupled from participant representation.** `MissionFinanceLine.ParticipantID` remains in the PersonID namespace and is unaffected by participant identity changes.

6. **TanStack Query cache keys are semantically namespaced.** `queryKeys.mission.allParticipants()` → `['missions', 'all-participants']`. Per-mission participant cache: `['missions', missionId, 'participants']` (shared between `useMissionGaps` and `useMissionParticipants`).

### Production Readiness Assessment

| Domain | State | Blocker |
|---|---|---|
| Gap computation | ✅ Single source, tested | None |
| Participant identity | ✅ Single source (`MissionParticipant`) | None |
| Protocol layer | ✅ No domain type deps | None |
| WorkItem generation | ✅ Auditable, split | None |
| Finance | ✅ Read-only, mock complete | Actuals entry, SharePoint write |
| Milestones | ✅ Complete | SharePoint Milestones list |
| Journeys | ✅ ADR-003 defined | `obligationAssignments` SP list |
| SharePoint integration | ⚠️ All services are stubs | IT provisioning, list design |

### What Remains Open

- **SharePoint service implementations** — all 5 `SharePoint*Service` stubs return graceful empty arrays. No production data path exists yet. The S14-7 risk register documents what must be built per domain.
- **`obligationAssignments` SP list** — `Covered` gap state is blocked until this list exists and `SharePointMissionService` returns `ObligationAssignment` records.
- **Finance write path** — line creation, actuals entry, and settlement remain UI-deferred.
- **Finance WorkItems** — FinanceAlert category deferred (no logic change in S14-3; milestone-category finance milestones remain the coverage path).
- **Multi-currency missions** — deferred by Sprint 13 frozen decision.
- **GapFilter UI consumers** — three filter fields defined, no UI component yet passes non-null values.
- **workItemGenerators.ts barrel** — cannot be deleted via the Linux mount; remains as a zero-logic re-export. When the monorepo is cloned fresh on any machine, `rm` will work normally. The barrel is a workspace-local artefact.

---

## Files Added or Modified in Sprint 14

### New files

| File | Purpose |
|---|---|
| `packages/c3/src/utils/gapComputation.ts` | Canonical `computeGapsForPeople` (S14-1) |
| `packages/c3/src/hooks/useAllMissionParticipants.ts` | Batch participant hook, builds Map (S14-2) |
| `packages/c3/src/utils/workItemGenerators/helpers.ts` | Constants + 7 pure helpers (S14-3) |
| `packages/c3/src/utils/workItemGenerators/gapGenerators.ts` | JourneyInitiation, ObligationRouting, Credential* (S14-3) |
| `packages/c3/src/utils/workItemGenerators/missionGenerators.ts` | MissionDeparturePressure (S14-3) |
| `packages/c3/src/utils/workItemGenerators/milestoneGenerators.ts` | MilestoneAlert (S14-3) |
| `packages/c3/src/utils/workItemGenerators/index.ts` | `generateWorkItems` pipeline entry point (S14-3) |
| `docs/adr/ADR-003-journey-definition.md` | Journey definition decisions (S14-6) |
| `docs/architecture/SharePoint Integration Risk Assessment.md` | Production risk register (S14-7) |

### Modified files

| File | Change |
|---|---|
| `packages/c3/src/types/mission.ts` | Removed `ParticipantPersonIDs` from `Mission` (S14-2) |
| `packages/c3/src/services/interfaces/IMissionService.ts` | Added `listAllMissionParticipants()` (S14-2) |
| `packages/c3/src/services/mock/MockMissionService.ts` | Removed `ParticipantPersonIDs` from mock data; added `listAllMissionParticipants` impl (S14-2) |
| `packages/c3/src/services/sharepoint/SharePointMissionService.ts` | Added graceful stub for `listAllMissionParticipants` (S14-2) |
| `packages/c3/src/hooks/queryKeys.ts` | Added `mission.allParticipants()` key (S14-2) |
| `packages/c3/src/hooks/useWorkItems.ts` | Wires `useAllMissionParticipants`; passes map into pipeline (S14-2) |
| `packages/c3/src/screens/SituationRoom.tsx` | Participant count from `useMissionParticipants` (S14-2) |
| `packages/c3/src/utils/workItemGenerators.ts` | Converted to zero-logic re-export barrel (S14-3 exception) |
| `packages/c3/src/hooks/useOperationalGaps.ts` | Delegates to `computeGapsForPeople`; comment corrected (S14-1, S14-5) |
| `packages/c3/src/hooks/useMissionGaps.ts` | Delegates to `computeGapsForPeople` (S14-1) |
| `packages/c3/src/types/protocol.ts` | `ProtocolContext` narrowed; `mission` field removed (S14-4) |
| `packages/c3/src/utils/protocols.ts` | Updated to pass `span` and `jurisdiction` directly (S14-4) |
| `packages/c3/src/utils/onboardingProtocol.ts` | `resolveSpan` simplified; unreachable branch removed (S14-4) |
| `docs/99. Engineering Journal.md` | Sprint 14 section appended (S14-1 through S14-7 + regression) |

---

## ADR Index (post Sprint 14)

| ADR | Title | Status |
|---|---|---|
| ADR-001 | Parallel Factory Service Pattern | Accepted |
| ADR-002 | Mission Activation Gate | Accepted |
| ADR-003 | Journey Definition | Accepted (Sprint 14) |

---

## Version Tag

`v0.14.0-hardening`
