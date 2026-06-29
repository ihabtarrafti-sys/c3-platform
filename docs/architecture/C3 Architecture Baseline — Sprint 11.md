# C3 Architecture Baseline — Sprint 11

**Status:** Frozen  
**Version:** v0.11.0-work-queue  
**Date:** 2026-06-29  
**Extends:** C3 Architecture Baseline — Sprint 10

This document records what is frozen after Sprint 11. It does not repeat Sprint 10 decisions unless they were extended. Read Sprint 10 baseline first.

---

## Sprint 11 Scope

Sprint 11 introduced the WorkItem model and replaced the Command Center with a shared operational work queue. No new entities were introduced. The sprint's contribution is an orchestration layer that sits above all existing models.

---

## The Evidence / Intent Distinction

The most important architectural decision of Sprint 11:

**`OperationalGap` = evidence.** Describes what is operationally true. The output of protocol evaluation against a person's credential set.

**`WorkItem` = intent.** Describes what an operator needs to do about it. Generated from OperationalGap (and future triggers) by a pure computation layer.

WorkItem does not replace OperationalGap. They answer different questions:

| Type | Question answered |
|---|---|
| `OperationalGap` | Is this person ready? Why not? Who is notionally responsible? |
| `WorkItem` | What specific action should an operator take right now? |

OperationalGap remains the source of truth for the Situation Room. WorkItem is the output of the Command Center layer. The Situation Room and Command Center are complementary, not competitive.

---

## WorkItem Type System

### WorkItemCategory (5 variants)

| Category | Scoping | Action implied |
|---|---|---|
| `CredentialRenewal` | Per person, per capability | Renew an expiring credential |
| `CredentialAcquisition` | Per person, per capability | Obtain a missing credential |
| `JourneyInitiation` | Per person | Start a readiness Journey (unrouted gaps) |
| `ObligationRouting` | Per person, per capability | Assign an obligation owner (routed but unassigned) |
| `MissionDeparturePressure` | Per mission | Review mission readiness in Situation Room |

`MissionDeparturePressure` is the only cross-person category. All others are person-scoped.

### WorkItemPriority

`Immediate | High | Normal` — distinct from `UrgencyTier (Critical | High | Medium)`.

UrgencyTier describes the urgency of a single OperationalGap. WorkItemPriority incorporates mission departure proximity and ownership routing state as additional signals.

| Priority | Meaning |
|---|---|
| `Immediate` | Act today. Mission departs ≤ 7 days, or equivalent urgency. |
| `High` | Act this week. Critical gap, or mission departs ≤ 14 days. |
| `Normal` | Act when capacity allows. No immediate deadline or mission pressure. |

### WorkItemStatus

`Open | InProgress | Resolved` — all computed items are `Open` in Sprint 11. `InProgress` and `Resolved` are modelled for the persistence path. They will be activated when a lightweight WorkItem store is introduced (Sprint 12 candidate).

### OwnerSource

Four-level ownership resolution chain (applied in workItemGenerators.ts):

| OwnerSource | Confidence | Source |
|---|---|---|
| `ObligationAssignment` | Explicit — highest | `journey.obligationAssignments` |
| `JourneyOwner` | Derived | `journey.AssignedTo` |
| `ProtocolDefault` | Suggested | `obligation.defaultOwner` |
| `Unrouted` | None — highest urgency signal | No ownership determined |

`OwnerSource` drives badge colour in `WorkItemCard`: success green → warning amber → gray → critical red.

### Deterministic ID Strategy

Same operational condition → same WorkItem ID. Every time.

| Category | ID pattern | Example |
|---|---|---|
| `JourneyInitiation` | `ji-{personId}` | `ji-PER-0001` |
| `CredentialAcquisition` | `ca-{personId}-{capabilitySlug}` | `ca-PER-0001-right-to-work` |
| `CredentialRenewal` | `cr-{personId}-{capabilitySlug}` | `cr-PER-0002-travel` |
| `ObligationRouting` | `or-{personId}-{capabilitySlug}` | `or-PER-0003-identity` |
| `MissionDeparturePressure` | `mdp-{missionId}` | `mdp-TR/2026/006` |

`capabilitySlug` = `CredentialCapability` in kebab-case: `'RightToWork' → 'right-to-work'`.

**Why deterministic IDs matter:** When a persistence layer is introduced, computed WorkItems are matched to persisted state records by ID. No migration required. The persistence layer stores `{ id, status, acknowledgedAt }` alongside; the computation layer continues to generate items from live state; they are merged at read time.

---

## Generation Architecture

### Layer structure

```
useWorkItems (hook)
    ↓ composes
useOperationalGaps + useMissions
    ↓ feeds
generateWorkItems (pure function)
    ↓ calls
computeWorkItemPriority (pure function)
    ↓ produces
WorkItem[]
```

No new fetches introduced. `useWorkItems` reuses the same TanStack Query cache entries that the Situation Room populates. Cache keys: `queryKeys.credentials.all()`, `queryKeys.journey.allActive('Onboarding')`, `queryKeys.mission.filtered(undefined)`.

### Generation pipeline

1. **Mission pressure index** — Filter missions to ADR-002-eligible AND within departure window. Build `personMinDeparture: Map<personId, number>`. Active missions → days = 0. Confirmed missions → days until StartDate. PostMission → excluded.
2. **Group gaps by person** — Map from `useOperationalGaps`.
3. **Per-person item generation** — Partition by `ownershipState`: Unrouted → JourneyInitiation; Routed → ObligationRouting; Covered → CredentialAcquisition or CredentialRenewal.
4. **MissionDeparturePressure items** — One per upcoming mission with ≥ 1 participant gap.
5. **Sort** — Priority band → MDP first within band → blockingMission present → dueDate ascending.

### Deduplication rules

| Category | Deduplication key |
|---|---|
| JourneyInitiation | One per person (all unrouted gaps → one item) |
| ObligationRouting | One per person per `satisfiedByCapability` |
| CredentialAcquisition | One per person per `satisfiedByCapability` |
| CredentialRenewal | One per person per `satisfiedByCapability` |
| MissionDeparturePressure | One per mission |

When multiple gaps of the same capability type exist for a person, `pickMostUrgent()` selects the representative gap (sort by urgency tier, then daysToExpiry ascending).

### CredentialAcquisition vs CredentialRenewal discrimination

Discriminated by `OperationalGap.daysToExpiry`:
- `null` → no credential exists → `CredentialAcquisition`
- non-null → credential exists but expiring → `CredentialRenewal`

**Design note (Sprint 11):** This is correct for the current `OperationalGap` shape. When `OperationalGap` carries explicit `ObligationStatus`, the discrimination should migrate to that field rather than nullability inference.

### Mission departure window

`DEPARTURE_PRESSURE_WINDOW_DAYS = 30` — Confirmed missions beyond 30 days do not generate MissionDeparturePressure items. Active missions always generate items (departure window = the mission itself).

---

## Priority Computation Rules

Rules are first-match; evaluated top to bottom.

**MissionDeparturePressure:**
- `daysUntilDeparture ≤ 7` → `Immediate`
- `daysUntilDeparture 8–30` → `High` (all MDP items are within the window, so minimum is High)

**ObligationRouting:**
- `blockingMission` set AND `daysUntilBlockingMission ≤ 14` → `High` (capped; routing is an org step)
- Otherwise → `Normal`

**JourneyInitiation, CredentialAcquisition, CredentialRenewal with mission pressure:**
- `daysUntilBlockingMission ≤ 7` → `Immediate`
- `daysUntilBlockingMission ≤ 14` → `High`
- `daysUntilBlockingMission 15–30` → fall through to gap urgency

**Gap-urgency-driven (no mission escalation):**
- `CredentialAcquisition` / `CredentialRenewal` with `gapUrgency Critical | High` → `High`
- `JourneyInitiation` with `gapUrgency Critical` → `High`
- All else → `Normal`

---

## Command Center Screen Architecture

### Replaced content

The contract KPI dashboard (Total Contracts, Active Contracts, Renewal Radar, Lifecycle Snapshot, Needs Attention panel) is removed. Those concepts have correct homes in the Contracts and Renewals screens.

### New structure

```
Header
  "Operations Work Queue"
  "{N} items · {N} immediate" | "No items requiring attention"

Priority bands (Immediate → High → Normal)
  Band header: label + count + accent colour
  WorkItemCard list

Empty state (when counts.total === 0)
  variant="success"
  "All clear"

Footer (when counts.total > 0)
  "Open Situation Room" link
```

Empty bands are suppressed. A queue with only Normal items shows no Immediate or High section.

### WorkItemCard structure

```
[priority dot]  [title — semibold]              [action button]
                [detail — muted]
                [owner badge] [mission chip?] [due date chip?]
```

Priority dot: 8px filled circle, colour-coded (critical/warning/gray400).
Owner badge: colour-coded by OwnerSource confidence.
Mission chip: brand-accented (`var(--c3-brand-10)` / `var(--c3-brand-70)`).
Due date chip: red tint when ≤ 7 days remaining.

Action button labels by category:

| Category | Label |
|---|---|
| CredentialRenewal | Open Profile |
| CredentialAcquisition | Open Profile |
| JourneyInitiation | Start Journey |
| ObligationRouting | Assign Owner |
| MissionDeparturePressure | View Mission |

### Navigation from WorkItemCards

| Category | Destination |
|---|---|
| CredentialRenewal / CredentialAcquisition / JourneyInitiation / ObligationRouting | `person-profile` → Readiness tab |
| MissionDeparturePressure | `situation-room` with `missionId` pre-selected |

### Situation Room mission pre-selection

`C3Screen['situation-room']` extended with `missionId?: string`. `SituationRoom` accepts `initialMissionId?: string` prop and initialises `selectedMissionId` state from it. Existing navigation paths (nav rail, back button) pass no `missionId` — `selectedMissionId` initialises to `null` exactly as before. Zero regressions.

---

## Operational Screen Hierarchy

After Sprint 11, the platform's primary surfaces answer a complete question chain:

| Screen | Question |
|---|---|
| **Command Center** | What should I work on today? |
| **Situation Room** | What is operationally true right now? |
| **Person Profile** | Why is this person in this state? |
| **Journey** | How are we resolving it? |

Mission scope in the Situation Room provides the "which mission does this work relate to?" layer between Command Center and Person Profile.

---

## Files Introduced (Sprint 11)

| File | Role |
|---|---|
| `types/workItems.ts` | WorkItem type contract |
| `utils/workItemPriority.ts` | Pure priority computation |
| `utils/workItemGenerators.ts` | Pure WorkItem generation |
| `hooks/useWorkItems.ts` | Composition hook |
| `components/shared/WorkItemCard.tsx` | WorkItem card component |
| `screens/CommandCenter.tsx` | Rewritten (hard cut from KPI dashboard) |
| `docs/releases/Sprint 11 Proposal.md` | Sprint proposal |
| `docs/architecture/WorkItem Model — Sprint 11 Design.md` | Design document |

## Files Modified (Sprint 11)

| File | Change |
|---|---|
| `types/screens.ts` | `situation-room` gains `missionId?: string` |
| `types/index.ts` | `workItems` added to barrel export |
| `screens/SituationRoom.tsx` | `initialMissionId?` prop; state init from it |
| `components/layout/AppShell.tsx` | `initialMissionId={screen.missionId}` passed through |

---

## Persistence Path (deferred — documented for continuity)

Sprint 11 WorkItems are entirely computed. No persistence exists. The path when introduced:

**Stage 1 (Sprint 12 candidate):** Lightweight mock-layer store `{ id: string; status: WorkItemStatus; acknowledgedAt?: string }`. Computed WorkItems matched by deterministic ID. `InProgress` and `Resolved` status transitions from the Command Center.

**Stage 2:** SharePoint list stores WorkItem state records. Computation still lives in the frontend; SP stores only `{ id, status, timestamps }`.

**Stage 3:** When a computed WorkItem's underlying condition resolves (credential added, Journey started), the item disappears from the computed queue. Persisted `Resolved` records are archived. Persisted `Open` records without a matching computed item are orphaned and cleaned up.

The ID strategy ensures each stage is additive — no breaking changes to the generation engine or type system.

---

## Frozen Decisions (Sprint 11)

1. **OperationalGap = evidence. WorkItem = intent.** These are distinct concepts. WorkItem does not replace OperationalGap.
2. **Command Center is a shared operational queue, not a personal inbox.** No user identity, no personal routing, no acknowledgement per-person in Sprint 11.
3. **No persistence in Sprint 11.** All WorkItems are `Open`. Status transitions are modelled for future activation.
4. **Deterministic IDs are the persistence bridge.** Same condition → same ID, every time.
5. **MissionDeparturePressure is the only cross-person WorkItem category.** All others are person-scoped.
6. **ObligationRouting caps at High priority.** Routing is an organisational step; it should not compete with credential work for Immediate attention.
7. **Active missions have `daysUntilDeparture = 0`.** They are always within the departure window and always generate MissionDeparturePressure items if gaps exist.
8. **`daysToExpiry === null` discriminates CredentialAcquisition from CredentialRenewal.** This is correct for the current OperationalGap shape; migrate to explicit ObligationStatus when available.

---

## What Remains Open

- WorkItem persistence (Stage 1 — lightweight status store)
- Personal inbox layer (identity/role model prerequisite)
- Manual status transitions (InProgress, Resolved, Snooze)
- Additional WorkItem trigger types (ContractExpiry, RosterChange, ManualEntry)
- Mission Room (dedicated full-screen mission readiness surface)
- Jurisdiction-aware protocol evaluation
- SharePoint data layer (blocked pending IT access)
- Episodic Journey types (Visa Renewal, Contract Renewal, Team Transfer)
