# WorkItem Model — Sprint 11 Design

**Status:** Design — pre-implementation  
**Version:** v0.1  
**Date:** 2026-06-29  
**Purpose:** Define the WorkItem concept and Command Center operational queue before Sprint 11 implementation begins. This document is the design input for Sprint 11 — nothing is built until this is approved.

---

## The Core Distinction

C3 already models operational truth well. Sprint 11 is not about adding more truth. It is about translating truth into work.

**OperationalGap** — evidence that something is wrong.  
A person's Travel Authorization expires before a mission departs. The Situation Room surfaces this fact. It is a description of state.

**WorkItem** — intent to act on that evidence.  
*Renew Abdulaziz's France visa before RLCS departure. Owner: Operations. Due: 4 Jul. Blocking: RLCS World Championship.*  
That is a piece of work. It is what an operator would write on a Post-it note. It has a subject, an action, an owner, and a deadline.

One OperationalGap can trigger one or more WorkItems. One WorkItem may aggregate several OperationalGaps for the same person. They are related but structurally distinct.

---

## What Command Center Becomes

The Command Center stops being a contract KPI dashboard. It becomes the shared operational work queue for the Operations function.

**The question it answers:** *What work does the Operations function need to move today?*

Not: what is the current credential state of the roster.  
Not: what are Ihab's tasks.  
Not: a dashboard of metrics.

A work queue — shared, operational, routed by ownership, sorted by impact.

**Why shared, not personal:**  
Personal queues require a mature identity and role model: reliable user-role mapping, team scopes, delegation rules, absence handling. C3 does not have that yet. Building personal queues now would create false precision — items routed to names without the authority model to make that routing real. The first Command Center surfaces ownership as metadata on each work item (Assigned to, Suggested owner, Unrouted) without filtering to a single user's view. Personal filtering is a future capability once users, roles, and scopes are real.

---

## The WorkItem Model

### Fields

```
WorkItem:
  id              string    — deterministic, derived from trigger (see ID Strategy below)
  category        WorkItemCategory
  title           string    — synthesized from template + named entities
  detail          string?   — secondary context line
  owner           string?   — routing chain output (see Routing below)
  ownerSource     OwnerSource
  priority        WorkItemPriority
  dueDate         string?   — ISO date of earliest binding deadline
  blockingMission string?   — missionName if this blocks an upcoming mission
  status          WorkItemStatus
  trigger         WorkItemTrigger
  links           WorkItemLinks
```

### WorkItemCategory

```typescript
type WorkItemCategory =
  | 'CredentialRenewal'       // Expiring credential needs renewal
  | 'CredentialAcquisition'   // Missing credential needs to be obtained
  | 'JourneyInitiation'       // No journey exists; one needs to be started
  | 'ObligationRouting'       // Journey exists but obligation unassigned (Routed, not Covered)
  | 'MissionDeparturePressure'; // Mission departing with open gaps — aggregated alert
```

Future categories (not Sprint 11): `ContractRenewal`, `VisaInterview`, `RosterSubmission`, `FinanceApproval`.

### WorkItemPriority

```typescript
type WorkItemPriority = 'Immediate' | 'High' | 'Normal';
```

This is separate from `UrgencyTier`. UrgencyTier is intrinsic to a credential gap. WorkItemPriority is contextual — it accounts for mission departure pressure, ownership state, and time-to-impact together.

Priority is computed, never set manually in v1.

### WorkItemStatus

```typescript
type WorkItemStatus = 'Open' | 'InProgress' | 'Resolved';
```

In Sprint 11, all computed WorkItems are `Open`. The distinction between statuses is modelled now to preserve the persistence path. When WorkItems become persisted:
- `InProgress`: operator has acknowledged and begun the work
- `Resolved`: the underlying condition is satisfied (credential added, journey started, obligation assigned)

**Key design decision:** WorkItem status is independent of OperationalGap resolution. An operator can mark a WorkItem InProgress while the gap is still present. The gap resolves when the credential appears. These events happen at different times and mean different things.

### WorkItemTrigger

```typescript
type WorkItemTrigger =
  | { type: 'OperationalGap'; personId: string; obligationId: string; gapUrgency: UrgencyTier }
  | { type: 'MissionDeparture'; missionId: string; openGapCount: number; daysUntilDeparture: number };
```

The trigger records what generated the WorkItem. This is the traceability link between intent and evidence. Future persistence uses the trigger to detect when a WorkItem should auto-resolve (its triggering condition is no longer true).

### WorkItemLinks

```typescript
interface WorkItemLinks {
  personId?:   string;   // Navigate to PersonProfile
  missionId?:  string;   // Navigate to Situation Room mission scope
  journeyId?:  string;   // Navigate to Journey (future Journey detail screen)
}
```

Links determine what happens when an operator clicks a WorkItem. The primary action navigates to the right context to resolve the work.

### OwnerSource

```typescript
type OwnerSource =
  | 'ObligationAssignment'  // Explicit — from Journey.obligationAssignments
  | 'JourneyOwner'          // Derived — from Journey.AssignedTo
  | 'ProtocolDefault'       // Suggested — from obligation.defaultOwner
  | 'Unrouted';             // No ownership determined
```

`OwnerSource` distinguishes explicit ownership from suggested ownership. An item with `OwnerSource: 'ProtocolDefault'` is different from one with `OwnerSource: 'ObligationAssignment'` — even if both show the same owner string. The former is a suggestion; the latter is a commitment.

---

## WorkItem ID Strategy

WorkItem IDs are deterministic. The same underlying condition always produces the same ID. This is the foundation of the persistence path.

```
CredentialRenewal:        `cr-${personId}-${obligationType}`
CredentialAcquisition:    `ca-${personId}-${obligationType}`
JourneyInitiation:        `ji-${personId}`
ObligationRouting:        `or-${personId}-${obligationType}`
MissionDeparturePressure: `mdp-${missionId}`
```

When WorkItems are persisted, the ID is the lookup key: "has this WorkItem been acknowledged? Snoozed? Resolved?" A computed WorkItem with the same ID as a persisted one inherits the persisted state.

This means Sprint 11's computed WorkItems are already addressable as if they were persisted — the infrastructure is in place, the data store is not yet.

---

## WorkItem Categories — Generation Logic

### CredentialRenewal

**Trigger condition:** An obligation is AtRisk (credential exists but expires within evaluation window). The expiry date is approaching.

**Generated when:** `obligation.status === 'AtRisk'`

**Title template:** `Renew {person}'s {capabilityLabel} credential`  
**Detail template:** `Expires {expiryDate} · {daysToExpiry}d remaining`  
**Blocking:** mission name if credential expires before mission EndDate

**Priority:**
- `Immediate` if credential expires before an upcoming mission's EndDate
- `High` if ≤ 30 days to expiry
- `Normal` if 31–90 days to expiry

**One WorkItem per person per obligation type.** If a person has two AtRisk obligations, two CredentialRenewal items are generated.

**Primary action:** Navigate to PersonProfile → Readiness tab → Resolve

---

### CredentialAcquisition

**Trigger condition:** An obligation is Unsatisfied (no credential of the required capability exists).

**Generated when:** `obligation.status === 'Unsatisfied'`

**Title template:** `Obtain {requirement} for {person}`  
**Detail template:** `{blockingReason}`  
**Blocking:** mission name if this gap blocks an upcoming mission

**Priority:**
- `Immediate` if this person is a participant in a mission departing ≤ 14 days
- `High` if urgencyTier is Critical (no journey)
- `Normal` if urgencyTier is High (journey in progress)

**Primary action:** Navigate to PersonProfile → Readiness tab

---

### JourneyInitiation

**Trigger condition:** A person has at least one Unrouted OperationalGap (no active Journey exists).

**Generated when:** `ownershipState === 'Unrouted'` for any gap for this person

**Deduplication:** One JourneyInitiation WorkItem per person, regardless of how many unrouted gaps they have. All unrouted gaps are resolved by initiating one journey.

**Title template:** `Start readiness Journey for {person}`  
**Detail template:** `{N} unrouted gap{s} · {person.PrimaryRole}`

**Priority:**
- `Immediate` if any of their gaps are Critical
- `High` if any are High
- `Normal` otherwise

**Primary action:** Navigate to PersonProfile → Readiness tab (opens StartJourneyPanel)

---

### ObligationRouting

**Trigger condition:** A Journey is Active and a gap is Routed (journey exists, but no explicit obligation assignment for this obligation type).

**Generated when:** `ownershipState === 'Routed'` — journey covers the person but the obligation is unassigned.

**Title template:** `Assign ownership of {requirement} for {person}`  
**Detail template:** `Journey active · obligation unassigned · Suggested: {defaultOwner}`

**Priority:** `Normal` in most cases; `High` if journey has been open > 14 days with no assignment.

**Primary action:** Navigate to PersonProfile → Readiness tab

**Note:** ObligationRouting items represent friction in the routing process. They are the gap between "someone is working on this person" and "someone specifically owns this requirement." They should surface clearly but are not emergency items.

---

### MissionDeparturePressure

**Trigger condition:** A Mission with `Status ∈ MISSION_OBLIGATION_ACTIVE_STATUSES` has open operational gaps for its participants AND its `Span.StartDate` is within 30 days.

**Generated when:** `mission has open gaps AND daysUntilDeparture ≤ 30`

**This is a synthetic WorkItem.** It does not correspond to a single person or obligation. It summarizes the risk created by a mission's time pressure.

**Deduplication:** One MissionDeparturePressure WorkItem per Mission.

**Title template:** `{mission name} departs in {N} days with open gaps`  
**Detail template:** `{criticalCount} critical · {highCount} high · {participantCount} participants affected`

**Priority:**
- `Immediate` if daysUntilDeparture ≤ 7
- `High` if daysUntilDeparture ≤ 14
- `Normal` if daysUntilDeparture ≤ 30

**Primary action:** Navigate to Situation Room → Mission scope for this mission

**Note:** MissionDeparturePressure is the only cross-person WorkItem. All others are person-scoped. This item exists because the mission is the context that makes individual gaps time-critical — an operator needs to see the mission deadline as a unit of work, not just individual credential gaps.

---

## Routing Logic

Owner resolution follows a strict precedence chain:

```
1. obligationAssignment.assignedTo   → OwnerSource: 'ObligationAssignment'
2. journey.AssignedTo                → OwnerSource: 'JourneyOwner'
3. obligation.defaultOwner           → OwnerSource: 'ProtocolDefault'
4. null                              → OwnerSource: 'Unrouted'
```

For JourneyInitiation (no journey exists), routing is:
```
1. obligation.defaultOwner           → OwnerSource: 'ProtocolDefault'
2. null                              → OwnerSource: 'Unrouted'
```

For MissionDeparturePressure (cross-person):
```
Owner: null, OwnerSource: 'Unrouted'
(Mission-level routing belongs to a future authority model)
```

---

## Priority Computation

Priority is a composite of three signals:

| Signal | Weight |
|---|---|
| UrgencyTier (Critical / High / Medium) | Base |
| Mission departure pressure (days until mission with open gaps) | Amplifier — can elevate any tier to Immediate |
| Ownership state (Unrouted > Routed > Covered) | Tiebreaker |

**Priority rules (in order):**

1. **Immediate** — any of:
   - UrgencyTier is Critical AND ownershipState is Unrouted
   - Mission departing ≤ 7 days with open gaps for this person
   - Credential expires before an upcoming mission's EndDate

2. **High** — any of:
   - UrgencyTier is Critical AND ownershipState is Routed or Covered
   - UrgencyTier is High AND ownershipState is Unrouted
   - Mission departing 8–14 days with open gaps for this person

3. **Normal** — everything else

---

## Command Center Layout Concept

```
┌─────────────────────────────────────────────────────────────┐
│  Operations Work Queue                                      │
│  {N} items requiring attention  [Filter chips]              │
├─────────────────────────────────────────────────────────────┤
│  IMMEDIATE  {N} items                                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ● Renew Abdulaziz's Travel credential                │   │
│  │   Expires 4 Jul · Blocking: RLCS World Championship  │   │
│  │   Suggested: PRO Coordinator          [Open Profile] │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ● RLCS 2026 departs in 6 days with 3 open gaps       │   │
│  │   2 critical · 1 high · 2 participants affected      │   │
│  │   Unrouted                          [Open Mission]   │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  HIGH  {N} items                                            │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ ○ Start readiness Journey for Mohammad Al-Rashid     │   │
│  │   2 unrouted gaps · Player                           │   │
│  │   Suggested: Operations             [Open Profile]   │   │
│  └──────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  NORMAL  {N} items                                          │
│  ...                                                        │
└─────────────────────────────────────────────────────────────┘
```

**Filter chips:** All · Unrouted · By mission · By owner

**WorkItem card anatomy:**
- Priority dot (filled = Immediate, outlined = High, empty = Normal)
- Title (synthesized)
- Detail line (secondary context)
- Owner badge: `Assigned to {name}` / `Suggested: {name}` / `Unrouted`
- Action button: navigates to the right screen to resolve the work

**No "Mark as done" button in Sprint 11.** WorkItems resolve automatically when the underlying condition resolves. Manual status is a persistence feature.

---

## What the WorkItem Model Is Not

**Not a task manager.** There are no due dates manually set, no task assignment flows, no recurring tasks, no subtasks, no task completion workflow. All of that belongs to a future sprint with a data layer.

**Not a notification system.** WorkItems are not pushed to users. They are computed on demand when the Command Center loads. Push delivery is a SharePoint integration concern.

**Not a replacement for the Situation Room.** The Situation Room remains the source of operational truth. The Command Center translates that truth into work. Operators who want to understand *why* a WorkItem exists navigate to the Situation Room. Operators who want to know *what to do* start in the Command Center.

**Not personal.** All operators with access to C3 see the same work queue. Ownership metadata (Assigned to, Suggested, Unrouted) is visible on each item, but the queue itself is not filtered to a single user's scope.

---

## The Persistence Path

The WorkItem model is designed for persistence even though Sprint 11 computes everything. The path:

**Sprint 11 (computed):** WorkItems derived from `useOperationalGaps` and `useMissions` on every render. All items are `Open`. IDs are deterministic. No storage.

**Sprint N (acknowledged state):** A lightweight persistence layer stores `{ workItemId, status, acknowledgedBy, acknowledgedAt }`. Computed WorkItems are matched against stored state by ID. Acknowledged items show InProgress. Resolved items are suppressed (their underlying condition is gone, so they no longer compute).

**Sprint N+1 (full persistence):** WorkItems are created by events (credential added, mission confirmed, journey started). They have full lifecycle, history, comments, reassignment. The Command Center becomes a real inbox.

Each step is additive. The model defined here supports all three.

---

## Open Questions Before Sprint 11 Implementation

1. **Does CommandCenter replace the existing screen or live alongside it?**  
   The current Command Center shows contract KPIs. Do those disappear immediately, or does the work queue coexist with the contract metrics during transition?

2. **Does `useWorkItems` compose from `useOperationalGaps` + `useMissions`, or does it re-fetch independently?**  
   Composing from existing hooks is simpler and uses the shared cache. Re-fetching independently is more modular but duplicates data. Recommendation: compose.

3. **MissionDeparturePressure threshold — 30 days, 14 days, or configurable?**  
   The 30-day window for "upcoming mission" is assumed. Should be confirmed against how Geekay actually plans mission preparation.

4. **Are ObligationRouting items useful in v1, or do they create noise?**  
   Routed gaps are operationally better than Unrouted gaps — someone is working on the person. Surfacing ObligationRouting items as work may feel premature when the journey is actively progressing. Consider whether ObligationRouting items should only appear after a journey has been open for N days without an assignment.

5. **What happens to existing Command Center content?**  
   Contract KPI metrics and renewal stats were the original content. These have a home (Renewals Center, Contract Profile). Is the transition clean-cut or gradual?

---

*This document is the design input for Sprint 11. No implementation begins until these decisions are confirmed.*
