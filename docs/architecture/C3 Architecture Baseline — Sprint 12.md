# C3 Architecture Baseline — Sprint 12

**Sprint:** Mission Milestones: Planning Spine  
**Version:** v0.12.0-milestones  
**Date:** 2026-06-29  
**Status:** Frozen — approved at visual review

---

## What This Sprint Established

Sprint 12 adds the first planning facet to Mission v2: milestones. The core question: *Can a Mission carry a planning sequence that generates work before things become emergencies?*

The answer is yes. The planning loop is now closed end-to-end.

---

## The Two Operational Layers

Sprint 12 makes the separation between the compliance layer and the planning layer explicit in the architecture:

| Layer | Question | Source of truth | Generates |
|---|---|---|---|
| Compliance | Does the participant hold the required credentials? | `OperationalGap` (computed from credentials + obligations) | CredentialRenewal, CredentialAcquisition, JourneyInitiation, ObligationRouting WorkItems |
| Planning | Has the necessary preparation been done? | `MissionMilestone` (stored records) | MilestoneAlert WorkItems |

These layers are independent. A player can have all required credentials but still have an overdue visa application milestone (the process of applying is tracked separately from the credential outcome). This separation prevents planning state from contaminating the compliance model.

---

## Milestone Data Model

### `MilestoneStatus` (computed, never stored)

```
Complete  — CompletedDate is set
Overdue   — PlannedDate has passed; CompletedDate null → generates High/Immediate WorkItem
DueSoon   — PlannedDate within 7 days; CompletedDate null → generates MilestoneAlert WorkItem
Upcoming  — PlannedDate more than 7 days out → no WorkItem
Blocked   — DependsOn milestone not Complete → no WorkItem (v1: modelled, not enforced)
```

### `MilestoneCategory`

```
Roster | Compliance | Logistics | Finance | Documents | Event | PostMission
```

### `MissionMilestone`

```typescript
{
  MilestoneID:    string;
  MissionID:      string;
  Name:           string;
  Description?:   string;
  Category:       MilestoneCategory;
  Owner?:         string;
  PlannedDate:    string;    // ISO date
  CompletedDate?: string;    // ISO date — null if not done
  DependsOn?:     string[];  // MilestoneIDs (v1: stored, not enforced)
  Notes?:         string;
  CreatedAt:      string;
}
```

### `MissionMilestoneView` (computed at fetch time)

```typescript
extends MissionMilestone {
  status:       MilestoneStatus;
  daysUntilDue: number | null;  // positive = remaining, negative = overdue, null = complete
}
```

Computed by `computeMilestoneView(milestone)` in `milestoneUtils.ts`. Never stored. Re-derived on every query.

---

## Deterministic WorkItem ID

```
MilestoneAlert: ml-{MilestoneID}
Example: ml-ml-006-003
```

Same condition → same ID. Persistence-ready.

---

## WorkItem Extension

### New `WorkItemCategory`

```
'MilestoneAlert'
```

### New `WorkItemTrigger` variant

```typescript
{
  type:               'MilestoneGap';
  missionId:          string;
  missionName:        string;
  milestoneId:        string;
  milestoneName:      string;
  daysUntilDue:       number;   // negative = overdue
  daysUntilDeparture: number;
}
```

### Priority rules for `MilestoneAlert` (first-match)

| Condition | Priority |
|---|---|
| `daysUntilDue < 0` AND `daysUntilDeparture ≤ 7` | **Immediate** |
| `daysUntilDue < 0` (any departure) | **High** — overdue is unconditionally High |
| `daysUntilDue ≤ 3` AND `daysUntilDeparture ≤ 14` | **High** |
| Otherwise | **Normal** |

The unconditional High for overdue milestones reflects a deliberate choice: a planning failure that has already occurred is High attention regardless of departure proximity, because the window to act without consequence is already shrinking.

---

## Service Architecture

### `IMilestoneService`

```typescript
listMissionMilestones(missionId: string): Promise<MissionMilestone[]>
listAllMilestones(): Promise<MissionMilestone[]>
completeMilestone(milestoneId: string): Promise<MissionMilestone>
```

Two read methods + one write. `completeMilestone` sets `CompletedDate` to today. Throws on not-found or already-complete.

### Factory pattern (ADR-001)

```
useMilestoneService() → IMilestoneService
  dataSourceMode === 'sharepoint' → createSharePointMilestoneService()  [graceful stub]
  else                            → createMockMilestoneService()         [8 seeded milestones]
```

---

## Hook Architecture

| Hook | Purpose | Cache key |
|---|---|---|
| `useMilestoneService` | Parallel factory | — |
| `useMissionMilestones(missionId)` | Single-mission views for Situation Room | `milestone.forMission(missionId)` |
| `useAllMilestones` | Batch fetch for work queue generation | `milestone.all()` |
| `useMarkMilestoneComplete` | Mutation: `{ milestoneId, missionId }` | invalidates both keys on success |

### Cache coherence

```
useMarkMilestoneComplete.onSuccess
  → invalidate milestone.all()         // useWorkItems recomputes; WorkItem disappears
  → invalidate milestone.forMission()  // useMissionMilestones refetches; row shows Complete
```

### `useWorkItems` (extended)

```typescript
generateWorkItems(gaps, missions, milestones = [])
// milestones default-empty → backward-compatible
```

Data flow:
```
useOperationalGaps()  → OperationalGap[]
useMissions()         → Mission[]
useAllMilestones()    → MissionMilestone[]
      ↓
generateWorkItems(gaps, missions, milestones)
      ↓
WorkItem[]  (sorted: Immediate → High → Normal)
```

`isLoading` gates on all three sources.

---

## Generation Pipeline (updated)

```
Step 1: Build mission pressure index
Step 2: Group gaps by person
Step 3: Per-person items (JI, OR, CA, CR)
Step 4: MissionDeparturePressure items
Step 5: MilestoneAlert items  ← new Sprint 12
Step 6: Sort
```

`generateMilestoneWorkItems(missions, allMilestones)`:
- Indexes milestones by MissionID
- Filters to ADR-002-eligible missions
- For each eligible mission: emits one WorkItem per Overdue or DueSoon milestone

---

## UI Architecture

### `MilestoneSection` component

Rendered in Situation Room mission scope, between `MissionContextHeader` and the gap list.

```
Self-contained component:
  Props: { milestones: MissionMilestoneView[], missionId: string }
  Owns: useMarkMilestoneComplete, markingId state
  Returns: null when milestones.length === 0
```

Row anatomy:
```
[status dot]  [name + owner?]  [category chip]  [date display]  [Mark? button]
```

Status dot colours:
- Complete → green filled
- Overdue → red filled
- DueSoon → amber filled
- Upcoming / Blocked → hollow gray

Date display:
- Complete → "14 May" (formatted)
- Overdue → "Nd ago" (red, bold)
- DueSoon → "In Nd" or "Today" (amber, bold)
- Upcoming → "In Nd" (gray)

### `MissionContextHeader` (extended)

New `milestoneSummary?: { total, overdue, dueSoon }` prop drives a milestone pill in the metadata strip:

```
[Confirmed]  [Jul 8 – Aug 16]  [|]  [2 participants]  [|]  [8 milestones · 1 overdue]
```

Pill colour: red if overdue > 0, amber if dueSoon > 0, gray otherwise.

### `SituationRoom` (extended)

New data flows in mission mode:
```
useMissionMilestones(selectedMissionId ?? '')
  → milestones: MissionMilestoneView[]
  → isLoading: milestonesLoading (added to gate)

milestoneSummary = computed from milestones
  → passed to MissionContextHeader

MilestoneSection rendered between header and gap list (mission mode only)
```

---

## Mock Data — TR/2026/006

Eight milestones seeded, ordered by PlannedDate:

| # | Name | Category | PlannedDate | Status |
|---|---|---|---|---|
| 1 | Roster confirmed | Roster | 2026-05-15 | **Complete** |
| 2 | Tournament registration submitted | Compliance | 2026-05-20 | **Complete** |
| 3 | Visa applications submitted | Compliance | 2026-06-09 | **Overdue** |
| 4 | Flights booked | Logistics | 2026-07-01 | **DueSoon** |
| 5 | Pre-departure briefing | Event | 2026-07-05 | **DueSoon** |
| 6 | Accommodation confirmed | Logistics | 2026-07-07 | Upcoming |
| 7 | Equipment / peripherals shipped | Logistics | 2026-07-10 | Upcoming |
| 8 | Travel document pack ready | Documents | 2026-07-12 | Upcoming |

WorkItems generated: #3 → High (overdue), #4 → High (due ≤3d + departure ≤14d), #5 → Normal (due 6d, no immediate departure pressure).

---

## Frozen Decisions

1. **Milestone status is computed, never stored.** `PlannedDate` + `CompletedDate` → `MilestoneStatus`. No status field in the schema.

2. **The only write operation in v1 is `completeMilestone`.** No create, edit, delete, or template operations exposed to operators.

3. **`Blocked` is modelled but not enforced.** `DependsOn` is stored on `MissionMilestone`. `computeMilestoneStatus` never returns `Blocked` (no dependency context at the utils layer). WorkItem generation skips Blocked milestones.

4. **`DueSoon` threshold = 7 days.** `MILESTONE_DUE_SOON_THRESHOLD_DAYS = 7` in `milestoneUtils.ts`. May become configurable per category in a future sprint.

5. **Overdue milestones are unconditionally High.** Departure proximity can elevate to Immediate (≤7d) but cannot reduce below High. A planning failure that has already occurred warrants persistent High attention.

6. **`generateWorkItems` default-empty milestones.** `milestones: MissionMilestone[] = []` maintains backward compatibility with any callers that pre-date Sprint 12.

7. **MilestoneSection returns null when milestones are empty.** No render overhead in All Gaps mode or for missions with no seeded milestones.

8. **Planning layer and compliance layer are independent.** A milestone tracks whether a process step was completed. An OperationalGap tracks whether a credential obligation is satisfied. These are different questions and must not be conflated.

---

## What Remains Open

- **Milestone creation from UI** — operators cannot add milestones in v1. Template library (per mission type) and free-form creation both deferred.
- **Milestone editing and deletion** — no write surface beyond Mark Complete.
- **Dependency enforcement** — `DependsOn` is stored; Blocked status can be computed with full milestone list; UI display and WorkItem skip logic for Blocked deferred.
- **PostMission milestones** — expense claims, prize payout, debrief. Not seeded in Sprint 12 (mock data is pre-departure).
- **Category-specific DueSoon thresholds** — Compliance milestones may warrant a longer warning window (14d) vs Logistics (7d). Deferred.
- **Milestone history / audit trail** — no record of who marked complete or when (beyond CompletedDate).
- **SharePoint Milestones list schema** — `SharePointMilestoneService` is a graceful stub. Blocked on list design and IT provisioning.
