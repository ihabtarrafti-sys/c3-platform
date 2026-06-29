# Sprint 14 Proposal — Architecture Hardening and Production Readiness

**Sprint name:** Architecture Hardening: Making the Foundation Safe to Build On  
**Version target:** v0.14.0-hardening  
**Status:** Proposed — awaiting approval  
**Preceded by:** Sprint 13 (Mission Finance: Financial Planning Spine)

---

## Sprint Goal

Sprint 14 adds no new product features. Its goal is to resolve the structural problems identified in the post-Sprint 13 architectural review before the platform connects to real SharePoint data or adds another feature layer.

The test for a completed Sprint 14 is not "what can the product do that it couldn't before?" It is "can we confidently extend the platform in Sprint 15 without fixing the same structural problems under deadline pressure?"

---

## Why Now

Eight sprints of deliberate, well-architected work have produced a genuine first vertical slice. The architectural review found no critical defects — but it found several categories of problem that compound with time:

- **Duplicated logic** that will require synchronised fixes in two places when the gap computation changes (jurisdiction-aware protocols, new obligation types, performance tuning).
- **Redundant type representations** that produced a real bug in Sprint 13 and will produce more as Finance and Travel facets multiply participant references.
- **Speculative abstraction** that has been carried unused for five-plus sprints and increases cognitive load for every developer reading the hooks.
- **Undocumented concepts** (Journey) that have grown three distinct responsibilities without a written definition, which will make the first operator conversation about routing confusing.
- **Five SharePoint stubs** that have never run against real data, with no written assessment of what will break first.

None of these will get easier to fix after Sprint 15 adds Travel, Finance WorkItems, or actuals entry. Each will get harder.

---

## Sprint Items

### S14-1 — Extract shared gap computation into a pure utility function

**Rationale.** `useOperationalGaps` and `useMissionGaps` contain approximately 60 lines of identical ownership resolution logic. The `OwnershipState` derivation — the lookup against `journey.obligationAssignments`, the four-level `OwnerSource` resolution, the `assignedTo` determination — is implemented twice. When jurisdiction-aware protocols arrive in a future sprint and the evaluation logic changes, that change will need to be made in two places. The second fix will be forgotten at least once.

The correct model already exists in the codebase. `workItemGenerators.ts` is a library of pure computation functions that hooks compose. The gap computation does not follow this pattern; it is embedded inside hooks.

**Scope.** Extract a pure utility function — `computeGapsForPeople` — with the following signature:

```typescript
// src/utils/gapComputation.ts  (new file)
export function computeGapsForPeople(
  people:              { personId: string }[],
  credentialsByPerson: Map<string, Credential[]>,
  journeyByPerson:     Map<string, Journey>,
  protocols:           ProtocolFn[],
  context?:            ProtocolContext,
  options?:            { obligationFilter?: ObligationStatus[] }
): OperationalGap[]
```

Both `useOperationalGaps` and `useMissionGaps` call this function. The hooks become responsible only for: fetching data, building the input Maps, calling `computeGapsForPeople`, and returning the result. The ownership algorithm and obligation-to-gap conversion live in exactly one place.

The `obligationFilter` option handles the ADR-002 gate: `useMissionGaps` passes `MISSION_OBLIGATION_ACTIVE_STATUSES` filter; `useOperationalGaps` passes none.

**Acceptance criteria.**
- `gapComputation.ts` exists and exports `computeGapsForPeople` as a pure function (no React, no hooks, no side effects).
- `useOperationalGaps` and `useMissionGaps` each call `computeGapsForPeople` and contain no inline ownership resolution logic.
- For every existing mock mission and person, both hooks produce identical results before and after the refactor.
- Build passes. No new Fast Refresh warnings.

**Out of scope.** Do not change the sort order, the `GapFilter` interface, or the urgency computation in this task. Those are addressed in S14-4 and S14-5.

---

### S14-2 — Resolve the dual Mission participant representation

**Rationale.** `Mission` carries two representations of its participant list: `ParticipantPersonIDs: string[]` (a flat array of person ID strings) and the separately-loaded `MissionParticipant[]` entities (with `ExternalCode`, `Role`, `PerDiemRate`, and presumably a `PersonID` field). These are two sources of truth for the same fact. Sprint 13 surfaced the problem concretely: `missionParticipantCount` was computing participant count from gap person IDs (which returns zero for FinancePending missions due to ADR-002), and the fix switched it to `selectedMission.ParticipantPersonIDs.length`. That was the right fix — but it works because the array exists. As Finance and Travel add more participant-linked entities, having two participant representations will produce increasingly subtle bugs. If a participant is added to a Mission but the array and the entity list fall out of sync, every consumer will silently disagree on participant count.

**Scope.** This task has two phases: first, a type audit to understand the current state; then, a resolution.

*Phase 1 — Audit.* Read `MissionParticipant` in full. Confirm: does it carry a `PersonID: string` field distinct from `ExternalCode`? Does `useMissionGaps` key its iteration on `PersonID` or `ExternalCode`? Document the answer.

*Phase 2 — Resolution.* If `MissionParticipant` carries `PersonID`, the correct resolution is to make `MissionParticipant[]` authoritative and derive the array where needed:

- `Mission.ParticipantPersonIDs` is either removed from the type or marked `@deprecated` with a comment: `// Derived from MissionParticipant[]. Use participants array directly.`
- All call sites that read `ParticipantPersonIDs` are updated to derive from `MissionParticipant[]`.
- `useMissionGaps` computes the ADR-002 gate set from the loaded participants, not from the Mission field.
- Mock data factories are updated to either omit the field or derive it programmatically.

If the audit reveals a reason the two representations must co-exist (e.g. `MissionParticipant` does not carry `PersonID`), then the resolution is instead to add `PersonID` to `MissionParticipant` and proceed as above.

The Sprint 13 participant count bug is the minimum bar. The Sprint 14 outcome is that the bug is architecturally impossible — not that it has been patched.

**Acceptance criteria.**
- There is exactly one authoritative list of participants per Mission.
- The Sprint 13 `missionParticipantCount` fix still produces correct results, now derived from the authoritative source.
- `useMissionFinanceLines` (which links finance lines by `ParticipantID`) continues to resolve correctly.
- Build passes.

---

### S14-3 — Split `workItemGenerators.ts` before it reaches critical mass

**Rationale.** `workItemGenerators.ts` is currently approximately 400 lines covering: credential gap→WorkItem conversion, mission departure pressure, per-person generators, and milestone alert generation. It is the platform's single computation library and it is well-structured. But it is also the natural destination for Finance WorkItems, Travel WorkItems, and any future alert types. At 400 lines with one feature domain, it will reach 700+ lines before Sprint 16 at the current pace. The time to split a file is before it becomes painful to navigate, not after.

**Scope.** Reorganise into a `workItemGenerators/` directory:

```
src/utils/workItemGenerators/
  index.ts              — public re-exports only; existing import paths continue to work
  credential.ts         — generateCredentialWorkItems, per-person credential generators
  mission.ts            — generateMissionDeparturePressure, generateMissionWorkItems
  milestone.ts          — generateMilestoneWorkItems, MilestoneAlert
  priority.ts           — sortWorkItems, priority rules (currently in workItemPriority.ts — evaluate whether this merges here or stays separate)
  types.ts              — WorkItemGeneratorInput type if one emerges
```

The `index.ts` re-exports everything currently exported from `workItemGenerators.ts`, so no import paths in hooks or screens change. This is a purely structural refactor.

**Acceptance criteria.**
- `workItemGenerators.ts` (the flat file) no longer exists. All logic lives in the directory.
- All existing imports of `@c3/utils/workItemGenerators` resolve without changes.
- All existing WorkItems are generated with identical content and order.
- Build passes.

---

### S14-4 — Narrow `ProtocolContext` to only what protocols actually use

**Rationale.** `ProtocolContext` currently carries `mission?: Mission` — the full Mission entity. Protocols use exactly one thing from it: `mission.Span.EndDate`, as the urgency horizon for mission-scoped gap evaluation. Passing the full Mission creates a broad type dependency from the protocol evaluation layer to the Mission domain. As Mission grows (adding FinanceLine references, AmendmentIDs, or roster change events), protocols implicitly import everything Mission becomes. The correct dependency is narrow: a protocol needs a span end date, not a mission.

**Scope.** Change the `ProtocolContext` interface:

```typescript
// Before
interface ProtocolContext {
  span?:    { StartDate: string; EndDate: string };
  mission?: Mission;   // ← remove this
  // proposed additions:
  jurisdiction?: string;   // ← add (used by future jurisdiction-aware protocols)
}
```

All call sites where `context.mission` is accessed are updated to use `context.span` instead. The jurisdiction field is added now (empty string or undefined in current call sites) so that the interface is ready for jurisdiction-aware protocol work without another context type change.

Concretely: `useMissionGaps` currently passes `context = { span: mission.Span, mission }`. After this change it passes `context = { span: mission.Span, jurisdiction: mission.Jurisdiction }`. The Mission import is removed from `protocols.ts`.

**Acceptance criteria.**
- `ProtocolContext` has no `mission` field.
- `ProtocolContext` has `jurisdiction?: string`.
- No file in `src/utils/protocols/` (or wherever `ProtocolFn` is defined) imports from `@c3/types/mission`.
- All protocol evaluations produce identical results.
- Build passes.

---

### S14-5 — Audit and clean `GapFilter`

**Rationale.** `GapFilter` carries `protocols`, `personIds`, and `context` fields that have had no consumer since the interface was introduced. They exist speculatively. Every developer reading `useOperationalGaps` encounters these fields, reads the hook signature, and must determine whether they are used. They never are. Speculative abstraction is not free — it costs attention every time the code is read and creates a false impression that filtering capabilities exist when they do not.

**Scope.** Read `GapFilter` in full and audit every call site.

If `protocols`, `personIds`, and `context` have no consumer in any hook, component, or test: remove them. The remaining fields (if any) stay. A comment block is added to the interface:

```typescript
/**
 * GapFilter — subset consumed by useOperationalGaps.
 *
 * Fields deferred (not yet implemented):
 *   - personIds filter: add when PersonSelector UI exists
 *   - protocol filter: add when protocol picker UI exists
 */
```

If any field does have a consumer, document which consumer and why — the audit itself is valuable regardless of the outcome.

**Acceptance criteria.**
- `GapFilter` contains only fields that have at least one real consumer in the codebase.
- Any removed fields are documented as deferred in a comment.
- Build passes.

---

### S14-6 — Write the Journey Design Document (ADR-003)

**Rationale.** Journey is currently the most under-documented concept in the platform. It carries three distinct responsibilities: it is an accountability record ("someone is engaged with this person's readiness"), a workflow container ("here is the sequence of obligations being worked"), and an obligation coverage signal ("Covered means this Journey explicitly owns that gap"). These three roles have never been written down. As a result:

- It is unclear whether a person can have multiple concurrent Journeys (one per Mission? one per programme?).
- The relationship between a Journey's `obligationAssignments` and Mission participation is unspecified.
- The Covered ownership state requires a Journey to have explicit assignments — but no UI exists to set them. The Covered state has never been produced by an operator action.
- When real operators ask "what is a Journey?", there is currently no written answer.

This is not a code problem — it is a definition problem. Resolving it before the SP integration is important because the Journey list schema and the obligation assignment schema will need to be designed, and they cannot be designed without a clear concept definition.

**Scope.** Write `docs/adr/ADR-003-journey-definition.md` answering the following questions:

1. What is a Journey? One sentence definition.
2. What is the lifecycle of a Journey (created, active, closed)?
3. Can a person have multiple concurrent Journeys? If yes, how do they relate? If no, what happens when a second Journey is initiated?
4. How does a Journey relate to a Mission? Is a Journey mission-scoped, or cross-mission?
5. What does it mean for a Journey to "cover" an obligation? What state must the Journey be in, and what must `obligationAssignments` contain?
6. What operator action creates a Journey? What creates an obligation assignment within a Journey?
7. What is the minimum SP list schema required to support Journey persistence?

The ADR records the current best answer, not a final answer. Where questions are genuinely unresolved, the ADR says so explicitly and identifies what information is needed to resolve them (e.g., "requires operator validation").

**Acceptance criteria.**
- `ADR-003-journey-definition.md` exists and answers all seven questions above.
- The ADR is consistent with the current Journey type definition and the current ownership resolution logic in the gap computation hooks.
- No code changes are required (this task is documentation only).

---

### S14-7 — Write the SharePoint Integration Risk Assessment

**Rationale.** Five domain stubs (`ICredentialService`, `IJourneyService`, `IMissionService`, `IMilestoneService`, `IFinanceService`) have placeholder SharePoint implementations that return empty data or throw. The mock data is clean, consistent, and carefully designed. Real SharePoint data will not be. The platform has never run against a real SP list. The first production test will surface failures that should be anticipated and mitigated before that test happens — not discovered during it.

This task does not implement anything. It produces a written document that the team (and any future SP developer) can use to sequence integration safely.

**Scope.** Write `docs/architecture/SharePoint Integration Risk Assessment.md` covering:

**Per-domain risk inventory.** For each of the five service domains, identify:
- What SP list(s) the service will read from.
- What fields the protocol or hook depends on that could be null, missing, or differently formatted in real SP data.
- What the failure mode is if that field is absent (silent wrong result vs exception vs visible error).
- Whether the `MockService` has any defensive null handling that the `SharePointService` would also need.

**Null safety audit.** The protocol evaluation functions (`evaluateOnboardingObligations`) assume credential fields are present. In real SP data, credentials may have: missing `ExpiryDate` on non-expiring credential types, `SubType` values not currently handled, date strings in SP's regional format rather than ISO 8601, or list items without expected lookup fields populated. Each of these should be named and assigned a risk level (Low / Medium / High).

**Integration sequencing recommendation.** Which domain should be integrated first? The case for Credentials first (smallest list, clearest schema, most protocol coverage) versus Missions first (the natural entry point) should be evaluated. The recommended sequence is documented with rationale.

**Test data requirements.** What SP list content is the minimum needed to run a meaningful first integration test? Specifically: how many credential records, how many people, how many missions, and what state combinations are needed to exercise the ADR-002 gate, the ownership resolution, and the Finance summary?

**Acceptance criteria.**
- The document exists at `docs/architecture/SharePoint Integration Risk Assessment.md`.
- All five service domains are covered.
- The null safety audit lists at least the credential date format issue, the missing SubType case, and any null-field risks visible from reading the current protocol implementation.
- A recommended integration sequence is stated with rationale.
- No code changes are required (this task is documentation and analysis only).

---

## Sequencing

Sprint 14 tasks are grouped into two phases to manage risk. Documentation tasks carry no code risk and can proceed in parallel. Structural refactors are sequenced to reduce cascade:

**Phase 1 — Clarify before changing (S14-5, S14-6, S14-7)**

S14-5 (GapFilter audit) is the fastest task and should be done first — it clarifies what the hook interface actually is before S14-1 refactors it. S14-6 (Journey ADR) and S14-7 (SP risk assessment) are documentation tasks with no code dependencies; they can proceed in parallel with each other and with Phase 1 code work.

**Phase 2 — Structural refactors (S14-1, S14-2, S14-3, S14-4)**

S14-1 (extract gap computation) should be completed before S14-4 (narrow ProtocolContext) because the context type is consumed inside the computation that S14-1 extracts. Changing the context type while the logic is still embedded in two hooks means two sets of call sites to update simultaneously. Extract first, then narrow.

S14-2 (participant representation) and S14-3 (workItemGenerators split) are independent of each other and of S14-1. They can be done in any order within Phase 2.

Recommended order: S14-5 → S14-1 → S14-4 → S14-2 → S14-3 → S14-6 (can overlap) → S14-7 (can overlap)

---

## What This Sprint Does Not Include

The following are explicitly out of scope for Sprint 14, regardless of how natural they might feel to add:

- Travel facet or any new mission facet
- Finance WorkItems (budget not approved N days before departure)
- Actuals entry or settlement marking UI
- `WorkItemStatus` implementation (InProgress / Resolved state transitions)
- SharePoint service implementation for any domain (the risk assessment is analysis, not implementation)
- Any changes to the Situation Room, Command Center, or People Workspace screens beyond what the structural refactors require
- New mock data scenarios

If any of the refactors reveal a bug or edge case not visible in current mock data, the bug is noted and logged as a Sprint 15 candidate — it is not fixed inline unless the fix is a one-line correction with no architectural implications.

---

## Sprint Success Criteria

Sprint 14 is complete when all of the following are true:

1. `computeGapsForPeople` is a pure utility function. Neither gap hook contains inline ownership resolution logic.
2. Mission participant data has exactly one authoritative representation. The Sprint 13 count fix is architecturally enforced, not patched.
3. `workItemGenerators.ts` does not exist as a flat file. The directory structure is in place and all import paths continue to work.
4. `ProtocolContext` has no `mission` field. No protocol file imports from `@c3/types/mission`.
5. `GapFilter` contains only fields with real consumers, or is documented with deferred fields clearly noted.
6. `ADR-003-journey-definition.md` exists and answers the seven scoped questions.
7. `SharePoint Integration Risk Assessment.md` exists and covers all five domains with a recommended integration sequence.
8. `tsc -b packages/c3` exits 0.
9. All existing mock data scenarios render identically in the Situation Room, Command Center, and People Workspace to their Sprint 13 state.

---

## Sprint 15 Readiness

After Sprint 14 completes, the following Sprint 15 candidates are available and will be meaningfully easier to implement safely:

- **Finance WorkItems** — the split generator structure has a clear home for `generateFinanceWorkItems.ts`. The priority framework is in one place.
- **Travel facet** — `MissionParticipant` is now the unambiguous participant source. Travel records can link by `MissionParticipant.PersonID` without a redundancy question.
- **Jurisdiction-aware protocols** — `ProtocolContext.jurisdiction` is already on the interface. Adding a `evaluateJurisdictionObligations` function requires no context type change.
- **SharePoint Credential integration** — the risk assessment provides a sequencing recommendation and a null-safety checklist. The first SP integration can proceed against a known list of risks rather than discovering them during the test.
- **Journey routing UI** — ADR-003 defines what an obligation assignment is and what operator action creates it. The first routing UI surface has a specification to implement against.

The choice of Sprint 15 direction — Travel, Finance WorkItems, Actuals/Settlement, or SP Credential integration — is deferred until Sprint 14 is approved and complete.
