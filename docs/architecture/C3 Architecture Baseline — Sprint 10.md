# C3 Architecture Baseline — Sprint 10

**Status:** Frozen  
**Version:** v0.10.0-mission-v1  
**Date:** 2026-06-29  
**Extends:** C3 Architecture Baseline — Sprint 9 (all content of that document remains valid and is not repeated here)  
**Purpose:** Record the architectural additions introduced by Mission v1. This document extends the Sprint 9 baseline — read that first. This document records what changed, what new invariants were established, and what remains open.

---

## What Changed in Sprint 10

Sprint 10 introduced Mission as a first-class operational context. Every addition was additive — no existing architectural decisions were revised or invalidated. The Sprint 9 baseline remains the correct foundation; this document is the Mission-layer extension to it.

---

## Mission: The Architectural Role

Mission is Geekay's commitment to participate in an operational event. It is not the event itself. It is the context from which Obligations, Journeys, Finance, Logistics, and Content derive meaning for a defined period and roster.

Mission occupies a specific position in the architecture: it is a context provider, not a consumer. Finance produces budget lines from Mission context. Logistics produces travel plans from Mission context. The Operational Gap engine evaluates credential readiness using Mission span and participants as context. Mission does not own those outputs — it activates them.

```
Mission provides context to:
  → Protocol evaluation (span, participants, jurisdiction)
  → Gap computation (horizon-aware urgency, scoped participant set)
  → Journey initiation (MissionID audit trail)
  → [Future] Finance (Sales Order reference via TR code)
  → [Future] Logistics (participant list, dates, jurisdiction)
  → [Future] Content (event metadata)

Mission does NOT own:
  → Budget lines
  → Flight bookings
  → Accommodation records
  → Content schedules
  → Settlement accounts
```

---

## The Extended Data Model

### Mission

```
Mission:
  MissionID          — TR code (e.g. "TR/2026/006", "SATR/2026/003")
                       Also the Finance Sales Order reference. No new ID namespace.
  Name               — Display name (e.g. "RLCS 2026 - World Championship & EWC")
  Game               — Game title (e.g. "Rocket League")
  Organizer          — Tournament organiser (e.g. "Psyonix / EWC")
  Entity             — MissionEntity: 'UAE' | 'KSA' | 'Multi'
  Status             — MissionStatus (7 states, see lifecycle below)
  Jurisdiction       — Where the Mission takes place (e.g. "Paris, France")
                       Stored for future jurisdiction-aware evaluation. Not yet used.
  Span:
    StartDate        — First operational day. Obligations begin here.
    EndDate          — Last operational day. Credentials must be valid through this date.
                       This is the urgency horizon date.
    SettlementDate   — Financial closure date. May be months after EndDate.
                       Financial metadata only — not used in operational gap computation.
  ParticipantPersonIDs — Canonical participant list. Obligations evaluated for these persons
                         when status satisfies ADR-002 gate.
  Notes?
```

**Key design decision — TR code as MissionID:**
The TR code system already exists across Finance and Logistics. Adopting it as the platform identifier preserves cross-system linkage without introducing a new ID namespace. `TR/2026/006` is simultaneously the C3 MissionID and the Finance Sales Order reference.

**Key design decision — three distinct dates on MissionSpan:**
`StartDate`, `EndDate`, and `SettlementDate` are explicitly separate fields. EndDate is operational closure. SettlementDate is financial closure. The gap between them (PostMission status) is architecturally significant: obligations are still evaluated after the event ends, until financial settlement. `SettlementDate` is carried on the type but not consumed by operational gap logic.

### MissionParticipant

```
MissionParticipant:
  MissionID          — Foreign key to Mission
  PersonID           — Foreign key to Person
  ExternalCode       — e.g. "RL/PL/026" — links to Finance/Logistics systems
  Role               — MissionParticipantRole: Player | Coach | Manager | Analyst | Staff
  PerDiemRate?       — Daily allowance rate. Finance metadata — not used in gap computation.
```

**ExternalCode** is the bridge to Finance and Logistics systems that reference participants by code rather than PersonID. The participant record carries the code; C3 uses PersonID for all internal operations.

### Mission extensions to Journey

```
Journey (Sprint 10 additions):
  MissionID?         — The Mission this Journey was initiated in context of.
                       Informational — preserves audit trail.
                       Does not restrict the Journey to that Mission.
                       Does not change how obligations are evaluated.
```

**Key design decision — MissionID on Journey is informational, not structural:**
A Journey is a general credential readiness workflow. Tagging it with a MissionID records why it was opened without changing what it does. Future Mission timeline views can filter journeys by MissionID. No evaluation logic changes.

---

## Mission Lifecycle

```
Planning → FinancePending → Confirmed → Active → PostMission → Settled
                                                              (financial closure)
Any state before Active → Canceled
```

**The activation gate (ADR-002 — locked):**

```
MISSION_OBLIGATION_ACTIVE_STATUSES = ['Confirmed', 'Active', 'PostMission']
```

Missions generate operational gaps only when `Status ∈ MISSION_OBLIGATION_ACTIVE_STATUSES`. The gate is enforced once, in `useMissionGaps`, before any evaluation logic runs. No other layer needs to check it.

| Status | Obligation Evaluation | Rationale |
|---|---|---|
| Planning | No | No financial commitment; roster may change entirely |
| FinancePending | No | Finance has not approved; commitment not confirmed |
| Confirmed | **Yes** | Finance-approved; this is the activation gate |
| Active | **Yes** | Mission in progress |
| PostMission | **Yes** | Event ended but not yet financially settled; obligations still live |
| Settled | No | Financial closure; Mission is archived |
| Canceled | No | Commitment withdrawn |

---

## Horizon-Aware Urgency

The key operational difference between general gap evaluation and Mission-scoped evaluation is the urgency horizon.

**General mode (useOperationalGaps):** urgency is computed against rolling 30/90-day windows. A credential expiring in 45 days is High urgency for anyone.

**Mission mode (useMissionGaps):** urgency is computed relative to `Mission.Span.EndDate`. The mission deadline is fixed — a credential must be valid on that date or the participant cannot fulfil their role.

```
computeUrgency(obligation, journeyId, horizonDate?):

  Without horizonDate (general mode):
    Unsatisfied + no journey → Critical
    Unsatisfied + journey → High
    AtRisk ≤ 30d → High
    AtRisk 31–90d → Medium

  With horizonDate (mission mode):
    Unsatisfied → always Critical
      (the mission will fail without this credential — severity is absolute)
    AtRisk, expires before horizonDate → Critical
      (credential will be invalid on the mission date)
    AtRisk, expires after horizonDate → AtRisk (original computation)
      (credential is valid for the mission; expiry is a post-mission concern)
```

This is an additive extension to `computeUrgency`. The `horizonDate` parameter is optional; omitting it preserves the existing behaviour exactly.

---

## New Service Layer: IMissionService

```typescript
interface IMissionService {
  listMissions(filter?: MissionFilter): Promise<Mission[]>;
  getMission(missionId: string): Promise<Mission | null>;
  listMissionParticipants(missionId: string): Promise<MissionParticipant[]>;
  confirmMission(missionId: string, confirmedBy: string): Promise<Mission>;
  updateMissionStatus(missionId: string, status: MissionStatus): Promise<Mission>;
}
```

Follows the parallel factory pattern established in ADR-001. `useMissionService` factory hook reads `config.dataSourceMode` and instantiates `MockMissionService` or `SharePointMissionService`. The SharePoint stub uses the `void param;` pattern.

**Valid mission status transitions (MockMissionService):**
```
Planning       → FinancePending | Canceled
FinancePending → Confirmed | Canceled
Confirmed      → Active | Canceled
Active         → PostMission | Canceled
PostMission    → Settled
Settled        → (terminal)
Canceled       → (terminal)
```

---

## New Hook: useMissionGaps

The mission-scoped counterpart to `useOperationalGaps`.

```
useMissionGaps(missionId: string):
  { gaps: OperationalGap[]; mission: Mission | null; isLoading: boolean }
```

**Invariants:**
- Empty string → all fetches suppressed → empty result. No conditional hook calls.
- ADR-002 gate enforced immediately: `if (!MISSION_OBLIGATION_ACTIVE_STATUSES.includes(mission.Status)) return []`
- Reuses `queryKeys.credentials.all()` and `queryKeys.journey.allActive('Onboarding')` — identical keys to `useOperationalGaps`. When the Situation Room has already loaded general gaps, mission gaps are computed from cache.
- Ownership state algorithm is identical to `useOperationalGaps`. Covered → Routed → Unrouted.
- Every gap carries `missionId` and `missionName`.
- Sort order: urgency tier ascending, then `daysToExpiry` ascending (nulls last).

---

## Navigation Layer Extension

`MissionNavContext { missionId: string; missionName: string }` introduced in `types/screens.ts`. The `person-profile` screen variant carries an optional `missionContext?: MissionNavContext`.

This is the transport mechanism for mission context through the navigation chain. It does not couple screens to each other — the context is carried as screen state through the router.

Navigation chain (mission mode):
```
SituationRoom.handleNavigate(personId)
  → builds MissionNavContext when isMissionMode && selectedMission
  → onNavigateToPerson(personId, missionCtx)
  → AppShell: navigate({ id: 'person-profile', personId, tab: 'readiness', missionContext })
  → PersonProfile receives missionContext?
  → StartJourneyPanel receives missionContext?
  → MissionContextBand rendered when missionContext is present
  → mutateAsync includes MissionID
  → Journey.MissionID set in mock store
```

In All Gaps mode, `missionCtx` is `undefined` and the chain behaves identically to pre-Sprint 10.

---

## Mock Dataset (Sprint 10)

| MissionID | Name | Status | Entity | Jurisdiction | Participants |
|---|---|---|---|---|---|
| TR/2026/006 | RLCS 2026 - World Championship & EWC | Confirmed | UAE | Paris, France | PER-0001, PER-0002 |
| SATR/2026/003 | RLCS 2026 - MENA Qualifier | FinancePending | KSA | Riyadh, KSA | PER-0004 |

**TR/2026/006 generates gaps.** Status is Confirmed → ADR-002 gate passes. PER-0001 has an AtRisk Travel credential; with the Paris EndDate as horizon, this escalates to Critical in mission mode. PER-0002 has Unsatisfied obligations; these are Critical in both modes.

**SATR/2026/003 generates no gaps.** Status is FinancePending → ADR-002 gate blocks evaluation. This mission does not appear in the Situation Room scope selector.

---

## What Is Frozen (Sprint 10 additions)

1. **ADR-002: Mission activation gate.** `MISSION_OBLIGATION_ACTIVE_STATUSES = ['Confirmed', 'Active', 'PostMission']`. Will not be revisited for Mission v1.

2. **MissionID = TR code.** No parallel identifier introduced.

3. **MissionSpan three-date model.** StartDate (operational start), EndDate (operational closure, urgency horizon), SettlementDate (financial closure, not used in gap computation). These three events are architecturally distinct and will not be collapsed.

4. **Horizon-aware urgency is additive.** `computeUrgency(obligation, journeyId)` without `horizonDate` is unchanged. Mission mode passes `EndDate`; general mode does not.

5. **ADR-002 gate enforced in useMissionGaps only.** No other layer checks it. Screens, components, and other hooks receive gap data already filtered.

6. **Journey MissionID is informational.** It does not change obligation evaluation, journey lifecycle, or ownership computation.

7. **MissionParticipant.ExternalCode is stored but not used by C3 internally.** It exists for Finance/Logistics cross-reference.

8. **SettlementDate is not used in operational gap computation.** It is carried for future Finance views.

---

## What Remains Open

**Jurisdiction-aware evaluation (deferred):**
`Mission.Jurisdiction` is stored on every Mission (e.g. "Paris, France"). The protocol does not yet use it to discriminate credential requirements. A future sprint will add jurisdiction-specific obligation sets: Paris → Schengen visa required; Riyadh → Saudi visa required. The data is in place; the evaluation logic is not.

**Mission Room screen (deferred):**
There is no dedicated Mission screen. The Situation Room scope selector is the Mission entry point for Sprint 10. A future Mission Room would surface: roster readiness summary, participant gap list, mission timeline, and eventually logistics status and Finance summary.

**Mission creation UI (deferred):**
Missions exist in the mock store as seeds. There is no UI for creating, editing, or transitioning Mission status. These workflows belong to a future sprint.

**SharePoint implementation (blocked):**
`SharePointMissionService` is a graceful stub. Full implementation is blocked pending IT access, SP list schema design, and Power Automate flow configuration.

**PostMission → Settled transition trigger (deferred):**
The transition from PostMission to Settled stops gap generation. The trigger for this transition (Finance settlement confirmation) is not yet modelled in the platform. Currently only writable via `updateMissionStatus` which is available but has no UI surface.

---

## The Platform in One Sentence (updated)

C3 computes operational truth continuously from evidence, surfaces gaps by urgency and ownership across the full organisation and within defined Mission contexts, and routes accountability to the people responsible for resolving them.

---

## Layered Architecture (updated)

```
┌──────────────────────────────────────────────────────────────┐
│  Screens                                                     │
│  PersonProfile · SituationRoom (All Gaps + Mission scope)    │
│  PeopleWorkspace · ContractProfile · ...                     │
├──────────────────────────────────────────────────────────────┤
│  Shared Components                                           │
│  OperationalGapRow · ReadinessPanel · StartJourneyPanel      │
│  (MissionContextBand) · AddCredentialPanel · DataRow · ...   │
├──────────────────────────────────────────────────────────────┤
│  Hooks                                                       │
│  useOperationalGaps · useMissionGaps · usePersonReadiness    │
│  useMissions · useMissionParticipants                        │
│  useInitiateJourney · useAddCredential · usePeople · ...     │
├──────────────────────────────────────────────────────────────┤
│  Service Interfaces                                          │
│  ICredentialService · IJourneyService · IMissionService      │
│  IPersonService · IContractService · ...                     │
├──────────────────────┬───────────────────────────────────────┤
│  Mock Implementations│  SharePoint Implementations           │
│  (in-memory, seeded) │  (stubs — data layer pending)         │
├──────────────────────┴───────────────────────────────────────┤
│  Protocols (pure functions)                                  │
│  evaluateOnboardingObligations (span-aware, context-driven)  │
│  computeUrgency (horizon-aware: general + mission modes)     │
│  credentialProvides · credentialTypesFor                     │
├──────────────────────────────────────────────────────────────┤
│  Types  (@c3/types)                                          │
│  Person · Credential · Journey (MissionID) · Obligation      │
│  ObligationEvaluation · OperationalGap (missionId/Name)      │
│  Mission · MissionParticipant · MissionSpan                  │
│  OwnershipState · UrgencyTier · CredentialCapability         │
│  MissionNavContext · C3Screen                                │
└──────────────────────────────────────────────────────────────┘
```

---

*This document extends `C3 Architecture Baseline — Sprint 9.md`. All decisions recorded in that document remain in force.*
