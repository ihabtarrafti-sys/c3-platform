# Sprint 11 Proposal — Command Center: Operational Work Queue

**Status:** Proposed — awaiting approval  
**Version:** v0.11.0-work-queue  
**Date:** 2026-06-29  
**Prerequisite reading:** `docs/architecture/WorkItem Model — Sprint 11 Design.md`

---

## The Question This Sprint Answers

*What work does the Operations function need to move today?*

Not: what is the current credential state of the roster.  
Not: what are the open gaps across the organisation.  
The Command Center already failed at being a contract dashboard. Sprint 11 gives it a purpose it can earn permanently.

---

## Success Criterion

An Operations Manager can open C3, read the Command Center, and within 30 seconds identify the most urgent piece of work they need to act on — including what it is, why it matters now, and where to go to resolve it. Without navigating to the Situation Room first.

---

## Scope

**In:**
- `WorkItem` type system
- `useWorkItems` hook composing from existing cached data
- Priority computation function
- `CommandCenter` screen rewrite — shared operational work queue
- `WorkItemCard` shared component
- Navigation from each WorkItem to the correct resolution context

**Out:**
- Persistence. All WorkItems are computed. Status is always `Open`.
- Manual status changes. No "Mark as done," no snooze, no dismiss.
- Personal inbox. The queue is shared and operational.
- Notification system. No push, no email, no badges.
- New protocols. WorkItems are generated from the existing Onboarding protocol and Mission data only.
- `ObligationRouting` item priority escalation beyond `Normal` (MissionDeparturePressure handles mission-linked urgency).

**Explicit constraints (carry-forward from Sprint 10):**
- No Finance UI
- No Logistics UI
- No settlement workflow
- Preserve existing Situation Room, Person Profile, and Mission scope behaviour exactly

---

## The Screen Hierarchy After Sprint 11

| Screen | Question it answers |
|---|---|
| **Command Center** | What work does Operations need to move today? |
| **Situation Room** | What is operationally true right now? |
| **Person Profile** | Why is this person in this state? |
| **Mission (Situation Room scope)** | What operational commitment created this work? |
| **Journey (Person Profile)** | How are we resolving it? |

---

## Implementation — Four Phases

### Phase S11-1: WorkItem Type System

**Deliverable:** `packages/c3/src/types/workItems.ts`

The complete type system for the WorkItem model. No computation, no UI — types only. This is the contract that all subsequent phases implement against.

```typescript
// All types defined here:

export type WorkItemCategory =
  | 'CredentialRenewal'
  | 'CredentialAcquisition'
  | 'JourneyInitiation'
  | 'ObligationRouting'
  | 'MissionDeparturePressure';

export type WorkItemPriority = 'Immediate' | 'High' | 'Normal';

// Modelled for persistence path. Sprint 11: all computed items are Open.
export type WorkItemStatus = 'Open' | 'InProgress' | 'Resolved';

export type OwnerSource =
  | 'ObligationAssignment'   // Explicit — journey.obligationAssignments
  | 'JourneyOwner'           // Derived — journey.AssignedTo
  | 'ProtocolDefault'        // Suggested — obligation.defaultOwner
  | 'Unrouted';              // No ownership determined

export type WorkItemTrigger =
  | { type: 'OperationalGap'; personId: string; obligationId: string; gapUrgency: UrgencyTier }
  | { type: 'MissionDeparture'; missionId: string; openGapCount: number; daysUntilDeparture: number };

export interface WorkItemLinks {
  personId?:  string;   // Navigate to PersonProfile
  missionId?: string;   // Navigate to Situation Room mission scope
}

export interface WorkItem {
  /** Deterministic ID derived from trigger. Same condition → same ID. Persistence-path ready. */
  id:              string;
  category:        WorkItemCategory;
  title:           string;
  detail?:         string;
  owner?:          string;
  ownerSource:     OwnerSource;
  priority:        WorkItemPriority;
  dueDate?:        string;    // ISO date of earliest binding deadline
  blockingMission?: string;   // Mission name if this work blocks a departure
  status:          WorkItemStatus;
  trigger:         WorkItemTrigger;
  links:           WorkItemLinks;
}
```

Also exports `WorkItem` from `types/index.ts`.

**Build and lint after. Pause for review.**

---

### Phase S11-2: Generation Engine + Priority

**Deliverables:**
- `packages/c3/src/utils/workItemGenerators.ts` — pure generation functions
- `packages/c3/src/utils/workItemPriority.ts` — priority computation

This phase contains the intelligence of the work queue. Pure functions — no React, no hooks, no side effects. Testable in isolation from the UI.

#### Generation logic (`workItemGenerators.ts`)

Entry point:

```typescript
export const generateWorkItems = (
  gaps: OperationalGap[],
  missions: Mission[],
): WorkItem[]
```

**Step 1 — Build mission pressure index.**  
Filter to ADR-002-eligible missions (`MISSION_OBLIGATION_ACTIVE_STATUSES`) within the 30-day departure window. Build:
- `personMissions: Map<personId, Mission[]>` — which upcoming missions does each person participate in?
- `missionGapCounts: Map<missionId, { critical: number; high: number; participants: Set<string> }>` — gap summary per mission for MissionDeparturePressure items

**Step 2 — Group gaps by person.**  
Gaps are already per-person from `useOperationalGaps`. Group by `gap.personId`.

**Step 3 — Generate per-person items.**  
For each person's gaps, generate one or more WorkItems:

*JourneyInitiation* — if any gaps are Unrouted (`ownershipState === 'Unrouted'`):
- One WorkItem per person (not per gap)
- ID: `ji-${personId}`
- Title: `Start readiness Journey for {personName}`
- Detail: `{N} unrouted gap{s} · {personRole}`
- Owner: `defaultOwner` from the most-urgent unrouted gap → OwnerSource: `ProtocolDefault`
- Deduplication: if all unrouted gaps share a `defaultOwner`, use it; otherwise `Unrouted`

*CredentialAcquisition* — for each Unsatisfied obligation that is not Unrouted (journey exists):
- One WorkItem per person per capability type
- ID: `ca-${personId}-${obligationType}`
- Title: `Obtain {requirement} for {personName}`
- Detail: gap's `blockingReason`
- Owner: resolved from ownership chain
- `blockingMission`: nearest upcoming mission name if this person is a participant

*CredentialRenewal* — for each AtRisk obligation:
- One WorkItem per person per capability type
- ID: `cr-${personId}-${obligationType}`
- Title: `Renew {personName}'s {capabilityLabel} credential`
- Detail: `Expires {formattedDueDate} · {daysToExpiry}d remaining`
- Owner: resolved from ownership chain
- `blockingMission`: mission name if credential expires before mission EndDate

*ObligationRouting* — for each Routed obligation (journey exists, no obligation assignment):
- One WorkItem per person per capability type
- ID: `or-${personId}-${obligationType}`
- Title: `Assign ownership of {requirement} for {personName}`
- Detail: `Journey active · obligation unassigned`
- Owner: `defaultOwner` → OwnerSource: `ProtocolDefault`

**Step 4 — Generate MissionDeparturePressure items.**  
For each upcoming mission with open gaps:
- One WorkItem per mission
- ID: `mdp-${missionId}`
- Title: `{missionName} departs in {N} days with open gaps`
- Detail: `{criticalCount} critical · {highCount} high · {participantCount} participants affected`
- Owner: `null`, OwnerSource: `Unrouted`
- `dueDate`: `mission.Span.StartDate`

**Ownership resolution chain** (applied consistently across all categories):
```
1. gap.assignedTo + ownershipState === 'Covered'  → OwnerSource: ObligationAssignment
2. gap.assignedTo + ownershipState === 'Routed'   → OwnerSource: JourneyOwner
3. gap.defaultOwner                               → OwnerSource: ProtocolDefault
4. null                                           → OwnerSource: Unrouted
```

#### Priority computation (`workItemPriority.ts`)

```typescript
export const computeWorkItemPriority = (
  item: Omit<WorkItem, 'priority'>,
  missionPressure: MissionPressureMap,  // personId → daysUntilDeparture
): WorkItemPriority
```

Rules (first match wins):

**Immediate:**
- `MissionDeparturePressure` with `daysUntilDeparture ≤ 7`
- `CredentialRenewal` or `CredentialAcquisition` where `blockingMission` is set AND mission departs ≤ 7 days
- `JourneyInitiation` where person participates in a mission departing ≤ 7 days
- `CredentialAcquisition` with `gapUrgency === 'Critical'` AND `ownerSource === 'Unrouted'`

**High:**
- `MissionDeparturePressure` with `daysUntilDeparture ≤ 14`
- `CredentialRenewal` or `CredentialAcquisition` with `blockingMission` set AND mission departs 8–14 days
- `JourneyInitiation` where person participates in a mission departing 8–14 days
- `CredentialAcquisition` with `gapUrgency === 'Critical'`
- `CredentialRenewal` with `daysToExpiry ≤ 30`
- `JourneyInitiation` with any underlying Critical gap

**Normal:**
- Everything else, including all `ObligationRouting` items

**Sort order within each priority band:**
1. `MissionDeparturePressure` items first (they are cross-person context setters)
2. Items with `blockingMission` set before items without
3. `daysToExpiry` ascending (most imminent first), nulls last

**Build and lint after. Pause for review.**

---

### Phase S11-3: useWorkItems Hook

**Deliverable:** `packages/c3/src/hooks/useWorkItems.ts`

Thin composition hook. Wires `useOperationalGaps` + `useMissions` into `generateWorkItems` + `computeWorkItemPriority`. Returns sorted WorkItem[].

```typescript
export const useWorkItems = (): {
  items: WorkItem[];
  counts: { immediate: number; high: number; normal: number; total: number };
  isLoading: boolean;
}
```

**Design decisions:**
- Composes from existing hooks — no new fetches. `useOperationalGaps` and `useMissions` are already called elsewhere in the Situation Room; cache is shared.
- `useMemo` on `[gaps, missions]` — recomputes only when underlying data changes.
- `counts` derived from items — no separate computation; single pass.
- Returns items sorted: Immediate first, then High, then Normal; within band: MissionDeparturePressure first, then by daysToExpiry ascending.

**Build and lint after. Pause for review.**

---

### Phase S11-4: Command Center Rewrite

**Deliverables:**
- `packages/c3/src/components/shared/WorkItemCard.tsx` — shared component (domain-aware)
- `packages/c3/src/screens/CommandCenter.tsx` — full rewrite

#### WorkItemCard (`components/shared/WorkItemCard.tsx`)

Single card for one WorkItem. Three-row layout:

```
[priority dot]  Title                              [action button]
                detail line
                [owner badge]  [blocking mission chip?]  [due date?]
```

Priority dot: filled circle (Immediate), outlined circle (High), empty dot (Normal).

Owner badge: color-coded by OwnerSource:
- `ObligationAssignment` → green (explicit, committed)
- `JourneyOwner` → amber (derived, journey in progress)
- `ProtocolDefault` → gray (suggested by protocol)
- `Unrouted` → red dot (needs routing)

Blocking mission chip: displayed when `blockingMission` is set — brand-colored tag with mission name.

Due date chip: displayed when `dueDate` is set — formatted as `Due {N}d` or `Due {date}`.

Action button text by category:
- `CredentialRenewal` → "Open Profile"
- `CredentialAcquisition` → "Open Profile"
- `JourneyInitiation` → "Start Journey"
- `ObligationRouting` → "Assign Owner"
- `MissionDeparturePressure` → "View Mission"

Action button click: calls `onAction(workItem)`, which is handled by the parent screen via navigation.

Props: `workItem: WorkItem`, `onAction: (item: WorkItem) => void`.

#### CommandCenter screen rewrite

**Header:**
```
Operations Work Queue
{total} items requiring attention  ·  {immediate} immediate
```

**Priority bands (Immediate → High → Normal):**
- Each band has a label with item count
- Items listed as `WorkItemCard` rows
- Empty bands are suppressed entirely
- Immediate band uses a slightly accented background strip to draw the eye

**Empty state:**
- Variant: "success" or "empty"  
- Title: "All clear"  
- Description: "No operational work items requiring attention. All gaps are either satisfied or covered."

**Loading state:**  
Skeleton blocks matching the approximate layout depth.

**Navigation wiring:**
`WorkItemCard.onAction` is handled in CommandCenter:
```typescript
const handleWorkItemAction = (item: WorkItem) => {
  if (item.links.missionId) {
    // Navigate to Situation Room — but Situation Room doesn't yet accept a
    // pre-selected mission via navigation. For Sprint 11: navigate to Situation Room.
    // Pre-selection is a Phase 5 enhancement if approved.
    navigate({ id: 'situation-room' });
  } else if (item.links.personId) {
    navigate({ id: 'person-profile', personId: item.links.personId, tab: 'readiness' });
  }
};
```

**Existing Command Center content:** removed entirely. The contract KPI strip and renewal stats are replaced. Both concepts have correct homes elsewhere.

**Build and lint after. Pause for Phase 4 visual review.**

---

## Architecture Impact

| Layer | Change |
|---|---|
| Types | New: `types/workItems.ts` |
| Utils | New: `utils/workItemGenerators.ts`, `utils/workItemPriority.ts` |
| Hooks | New: `hooks/useWorkItems.ts` (composes from existing hooks) |
| Shared components | New: `components/shared/WorkItemCard.tsx` |
| Screens | Rewrite: `screens/CommandCenter.tsx` |
| Existing hooks/types | No changes |
| Situation Room | No changes |
| Person Profile | No changes |
| Mission scope | No changes |

The WorkItem model sits above all existing models. It aggregates from them but does not change them.

---

## Open Technical Question: JourneyInitiation Action

`JourneyInitiation` items link to `PersonProfile → Readiness tab`. The `StartJourneyPanel` opens from that screen when the operator clicks "Start Onboarding Journey." The WorkItemCard action button says "Start Journey" — but the panel opens from PersonProfile, not from the Command Center.

This is correct behaviour for Sprint 11. The card navigates to PersonProfile; the operator opens the panel there. A future enhancement could open the panel directly from the card (similar to how the Situation Room click-through works), but that is not in scope.

---

## Persistence Path (deferred — documented for continuity)

WorkItem IDs are deterministic. The same operational condition always produces the same ID. When a WorkItem store is introduced:

1. A lightweight persistence layer stores `{ id, status, acknowledgedAt, acknowledgedBy }`.
2. On load, computed WorkItems are matched to persisted state by ID.
3. Persisted `InProgress` or `Resolved` state overrides the computed `Open`.
4. When the underlying condition resolves (credential added, journey started), the computed WorkItem disappears. If it was persisted, the persisted record is archived.

Sprint 11 does not implement any of this. But the ID strategy ensures Sprint 11's output is persistence-ready without modification.

---

## Success Validation

Before Phase 4 is marked complete:

- Command Center loads and shows WorkItems from mock data
- MissionDeparturePressure item appears for TR/2026/006 (Confirmed, Paris, 2 participants with gaps)
- SATR/2026/003 (FinancePending) does NOT generate a MissionDeparturePressure item
- Clicking a credential-related WorkItem navigates to PersonProfile → Readiness tab
- Clicking the Mission WorkItem navigates to Situation Room
- Priority bands Immediate / High / Normal are correct for mock data
- All Gaps mode in Situation Room is unaffected
- Person Profile is unaffected
- Build: 0 errors. Lint: 0 errors.

