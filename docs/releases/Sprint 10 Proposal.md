# Sprint 10 Proposal — Mission v1: Operational Context

**Status:** Proposed  
**Date:** 2026-06-28  
**Preceding sprint:** Sprint 9 — Operational Gap Ownership (complete)  
**Activation gate decision:** ADR-002 — status-gated filter, accepted

---

## The Operational Question

Sprint 10 answers a question that Sprint 9 made possible to ask:

> **"Is this roster ready to travel?"**

Before Sprint 9, the platform could say: "Mohammad has a credential gap." After Sprint 9, it can say: "Mohammad has a credential gap and no one owns solving it." After Sprint 10, it will be able to say: "Mohammad has a credential gap that will block the RLCS WC roster by August 16, and no one owns solving it."

Mission is not an upgrade to how the platform computes gaps. It is the addition of *why* a gap matters and *when* it becomes critical.

---

## Success Criterion

An operator opens the Situation Room, selects RLCS WC 2026 from the Mission selector, and sees only the credential gaps for the two Mission participants — urgency ranked by proximity to the Mission's end date (August 16, 2026) rather than a rolling 30/90-day window. The second Mission (FinancePending) does not appear because it has not been confirmed.

---

## Scope

### Included

- Mission type, status lifecycle, and entity model (fully specified, replacing Sprint 6E stub)
- `MissionParticipant` type with role and per diem rate
- `IMissionService` interface + `MockMissionService` with 2 seed missions
- Mission-relative urgency computation
- `useMissionGaps(missionId)` hook with ADR-002 activation gate
- Situation Room Mission selector (above the filter bar)
- Mission-scoped view: participants only, mission-relative urgency, Mission context header
- `OperationalGap` extended with `missionId?` and `missionName?`
- `Journey.MissionID?` + `InitiateJourneyInput.MissionID?` (additive; surfaces when journey started from a Mission-scoped gap)
- `StartJourneyPanel` Mission context line when `missionId` is provided

### Explicitly excluded

- Budget, P/L, or settlement UI
- Logistics (flights, accommodation, per diem) — types only, no UI
- Mission Room screen (dedicated full-screen Mission view)
- Jurisdiction-aware credential discrimination (Schengen vs. UAE visa)
- Mission creation / editing UI — Missions come from mock data only
- SharePoint implementation for Mission service
- Multi-Mission simultaneous gap deduplication (each Mission-scoped view is independent)
- Per diem rate surfaced in any UI

---

## The Mission Model (as specified for Sprint 10)

### MissionStatus (replaces the Sprint 6E stub)

```typescript
export type MissionStatus =
  | 'Planning'        // Speculative — no financial commitment
  | 'FinancePending'  // Awaiting Finance approval
  | 'Confirmed'       // Approved and committed — obligations activate here
  | 'Active'          // Mission is in progress
  | 'PostMission'     // Event complete — financial closure pending
  | 'Settled'         // Fully closed
  | 'Canceled';       // Withdrawn before Active
```

### Mission (supersedes Sprint 6E stub)

```typescript
export interface Mission {
  MissionID:     string;          // TR/2026/006 format
  Name:          string;          // "RLCS 2026 - World Championship & EWC"
  Game:          string;          // "Rocket League"
  Organizer:     string;          // "Psyonix / EWC"
  Entity:        'UAE' | 'KSA' | 'Multi';
  Status:        MissionStatus;
  Jurisdiction:  string;          // "Paris, France"
  Span: {
    StartDate:      string;       // ISO date — credential validity horizon
    EndDate:        string;       // ISO date — operational end (urgency deadline)
    SettlementDate: string;       // ISO date — financial closure
  };
  ParticipantPersonIDs: string[]; // C3 PersonID list
  CreatedAt:     string;
  CreatedBy:     string;
  ConfirmedAt?:  string;          // set when status transitions to Confirmed
  ConfirmedBy?:  string;
  Notes?:        string;
}
```

### MissionParticipant

```typescript
export type MissionParticipantRole =
  | 'Player' | 'Coach' | 'Manager' | 'Analyst' | 'Staff';

export interface MissionParticipant {
  MissionID:    string;
  PersonID:     string;
  ExternalCode: string;          // e.g. "RL/PL/026"
  Role:         MissionParticipantRole;
  PerDiemRate?: number;          // daily rate in IncomeCurrency
}
```

---

## Seed Data

Two mock missions demonstrate both sides of the activation gate:

**Mission 1 — Confirmed (generates gaps)**

```
MissionID:    TR/2026/006
Name:         RLCS 2026 - World Championship & EWC
Game:         Rocket League
Organizer:    Psyonix / EWC
Entity:       UAE
Status:       Confirmed
Jurisdiction: Paris, France
Span:
  StartDate:      2026-07-08
  EndDate:        2026-08-16
  SettlementDate: 2026-12-30
Participants:
  PER-0001 (Abdulaziz) — RL/PL/026 — Player — 35 USD/day
  PER-0002 (Mohammad)  — RL/CH/004 — Coach  — 25 USD/day
ConfirmedAt:  2026-06-15T10:00:00Z
```

PER-0001 has a Travel credential expiring before 2026-08-16 → AtRisk → High urgency.  
PER-0002 has no Travel credential at all → Unsatisfied → Critical urgency.  
Both are Covered/Routed (from Sprint 9 journey data).

**Mission 2 — FinancePending (does not generate gaps)**

```
MissionID:    SATR/2026/003
Name:         Saudi eLeague 2026 - Season 2
Game:         FIFA
Entity:       KSA
Status:       FinancePending
Jurisdiction: Riyadh, Saudi Arabia
Span:
  StartDate:      2026-09-01
  EndDate:        2026-09-30
  SettlementDate: 2026-11-30
Participants: PER-0004
```

This Mission is excluded by ADR-002. It will not appear in any gap computation.

---

## Deliverables

### M10-1 — Mission Foundation

**Files:**
- `types/mission.ts` — fully specified Mission type (supersedes Sprint 6E stub)
- `services/interfaces/IMissionService.ts`
- `services/mock/MockMissionService.ts`
- `hooks/useMissions.ts`
- `hooks/useMissionParticipants.ts`
- `hooks/queryKeys.ts` — extended with `mission.*` keys

**IMissionService interface:**
```typescript
interface IMissionService {
  listMissions(filter?: { status?: MissionStatus[] }): Promise<Mission[]>;
  getMission(missionId: string): Promise<Mission | null>;
  listMissionParticipants(missionId: string): Promise<MissionParticipant[]>;
  confirmMission(missionId: string): Promise<Mission>;
}
```

**MockMissionService:** seed the two missions above. `confirmMission` transitions `FinancePending → Confirmed` for demo/test purposes.

**Query keys:**
```typescript
mission: {
  all: ()                          => ['missions']
  byId: (id: string)               => ['missions', id]
  participants: (id: string)       => ['missions', id, 'participants']
  active: ()                       => ['missions', 'active']
}
```

**ADR-001 compliance:** `useMissionService()` hook reads `config.dataSourceMode` and returns `MockMissionService` or (stub) `SharePointMissionService`.

---

### M10-2 — Mission-Aware Urgency

**File:** `utils/urgency.ts`

`computeUrgency` extended with an optional `horizonDate` parameter:

```typescript
export const computeUrgency = (
  obligation: Obligation,
  journeyId: string | undefined,
  horizonDate?: string,   // NEW — Mission.Span.EndDate when evaluating in Mission context
): UrgencyTier => { ... }
```

**When `horizonDate` is provided:**
- `Unsatisfied` → `Critical` always (no credential exists; the gap will block the Mission)
- `AtRisk` → credential's `expiryDate` is compared against `horizonDate`:
  - If `expiryDate < horizonDate` → `Critical` (credential lapses before Mission ends)
  - If `expiryDate >= horizonDate` → `Satisfied` in Mission context (credential covers the full span)

Wait — if a credential covers through the Mission end date, the obligation is actually Satisfied in Mission context, not AtRisk. But that satisfaction logic lives in the protocol, not in urgency. The protocol's span-aware evaluation already handles this via `ProtocolContext.span`. So `computeUrgency` only sees obligations that the protocol has already determined are not Satisfied.

The correct `horizonDate` logic for urgency is:
- Obligation is `Unsatisfied` (no credential) → Critical always when in Mission context
- Obligation is `AtRisk` (credential expires): standard `daysUntilExpiry` computed from `expiryDate`; but also check: does the credential expire before `horizonDate`? If yes → Critical (will not cover Mission). If no → falls back to rolling window (High / Medium).

This gives operators the right signal: a credential expiring 45 days from now is normally Medium, but if the Mission ends in 40 days, it is Critical for that Mission.

**Existing rolling-window behavior is unchanged when `horizonDate` is absent.**

---

### M10-3 — Mission-Scoped Gap Computation

**File:** `hooks/useMissionGaps.ts`

```typescript
export const useMissionGaps = (
  missionId: string,
): { gaps: OperationalGap[]; mission: Mission | null; isLoading: boolean }
```

**Algorithm:**
1. Fetch `Mission` by ID. If status not in `{ Confirmed, Active, PostMission }`, return `{ gaps: [], mission, isLoading: false }`.
2. Fetch `MissionParticipants` for the Mission.
3. Fetch credentials for each participant (via batch `listAllCredentials` scoped to participant PersonIDs).
4. Fetch active Journeys for each participant.
5. For each participant, evaluate against `evaluateOnboardingObligations` with `ProtocolContext.span = { from: mission.Span.StartDate, to: mission.Span.EndDate }`.
6. For each non-Satisfied obligation, compute `computeUrgency(obligation, journeyId, mission.Span.EndDate)`.
7. Compute ownership state (identical to `useOperationalGaps`).
8. Attach `missionId` and `missionName` to each `OperationalGap`.
9. Sort: urgency tier → daysToExpiry ascending.

**`OperationalGap` extended fields:**
```typescript
missionId?:   string;   // only set on Mission-scoped gaps
missionName?: string;
```

This is additive. Existing `useOperationalGaps` continues unchanged and does not set these fields.

---

### M10-4 — Situation Room Mission Scope

**File:** `screens/SituationRoom.tsx`

The Situation Room gains a Mission selector that switches the data source between the general gap view and a Mission-scoped view.

**Mission selector (above the filter bar):**
- Fetches all Confirmed/Active Missions via `useMissions({ status: ['Confirmed', 'Active', 'PostMission'] })`
- Renders as a horizontal pill row: "All Gaps" + one pill per Mission (name only, truncated)
- Active pill is highlighted with brand color
- If no Confirmed Missions exist: selector is not rendered (zero-state)

**All Gaps view (default — no Mission selected):**
- Identical to current Sprint 9 behavior
- `useOperationalGaps()` is the data source

**Mission-scoped view (Mission selected):**
- `useMissionGaps(missionId)` is the data source
- Mission context header between selector and filter bar:
  - Mission name (semibold)
  - Jurisdiction · span dates (e.g. "Paris, France · 8 Jul – 16 Aug 2026")
  - Participant count
- Filter bar (Unrouted / Routed / Covered) still works
- Summary strip still shows Critical / High / Medium counts
- Gap rows are identical to All Gaps view (no Mission badge needed — context is established by the header)

**State management:** `selectedMissionId: string | null` in Situation Room local state. No routing change — Mission selection is transient view state.

---

### M10-5 — Journey Mission Linkage

**Files:** `types/journeys.ts`, `services/mock/MockJourneyService.ts`, `components/shared/StartJourneyPanel.tsx`, `layout/AppShell.tsx`

**Types (additive):**
```typescript
Journey.MissionID?: string
InitiateJourneyInput.MissionID?: string
```

**MockJourneyService:** `initiateJourney` stores `MissionID` when provided. JRN-0001 seed updated: `MissionID: 'TR/2026/006'` (it was initiated for RLCS WC).

**StartJourneyPanel:**
```typescript
interface StartJourneyPanelProps {
  // ... existing props ...
  missionId?: string;    // NEW — when provided, shows mission context line
  missionName?: string;  // NEW
}
```
When `missionId` is set, the panel renders a context line beneath the header: `"For mission: RLCS 2026 - World Championship & EWC"`. This makes the journey initiation legible — the operator knows which commitment they are creating the journey for.

**AppShell:** When navigating to PersonProfile from a Mission-scoped gap row, the `onNavigate` callback passes `missionId` and `missionName`. StartJourneyPanel receives them.

This requires a small extension to the `navigate` call — PersonProfile will need `missionId` in the `person-profile` screen type (additive, optional).

---

## Phase Plan

**Phase 1 — Foundation**
- M10-1: Mission types + service + mock + hooks

**Phase 2 — Computation**
- M10-2: Mission-aware urgency
- M10-3: `useMissionGaps` hook

**Phase 3 — UI**
- M10-4: Situation Room Mission selector + scoped view

**Phase 4 — Linkage**
- M10-5: Journey Mission linkage

Build and lint after each phase before proceeding.

---

## Architecture Notes

### What changes in the existing codebase

| File | Change |
|---|---|
| `types/mission.ts` | Full rewrite — supersedes Sprint 6E stub |
| `types/situation.ts` | `OperationalGap` extended with `missionId?`, `missionName?` |
| `types/journeys.ts` | `Journey.MissionID?` + `InitiateJourneyInput.MissionID?` |
| `types/screens.ts` | `person-profile` screen type gets `missionId?`, `missionName?` |
| `utils/urgency.ts` | `computeUrgency` extended with `horizonDate?` parameter |
| `hooks/queryKeys.ts` | `mission.*` keys added |
| `services/mock/MockJourneyService.ts` | JRN-0001 seed gets `MissionID`; `initiateJourney` stores it |
| `components/shared/StartJourneyPanel.tsx` | `missionId?` + `missionName?` props |
| `screens/SituationRoom.tsx` | Mission selector + scoped view |
| `layout/AppShell.tsx` | Passes `missionId` when navigating from Mission-scoped gap |

### What does not change

- `useOperationalGaps` — unchanged; all existing behavior preserved
- `ReadinessPanel` — unchanged
- `OperationalGapRow` — unchanged (missionId on the gap is not rendered in the row; context is established by the Mission header in SituationRoom)
- `PersonProfile` — unchanged
- All protocols — unchanged; span is passed via ProtocolContext, which the protocol already accepts

### The activation gate (ADR-002)

```typescript
// In useMissionGaps
const OBLIGATION_ACTIVE_STATUSES: MissionStatus[] = ['Confirmed', 'Active', 'PostMission'];
if (!OBLIGATION_ACTIVE_STATUSES.includes(mission.Status)) {
  return { gaps: [], mission, isLoading: false };
}
```

This is the single point of enforcement. It lives in the hook. Components receive an empty array; they do not know or care why the Mission produced no gaps.

---

## Open Questions (to resolve before or during Sprint 10)

1. **Does the Mission selector show PostMission missions?** They generate gaps but the event is over. Probably yes — an operator still needs to route outstanding gaps after an event. But "PostMission" should be visually distinguished from "Confirmed/Active" in the selector.

2. **Does the SituationRoom All Gaps view include Mission-scoped participants?** Currently yes — PER-0001 and PER-0002 appear in All Gaps regardless of mission context (their obligations are computed via the general Onboarding protocol). In a Mission-aware world, this is correct: general readiness gaps and Mission-specific gaps can overlap. We should verify this creates no duplicate entries or urgency confusion in the mock dataset before implementing.

3. **What mission context (if any) is shown on gap rows in the All Gaps view?** If a person is a Mission participant, should their general gaps carry a Mission badge? Deferred — the All Gaps view remains as-is in Sprint 10; Mission context is only surfaced when in a Mission-scoped view.

4. **Mission confirmation authority.** `confirmMission()` exists in the mock for testing. In production, who has authority? Finance lead? Operations manager? Deferred to Sprint 11 or the SharePoint data layer sprint.

---

## What Sprint 10 Does Not Resolve

- The Mission Discovery Checklist (23 items). Sprint 10 is a partial implementation. The checklist was written for full Mission implementation including Finance, Logistics, and Jurisdiction. Not all 23 items will be closed by Sprint 10.
- Jurisdiction-aware evaluation. Paris requires Schengen credentials. The platform will evaluate with the existing OnboardingProtocol (Identity, RightToWork, Travel capabilities) — it will not yet discriminate between a UAE visa and a French visa.
- Multiple simultaneous Missions for one participant. The architecture handles it correctly (each Mission-scoped view is independent), but the mock dataset has no overlap to test it.

---

*C3 Platform · Sprint 10 Proposal — Mission v1: Operational Context · 2026-06-28*
