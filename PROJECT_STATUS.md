# C3 Platform Status

## Version

v0.14.0-hardening

## Current Phase

Sprint 14 complete — Architecture Hardening and Production Readiness

## Platform Status

✅ Platform SDK Frozen
✅ Runtime Architecture Complete
✅ SPFx Host Complete
✅ Monorepo Complete
✅ Build Pipeline Complete
✅ C3 Design System v1.0 Frozen
✅ Operational Model v2 Approved
✅ Architecture Structural Freeze Complete (Sprint 6E)
✅ Architecture Baseline Frozen (Sprint 9)
✅ Architecture Baseline Frozen (Sprint 10 — Mission v1)
✅ WorkItem Model Baseline Frozen (Sprint 11)
✅ Mission v2 Operational Planning Design Complete
✅ First Operational Workflow Complete (Sprint 6F)
✅ Capability-Based Credential Model Complete (Sprint 6G)
✅ Credential Management — Add Only (Sprint 7)
✅ Situation Room — Cross-Person Gap Visibility (Sprint 8)
✅ Operational Gap Ownership — Three-State Ownership Model (Sprint 9)
✅ Mission v1 — Operational Context (Sprint 10)
✅ Command Center — Operational Work Queue (Sprint 11)
✅ Mission Milestones — Planning Spine (Sprint 12)
✅ Mission Finance — Financial Planning Spine (Sprint 13)
✅ Architecture Hardening and Production Readiness (Sprint 14)

## Next Action

No implementation committed. Sprint 15 candidates: Travel logistics, Finance WorkItems, actuals entry, settlement, SharePoint integration pilot.

---

## Sprint History

### Sprint 14 — Architecture Hardening and Production Readiness ✅ COMPLETE

**Goal:** Harden the existing architecture before adding another feature layer. No new product features. No UI changes unless required by refactors. All changes must preserve Sprint 13 behaviour and reduce production risk.

**Delivered:**

**S14-5 — GapFilter Audit (documentation only)**
- Corrected misleading "Sprint 8: filter is unused" comment — all three GapFilter fields ARE internally handled by `useOperationalGaps`
- No UI consumer passes a non-null filter yet — each field awaits a UI consumer; documented accurately

**S14-6 — Journey ADR: ADR-003**
- `docs/adr/ADR-003-journey-definition.md` — defines Journey as operational engagement accountability, not task tracking
- Decisions: one Active Journey per type per person; MissionID informational only; Covered requires Active + matching obligationAssignment; Journey.AssignedTo = governance, ObligationAssignment.assignedTo = execution; ObligationAssignments → separate SP list

**S14-7 — SharePoint Integration Risk Assessment**
- `docs/architecture/SharePoint Integration Risk Assessment.md` — field-level risk register across all 5 domains
- Critical: `obligationAssignments` has no SP equivalent → Covered state blocked in production
- High: choice field string matching, date format, ParticipantPersonIDs (no SP array), Category exhaustive Record

**S14-1 — Extract computeGapsForPeople**
- `utils/gapComputation.ts` — pure function, no React, exports `PersonInfo`, `ComputeGapsOptions`, `computeGapsForPeople`
- Ownership-state algorithm (Unrouted/Routed/Covered) now has exactly one implementation
- Both gap hooks are orchestration layers only: fetch, map, compute, return
- `missionEndDate` forwarded to `computeUrgency` for fixed-deadline urgency in mission scope

**S14-4 — Narrow ProtocolContext**
- Removed `mission?: Mission` from `ProtocolContext` — protocols only needed `mission.Span`
- Added `jurisdiction?: string` for future jurisdiction-aware protocols
- `protocols.ts` has zero dependency on the Mission domain type
- `resolveSpan` in `onboardingProtocol.ts` simplified: unreachable `context.mission?.Span` branch removed

**S14-2 — Resolve Mission Participant Representation**
- Removed `Mission.ParticipantPersonIDs: string[]` — was a redundant copy of `MissionParticipant.PersonID`
- Added `IMissionService.listAllMissionParticipants()` — batch fetch across all missions
- `hooks/useAllMissionParticipants.ts` — derives `participantPersonIdsByMission: Map<string, string[]>`
- `useWorkItems` wires the map; `generateWorkItems` consumes it instead of `mission.ParticipantPersonIDs`
- `SituationRoom` participant count sourced from `useMissionParticipants` (cache-shared with `useMissionGaps`)
- `MissionFinanceLine.ParticipantID` confirmed as PersonID namespace — Finance domain unaffected

**S14-3 — Split workItemGenerators.ts**
- Monolith (628 lines) split into `utils/workItemGenerators/` directory:
  - `helpers.ts` — constants + 7 shared pure functions
  - `gapGenerators.ts` — JourneyInitiation, ObligationRouting, CredentialAcquisition/Renewal
  - `missionGenerators.ts` — MissionDeparturePressure
  - `milestoneGenerators.ts` — MilestoneAlert
  - `index.ts` — `generateWorkItems` pipeline entry point
- `utils/workItemGenerators.ts` converted to zero-logic re-export barrel (deletion blocked by Windows mount filesystem permissions)
- All deterministic ID formats, sort rules, and pipeline step order preserved

**Production readiness changes:**
- Gap computation: single implementation, no duplication
- Participant identity: single source of truth (`MissionParticipant.PersonID`)
- Protocol layer: zero dependency on Mission domain type
- WorkItem generator: auditable in isolation per generator type

**Validated:**
- All Gaps, TR/2026/006, SATR/2026/003, Command Center, Milestones, Finance, People Workspace, Add Credential, Start Journey — zero regressions
- Build: TypeScript exit 0 on every task

**ADRs created:**
- `ADR-003` — Journey Definition (accepted)

**Architecture risk documents:**
- `docs/architecture/SharePoint Integration Risk Assessment.md`

See: `docs/architecture/C3 Architecture Baseline — Sprint 14.md`

---

### Sprint 13 — Mission Finance: Financial Planning Spine ✅ COMPLETE

**Goal:** Answer one question: *Can a Mission carry a lightweight financial plan that shows expected income, expected expenses, actuals, and settlement state without becoming a full accounting system?*

**The finance approval loop closed in this sprint:**
> Operator selects FinancePending mission in Situation Room
> → Finance section shows grouped Income / Expense lines with planned amounts
> → Operator reviews the plan: "Net +﷼194,150 SAR"
> → Operator clicks "Approve & Confirm Mission"
> → Mission.Status: FinancePending → Confirmed
> → ADR-002 activates operational obligations for all participants
> → Approve bar disappears; gap list begins populating

**Delivered:**

**S13-1 — Foundation: types, service, mock data**
- `types/finance.ts` — `FinanceLineDirection`, `FinanceLineCategory` (13: 5 income + 8 expense), `MissionFinanceLine`, `MissionFinanceSummary`
- `types/mission.ts` — `IncomeCurrency?` renamed to `OperatingCurrency?` (single currency per mission)
- `utils/financeUtils.ts` — `computeMissionFinanceSummary(lines)` — pure, never stored
- `services/interfaces/IFinanceService.ts` — `listMissionFinanceLines(missionId)` (read-only v1)
- `services/mock/MockFinanceService.ts` — 11 lines for TR/2026/006 (USD, mixed actuals); 7 draft lines for SATR/2026/003 (SAR, FinancePending review case)
- `services/sharepoint/SharePointFinanceService.ts` — graceful stub

**S13-2 — Hook layer**
- `hooks/queryKeys.ts` — `finance.forMission(missionId)` added
- `hooks/useFinanceService.ts` — parallel factory (ADR-001)
- `hooks/useMissionFinanceLines.ts` — single-mission query; empty-string gate
- `hooks/useMissionFinanceSummary.ts` — composes from lines hook; shares `finance.forMission()` cache key — one fetch, two consumers
- `hooks/useApproveMission.ts` — calls existing `missionService.confirmMission`; invalidates `mission.all()` + `mission.byId()`; finance cache intentionally not invalidated

**S13-3 — Read-only Finance section in Situation Room**
- `components/shared/FinanceSection.tsx` — purely presentational; `FinanceLineRow` (chip, description, planned, actual, settled dot), `GroupHeader`, `FinanceSummaryStrip` (planned net · actual net · variance · settled N/N); variance gated on all actuals known
- `screens/SituationRoom.tsx` — `SELECTOR_STATUSES` expanded to include `FinancePending`; finance hooks added; `missionParticipantCount` fixed to use `ParticipantPersonIDs`; finance net pill in `MissionContextHeader`; `FinanceSection` rendered above `MilestoneSection`

**S13-4 — Approve & Confirm action**
- `screens/SituationRoom.tsx` — `useApproveMission` wired; `MissionContextHeader` gains `onApprove?` + `isApproving?`; approve bar rendered as second row inside header card for FinancePending missions only; parent controls visibility (component does not inspect `mission.Status`)

**v1 constraints honoured:**
- No line creation, editing, deletion, or templates from UI
- No actuals entry from UI
- No settlement marking from UI
- No receipts, multi-currency, or VAT
- No Finance WorkItems (Finance milestone category covers planning; dedicated FinanceAlert WorkItems deferred)

**Validated (visual review):**
- TR/2026/006 (Confirmed, USD): Finance section shows 11 lines with mixed actuals; PER-0001 flights red (over budget); finance pill shows "Net +$38,500"; no approve bar
- SATR/2026/003 (FinancePending, SAR): Finance section shows 7 draft lines; approve bar visible; "Net +﷼194,150" pill; gap list empty (ADR-002 not yet active)
- Approve action: status → Confirmed; approve bar disappears; badge updates; operational obligations activate
- All Gaps, Milestones, Command Center, Person Profile, Add Credential, Start Journey: zero regressions

**Build:** TypeScript 0 errors. Lint: 0 errors.

See: `docs/architecture/Mission Finance v1 — Design.md`
See: `docs/architecture/C3 Architecture Baseline — Sprint 13.md`

---

### Sprint 12 — Mission Milestones: Planning Spine ✅ COMPLETE

**Goal:** Answer one question: *Can a Mission carry a planning sequence that generates work before things become emergencies?*

**The planning loop closed in this sprint:**
> Mission milestone becomes Overdue or DueSoon
> → MilestoneAlert WorkItem appears in Command Center
> → Operator clicks "View Mission"
> → Situation Room opens with mission pre-selected, milestone section visible
> → Operator clicks "Mark"
> → Milestone is Complete, WorkItem disappears

**Delivered:**

**S12-1 — Foundation: types, service, mock data**
- `types/milestones.ts` — `MilestoneStatus` (Complete / Overdue / DueSoon / Upcoming / Blocked), `MilestoneCategory` (7), `MissionMilestone`, `MissionMilestoneView`
- `types/workItems.ts` — `WorkItemCategory` gains `'MilestoneAlert'`; `WorkItemTrigger` gains `MilestoneGap` variant
- `utils/milestoneUtils.ts` — `computeMilestoneStatus`, `computeMilestoneDaysUntilDue`, `computeMilestoneView` — all status computed, never stored
- `services/interfaces/IMilestoneService.ts` — `listMissionMilestones`, `listAllMilestones`, `completeMilestone`
- `services/mock/MockMilestoneService.ts` — 8 milestones seeded for TR/2026/006: 2 Complete, 1 Overdue, 2 DueSoon, 3 Upcoming
- `services/sharepoint/SharePointMilestoneService.ts` — graceful stub

**S12-2 — Hook layer**
- `hooks/useMilestoneService.ts` — parallel factory
- `hooks/queryKeys.ts` — `milestone.all()` and `milestone.forMission(missionId)` added
- `hooks/useMissionMilestones.ts` — single-mission query, `computeMilestoneView` at fetch time, empty-string gate
- `hooks/useAllMilestones.ts` — batch fetch for work queue composition
- `hooks/useMarkMilestoneComplete.ts` — mutation `{ milestoneId, missionId }`; invalidates both cache keys on success

**S12-3 — Work queue integration**
- `utils/workItemPriority.ts` — `MilestoneAlert` priority rules: overdue + departure ≤7d → Immediate; overdue → High (unconditional); due ≤3d + departure ≤14d → High; else → Normal
- `utils/workItemGenerators.ts` — `generateMilestoneWorkItems` added; `generateWorkItems` signature extended to `(gaps, missions, milestones = [])` — backward-compatible
- `hooks/useWorkItems.ts` — composes `useAllMilestones`; passes milestones to generator

**S12-4 — Situation Room milestone section**
- `components/shared/MilestoneSection.tsx` — planning milestone list with status dot, name/owner, category chip, date display, "Mark" button for Overdue/DueSoon; self-owns mutation; returns null when no milestones
- `screens/SituationRoom.tsx` — `useMissionMilestones` added; `MissionContextHeader` gains milestone summary pill; `MilestoneSection` rendered between context header and gap list

**Build:** TypeScript 0 errors. Lint: 0 errors.

See: `docs/architecture/C3 Architecture Baseline — Sprint 12.md`

---

### Sprint 11 — Command Center: Operational Work Queue ✅ COMPLETE

**Goal:** Replace the Command Center's contract KPI dashboard with a shared operational work queue that answers: *"What work does the Operations function need to move today?"*

**The core distinction locked in this sprint:**
> OperationalGap = evidence (describes state).
> WorkItem = intent (describes work).

**Delivered:** `types/workItems.ts` (WorkItem type system, 5 categories, 3 priorities, deterministic ID strategy), `utils/workItemPriority.ts`, `utils/workItemGenerators.ts` (full generation pipeline: mission pressure index, per-person partitioning, MDP items, sort), `hooks/useWorkItems.ts`, `WorkItemCard`, full Command Center rewrite with three priority bands, `situation-room` screen variant extended with `missionId?`, `initialMissionId?` prop on SituationRoom.

**Build:** TypeScript 0 errors. Lint: 0 errors, 3 warnings (pre-existing Fast Refresh — TD-014).

See: `docs/architecture/C3 Architecture Baseline — Sprint 11.md`

---

### Sprint 10 — Mission v1: Operational Context ✅ COMPLETE

**Goal:** Mission becomes a first-class operational context.

**Delivered:** Mission domain (7-state lifecycle, MissionSpan, MissionParticipant, ADR-002), horizon-aware urgency, `useMissionGaps`, Situation Room mission scope (ScopeSelector, MissionContextHeader, scoped gap view), Journey → Mission linkage.

**Build:** TypeScript 0 errors. Lint: 0 errors.

See: `docs/architecture/C3 Architecture Baseline — Sprint 10.md`

---

### Sprint 9 — Operational Gap Ownership ✅ COMPLETE

**Delivered:** `OwnershipState = 'Unrouted' | 'Routed' | 'Covered'`, `ObligationAssignment`, two-level ownership, `OwnershipBadge`, gap click-through, ownership filter tabs.

See: `docs/architecture/C3 Architecture Baseline — Sprint 9.md`

---

### Sprints 6–8 — Operational Model ✅ COMPLETE

**Sprint 8:** Situation Room, `UrgencyTier`, `OperationalGap`, `useOperationalGaps`.
**Sprint 7:** Credential Management (Add Only), `useAddCredential`, `AddCredentialPanel`.
**Sprint 6G:** Capability-based credential model, `CredentialCapability`.
**Sprint 6F:** Start Onboarding Journey end-to-end workflow.
**Sprint 6E:** Structural freeze — Journey generalization, Mission stub, ADR-001.
**Sprints 6A–6D:** Operational Model proof of concept.

---

### Sprint 5 and earlier — Foundation ✅ COMPLETE

UX Design System, Contract/Amendment/People screens, SPFx Host, Platform SDK, Monorepo, Build Pipeline.

---

## Sprint 14 Candidates

- **Mission Travel facet** — Flight booking records linked to Travel expense lines. Logistics milestones become structurally linked to travel records. `MissionTravelRecord` entity.
- **Finance WorkItems** — `FinanceAlert` WorkItem category: "Budget not approved N days before departure", "Variance exceeds threshold at settlement". Requires `generateFinanceWorkItems` in the work queue pipeline.
- **Finance actuals entry** — Inline actuals entry for finance lines in the Situation Room. Requires `IFinanceService.updateFinanceLine()` and `useUpdateFinanceLine` mutation.
- **Finance settlement marking** — Per-line and bulk settlement UI. Requires `IFinanceService.settleFinanceLine()` and `useSettleFinanceLine` mutation.
- **Milestone creation from UI** — Operators add milestones for a mission directly in the Situation Room. Template library per mission type.
- **Milestone dependency enforcement** — `DependsOn` surfaced in UI. Blocked milestones visually distinct.
- **WorkItem persistence (Stage 1)** — Lightweight `{ id, status, acknowledgedAt }` store. Match computed WorkItems to persisted state by deterministic ID.
- **SharePoint data layer** — Blocked pending IT access and SP list schema confirmation.

---

## Known Limitations

**Finance lines are read-only (Sprint 13)**
No line creation, actuals entry, or settlement marking from the UI. Finance data enters via mock service or future SharePoint writes.

**No Finance WorkItems (Sprint 13)**
`Finance` milestone category covers planning-level finance alerts (e.g., "Budget approved" milestone). Dedicated FinanceAlert WorkItems (e.g., "Variance exceeds threshold") are deferred.

**MilestoneAlert WorkItems always Open (Sprint 12)**
WorkItems are generated fresh from live milestone state. No snooze or dismiss.

**Milestone creation — operators cannot add milestones (Sprint 12)**
Milestones are seeded via mock only. No create/edit/delete from the UI.

**WorkItem status is always Open (Sprint 11)**
`InProgress` and `Resolved` are modelled but not activated. Persistence path is ready (deterministic IDs).

**Journey, Credential, Mission, Finance persistence — in-memory mock only**
All mutations are in-memory. Workflows are fully validated end-to-end but reset on page refresh.

**Amendment persistence — deferred**
`flowService.createAmendment` is a stub. Deferred until the Power Automate flow URL is available.

**Jurisdiction-aware evaluation — deferred**
`Mission.Jurisdiction` is stored. Protocol evaluation does not yet discriminate by destination.

**SharePoint data layer — blocked**
SP stubs in place across all domains. Integration blocked pending IT access and SP list schema confirmation.

---

## Strategic North Star

> C3 should become the intake system. Documents become supporting evidence.
> Not: C3 reads the PIF. But: C3 replaces the PIF.

The three architectural principles:
1. **The Person is permanent. Journeys are temporary.**
2. **C3 is a collection of workspaces, not screens.**
3. **Every entity should be able to answer "Are we ready?"**

The locked ownership principle (Sprint 6E):
> Protocols define default ownership for obligation types.
> Journeys record actual accountability through AssignedTo.
> The Situation Room converts suggested ownership into actual ownership through routing.

The Mission principle (Sprint 10):
> Mission is not an event. Mission is Geekay's commitment to participate in one.
> Mission is the shared operational context from which Obligations, Finance, Logistics, and Content derive meaning.

The WorkItem principle (Sprint 11):
> OperationalGap = evidence. WorkItem = intent.
> The Command Center translates operational truth into operational work.
> It is not a dashboard. It is the operator's inbox.

The Milestone principle (Sprint 12):
> Milestones are planning checkpoints, not task managers.
> A milestone marks that something has been arranged or confirmed — not the process of arranging it.
> Mission planning state should generate work before things become emergencies.

The Finance principle (Sprint 13):
> Mission Finance is not accounting. It is the conversation between financial intent and operational outcome.
> The question C3 answers: "Does this mission make financial sense at the planning stage, and did it perform as expected at settlement?"
> The question C3 does not answer: "What was the exact per-diem receipt for Day 3?"
> The FinancePending → Confirmed gate means the financial plan is reviewed before operational obligations activate.

---

## Documentation

- `docs/adr/ADR-001-service-access-pattern.md`
- `docs/adr/ADR-002-mission-activation-gate.md`
- `docs/architecture/C3 Architecture Baseline — Sprint 9.md`
- `docs/architecture/C3 Architecture Baseline — Sprint 10.md`
- `docs/architecture/C3 Architecture Baseline — Sprint 11.md`
- `docs/architecture/C3 Architecture Baseline — Sprint 12.md`
- `docs/architecture/C3 Architecture Baseline — Sprint 13.md`
- `docs/architecture/WorkItem Model — Sprint 11 Design.md`
- `docs/architecture/Mission v2 — Operational Planning.md`
- `docs/architecture/Mission Finance v1 — Design.md`
- `docs/architecture/Mission Model — Architectural Analysis.md`
- `docs/architecture/Mission Discovery Checklist.md`
- `docs/releases/Sprint 10 Proposal.md`
- `docs/releases/Sprint 11 Proposal.md`
- `docs/releases/Sprint 12 Proposal.md`
- `docs/releases/C3 v1.0 Technical Debt Register.md`
- `docs/releases/C3 Operator Pressure Test Plan.md`
- `docs/releases/C3 Operator Validation — Sprint 8 Observations.md`
- `docs/99. Engineering Journal.md`

---

## UX Status

### Complete
- Design System v1.0
- Command Center — Operational Work Queue (Sprint 11)
- Renewals Center, Contracts Workspace, Contract Profile
- Amendment Profile + Amendment Workspace
- People Workspace
- Person Profile (Credentials, Readiness, Journey, Add Credential, Resolve obligation)
- Intelligence, Inbox, Settings, Developer Diagnostics
- Situation Room (Sprint 8–9: urgency tiers, ownership model, gap click-through)
- Situation Room Mission scope (Sprint 10: scope selector, mission context header, scoped gap view)
- Situation Room Mission Milestones (Sprint 12: planning spine, Mark Complete)
- Situation Room Mission Finance (Sprint 13: financial plan, Approve & Confirm)

### Design Status
Design Language Frozen (C3 Design System v1.0)
