# C3 Architecture Baseline — Sprint 9

**Status:** Frozen  
**Version:** v0.9.0-operational-ownership  
**Date:** 2026-06-28  
**Purpose:** Capture the architectural state of C3 as of Sprint 9 completion. This document is the reference baseline before the Mission model is introduced. It records what is locked, what is still open, what Mission requires from the architecture, and the key design decisions that will not be revisited.

---

## What This Document Is

An architectural freeze statement. Not a recap of what was built sprint by sprint — the sprint history in `PROJECT_STATUS.md` serves that purpose. This is a description of the system as it stands: its structure, its data model, its key invariants, and the decision rationale for each.

Read this before starting Sprint 10. Read this before writing Mission implementation code. The goal is to walk into Mission implementation with a shared, precise understanding of what already exists and why.

---

## The Platform in One Sentence

C3 computes operational truth continuously from evidence, surfaces gaps by urgency and ownership, and routes accountability to the people responsible for resolving them.

---

## The Layered Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Screens                                                │
│  PersonProfile · SituationRoom · PeopleWorkspace · ...  │
├─────────────────────────────────────────────────────────┤
│  Shared Components                                      │
│  OperationalGapRow · ReadinessPanel · StartJourneyPanel │
│  AddCredentialPanel · DataRow · SectionCard · ...       │
├─────────────────────────────────────────────────────────┤
│  Hooks                                                  │
│  useOperationalGaps · usePersonReadiness                │
│  useInitiateJourney · useAddCredential · usePeople ...  │
├─────────────────────────────────────────────────────────┤
│  Service Interfaces                                     │
│  ICredentialService · IJourneyService                   │
│  IPersonService · IContractService ...                  │
├──────────────────────┬──────────────────────────────────┤
│  Mock Implementations│  SharePoint Implementations      │
│  (in-memory, seeded) │  (stubs — data layer pending)    │
├──────────────────────┴──────────────────────────────────┤
│  Protocols (pure functions)                             │
│  evaluateOnboardingObligations                          │
│  credentialProvides · credentialTypesFor                │
├─────────────────────────────────────────────────────────┤
│  Types  (@c3/types)                                     │
│  Person · Credential · Journey · Obligation             │
│  ObligationEvaluation · OperationalGap · Mission        │
│  OwnershipState · UrgencyTier · CredentialCapability    │
└─────────────────────────────────────────────────────────┘
```

**Key structural rule:** no layer may import from a layer above it. Types have no dependencies. Protocols import only types. Service interfaces import only types. Hooks import service interfaces + types. Components import hooks + types; shared components may import other shared components but not screens.

---

## The Core Data Model

### Person (permanent)

The Person is the stable anchor of the system. A person's existence, identity, and obligations do not depend on any particular Journey or Mission. When a Journey ends, the person remains. When a credential expires, the person remains. The readiness question is always asked *about* a person, not *about* a Journey.

```
Person:
  PersonID         — stable identifier (e.g. PER-0001)
  FullName
  PrimaryRole
  PrimaryDepartment
  CurrentTeam
  CurrentGameTitle
  PersonnelCode    — external code (e.g. RL/PL/026)
  IsActive
```

### Credential (evidence)

A credential is evidence that a capability requirement has been satisfied. It has a type, a capability set it confers, a validity window, and a holder. The credential does not know which obligations it satisfies — that determination belongs to the protocol.

```
Credential:
  CredentialID
  HolderPersonID
  Type:              CredentialType   (one of 18 jurisdiction-neutral values)
  Capabilities:      CredentialCapability[]  (derived from CREDENTIAL_CAPABILITIES map)
  IssuedBy
  IssuedDate
  ExpiryDate?
  IsActive
```

**Key decision (Sprint 6G — locked):** Protocols ask for capabilities (`Travel`, `Identity`, `RightToWork`), not credential types. A Visa satisfies `Travel`. A Passport satisfies `Identity`. A Passport does not satisfy `Travel` — it proves identity, not entry authorisation. This prevents a long-expiry passport from masking an expiring visa.

### Obligation (protocol-derived, computed)

An obligation is a requirement that a protocol has determined must be satisfied for a person to be operationally ready. Obligations are never stored. They are always computed by running the protocol function against the current credential set.

```
Obligation:
  id
  requirement        — human-readable label (e.g. "Travel Authorization")
  satisfiedByCapability: CredentialCapability
  status:            Satisfied | AtRisk | Unsatisfied
  statusReason       — first-class operational explanation
  credentialExpiryDate?  — when the satisfying credential expires (if AtRisk)
  defaultOwner?      — protocol's suggestion for who should own resolving this
```

**Key decision (Sprint 6E — locked):** `defaultOwner` is defined at the protocol level, not in the data. The protocol knows which operational team is responsible for each capability type. This value surfaces as a routing suggestion; actual ownership is recorded in `ObligationAssignment`.

### Journey (episodic)

A Journey is a tracked operational commitment for one person, covering a defined workflow scope (Onboarding, VisaRenewal, TeamTransfer, ContractRenewal, Offboarding). Journeys come and go. The person is permanent; Journeys are the temporary operational response to a readiness gap.

```
Journey:
  JourneyID
  PersonID
  Type:              JourneyType
  Status:            Active | Completed | Suspended | Cancelled
  InitiatedAt
  InitiatedBy
  AssignedTo?        — overall governance owner (who is accountable for completion)
  InitiationReason?
  ContractID?
  MissionID?         — not yet implemented; planned for Sprint 10
  Notes?
  obligationAssignments?: ObligationAssignment[]  — Sprint 9 (S9-2)
```

**Key decision (Sprint 9 — locked):** Two-level ownership model. `AssignedTo` is governance accountability: this person is responsible for the Journey reaching completion. `obligationAssignments[]` is execution accountability: each item assigns a specific obligation type to the team or person who will physically resolve it. These are different roles and should not be collapsed into one field.

### ObligationAssignment (Sprint 9)

```
ObligationAssignment:
  obligationType:   CredentialCapability   — matches against obligation.satisfiedByCapability
  requirement:      string                 — audit trail label
  assignedTo:       string                 — operator or team responsible
  assignedAt:       string                 — ISO 8601 timestamp
```

### OperationalGap (computed projection)

The Situation Room renders `OperationalGap[]`, not `Obligation[]`. An `OperationalGap` is the join of an obligation with its person context, journey context, ownership state, and urgency tier. It is computed by `useOperationalGaps` and is never stored.

```
OperationalGap:
  personId · personName · personRole · personTeam
  obligationId · requirement · satisfiedByCapability · blockingReason
  urgencyTier:      Critical | High | Medium
  daysToExpiry?
  journeyId?
  assignedTo?       — obligation-specific owner (if Covered); journey owner (if Routed)
  defaultOwner      — protocol suggestion (if Unrouted)
  ownershipState:   Unrouted | Routed | Covered
  evaluatedAt
```

---

## The Three-State Ownership Model

```
Unrouted  — no active Journey for this person
            ↓ Start Journey (with or without obligation assignments)
Routed    — Journey exists + AssignedTo; no obligation-specific assignment
            ↓ Add obligationAssignment for this obligation type
Covered   — Journey.obligationAssignments includes this obligation type
```

**Invariant:** Covered implies Routed. You cannot Cover an obligation without a Journey. The three states form a partial order: Unrouted < Routed < Covered. Moving from Covered back to Routed is possible (remove an assignment); moving from Routed to Unrouted would require journey cancellation.

**Urgency is independent of ownership state.** A Covered gap is still High urgency if the credential expires in 20 days. Coverage means someone owns it; urgency means it is time-sensitive. An operator needs both signals.

---

## The Ownership Computation (as-built)

```typescript
// In useOperationalGaps — one per obligation per person
const obligationAssignment = journey?.obligationAssignments?.find(
  a => a.obligationType === obligation.satisfiedByCapability,
);

const ownershipState: OwnershipState =
  !journey             ? 'Unrouted'
  : obligationAssignment ? 'Covered'
  : journey.AssignedTo   ? 'Routed'
  :                        'Unrouted';

const assignedTo = obligationAssignment?.assignedTo ?? journey?.AssignedTo;
```

This logic lives entirely in the hook. Components receive `OwnershipState` as a value; they never compute it.

---

## The Urgency Computation (as-built)

```typescript
// In utils/urgency.ts
const computeUrgency = (obligation, journeyId) => {
  if (obligation.status === 'Unsatisfied')
    return journeyId ? 'High' : 'Critical';
  // AtRisk — time-based
  if (days < 0)    return 'Critical';   // expired
  if (days <= 30)  return 'High';
  return 'Medium';
};
```

**What will change when Mission is introduced:** Urgency for Mission-scoped gaps should be relative to `Mission.EndDate`, not a rolling 30/90-day window. A credential expiring 35 days from now is Medium urgency in the general case; it is Critical urgency if the Mission starts in 10 days and the credential covers the full Mission span. This is the primary urgency computation change Mission requires.

---

## The Protocol Architecture

A protocol is a pure function:

```typescript
type ProtocolFn = (
  personId: string,
  credentials: Credential[],
  context?: ProtocolContext,
) => ObligationEvaluation;
```

`ProtocolContext` carries optional span and mission information:

```typescript
interface ProtocolContext {
  span?: { from: string; to: string };   // date range obligations must cover
  mission?: Mission;                     // the Mission this evaluation is for
}
```

**Sprint 6E wired this. Sprint 9 has not yet used it.** The Situation Room calls `evaluateOnboardingObligations` without a context, so all evaluations use the rolling-window defaults. When Mission arrives, Mission-aware evaluation passes `ProtocolContext` with the Mission's span. The protocol function already accepts this — no protocol interface changes are needed for Mission.

The protocol does not know about Journeys. It takes credentials as evidence and computes obligation status. The hook joins the protocol result with journey and ownership data.

---

## The Service Access Pattern (ADR-001)

All service access goes through hooks. Components never call services directly. Hooks access services through `use[X]Service()`, which reads from the service registry via `HostContext`. This allows mock and SharePoint implementations to be swapped without changing any component or hook logic.

```
Component → Hook → use[X]Service() → IXService → MockXService | SharePointXService
```

**Write operations** (mutations) go through dedicated mutation hooks (`useInitiateJourney`, `useAddCredential`) which call `mutateAsync`, handle `onSuccess` cache invalidation, and expose `isPending`. No component manages mutation state directly.

**Cache keys** are defined in `queryKeys.ts`. Invalidation targets are specified in mutation hooks. The query key hierarchy is:

```
credentials.all()
credentials.forPerson(personId)
journey.allActive(type?)
journey.forPerson(personId, type?)
people.all
people.byId(id)
```

---

## What Is Frozen

These decisions will not be revisited without a documented architectural decision record:

1. **Capability-based credential model.** Protocols express obligations as capability requirements, not document names. `Passport → Identity` only; `Visa → Travel`.

2. **Protocols are pure functions.** No network calls, no side effects, no imports beyond types. Testable in isolation with no mocking.

3. **ObligationEvaluation is never stored.** It is always recomputed from current credentials. This is intentional — it means the system reflects reality at all times without a synchronisation problem.

4. **Two-level ownership on Journey.** `AssignedTo` (governance) and `obligationAssignments[]` (execution). These serve different accountability roles and must not be collapsed.

5. **Three-state ownership model.** Unrouted / Routed / Covered. The states are semantically distinct and cannot be reduced to a binary without losing operational information.

6. **The Person is the stable anchor.** Journeys, credentials, and obligations are all attributes of or events in a person's operational lifecycle. Person is not an attribute of a Journey.

7. **Service access via hooks only.** Components do not call services. Hooks do not import service implementations. The binding happens in HostContext.

8. **OperationalGap is a computed projection.** It joins obligation + person + journey + urgency + ownership into a single object for the Situation Room. It is not a domain entity and should not be stored or passed upward in the component tree.

9. **Mock mode is not a shim — it is a first-class environment.** The mock implementations are not temporary scaffolding. They are a complete in-memory representation of the data model that enables validation before the SharePoint layer exists.

---

## What Is Still Evolving

These are open design questions or deferred implementations:

1. **Span-aware urgency.** `ProtocolContext.span` exists and the protocol accepts it, but no UI passes it yet. Urgency currently uses rolling windows (30d / 90d). Mission will drive span-aware evaluation.

2. **Jurisdiction-aware evaluation.** The Mission model identifies jurisdiction as a credential discriminator (Schengen visa vs. UAE visa). The protocol currently has no jurisdiction parameter. This needs design before Mission implementation begins.

3. **Multi-protocol evaluation.** `useOperationalGaps` accepts `protocols[]` in its filter, but only `evaluateOnboardingObligations` is used. VisaRenewal, TeamTransfer, and Mission protocols are forthcoming.

4. **MissionID on Journey.** `Journey.MissionID` is planned but not yet implemented. Journeys currently carry `ContractID` as the only external reference; `MissionID` follows the same pattern.

5. **Mission-relative urgency.** The urgency algorithm will need to incorporate `Mission.EndDate` as an urgency horizon. Design TBD.

6. **Obligation activation gating.** Mission-specific obligations should not appear until `Mission.Status === 'Confirmed'`. The activation gate logic is not yet implemented.

7. **SharePoint data layer.** All service implementations beyond mock are stubs. The data layer is blocked on IT access and SP list schema confirmation. The service interfaces are stable; the implementations will be filled in when access is available.

---

## What Mission Requires From the Architecture

Mission will be the most structurally significant addition to C3 since the Sprint 6E structural freeze. It touches multiple layers. Here is what each layer needs:

### Types (`@c3/types`)

The `Mission` stub from Sprint 6E needs to be fully specified. At minimum:

```
Mission:
  MissionID        (TR/2026/006 format)
  Name
  Game
  Organizer
  Entity:          UAE | KSA | Multi
  Status:          Planning | FinancePending | Confirmed | Active | PostMission | Settled | Canceled
  Jurisdiction:    string
  Span:
    StartDate
    EndDate
    SettlementDate
  ParticipantPersonIDs: string[]
```

`MissionParticipant` (role, per diem) and Mission logistics types may live in a separate `mission-detail.ts` to keep core types uncluttered.

### Protocols

A new protocol function for Mission-scoped readiness:

```typescript
type MissionProtocolFn = (
  personId: string,
  credentials: Credential[],
  context: ProtocolContext & { mission: Mission },
) => ObligationEvaluation;
```

This protocol evaluates obligations relative to `mission.Span` and `mission.Jurisdiction`. It is distinct from the Onboarding protocol. The existing `evaluateOnboardingObligations` continues unchanged.

### Services

```
IMissionService:
  listMissions(filter?: MissionFilter): Mission[]
  getMission(missionId: string): Mission | null
  listMissionParticipants(missionId: string): MissionParticipant[]
  confirmMission(missionId: string): Mission      — triggers obligation activation
  updateMissionStatus(missionId: string, status): Mission
```

### Journey (additive change)

```
Journey.MissionID?: string   — which Mission this Journey was initiated for
InitiateJourneyInput.MissionID?: string
```

No other changes to the Journey model.

### Hooks

`useMissionGaps(missionId: string)` — the Mission-scoped variant of `useOperationalGaps`. Fetches Mission participants, evaluates each against the Mission protocol with `ProtocolContext.span = mission.Span`, computes urgency relative to `mission.EndDate`.

`useMissions()` — list all Missions, optionally filtered by status.

### Urgency (additive change)

```typescript
computeUrgency(obligation, journeyId, context?: { missionEndDate?: string })
```

When `missionEndDate` is provided, urgency is computed relative to that date rather than rolling windows. A credential expiring before `missionEndDate` is Critical regardless of how many days remain. The current rolling-window algorithm remains the default for non-Mission gaps.

### Screens

The **Situation Room** gains an optional Mission scope. Without a Mission selected, it behaves as today (all persons, all gaps). With a Mission selected, it shows only gaps for Mission participants, urgency is Mission-relative, and a Mission context header is displayed.

A **Mission Room** (future, not Sprint 10) is the dedicated command surface for Mission readiness: roster status, participant gaps, logistics status, cost summary. This is analogous to the Situation Room but scoped to a single Mission.

---

## The Architecture Does Not Need to Change for Mission

This is worth stating explicitly. The Sprint 6E structural freeze was designed with Mission in mind. `ProtocolContext.span`, `ProtocolContext.mission`, the service interface pattern, the hook composition model — all of it accommodates Mission without structural revision.

Mission is an additive change:
- New types (Mission, MissionParticipant, logistics)
- New service interface (IMissionService)
- New protocol function (mission-scoped evaluation)
- New hook (useMissionGaps)
- Additive fields on Journey (MissionID)
- Urgency extended with an optional horizon parameter

Nothing in the current architecture needs to be removed or restructured. The components, hooks, and protocols built in Sprints 6–9 remain correct and continue to function in the Mission-aware model.

---

## The Current Mock Dataset

For reference, the mock data as of Sprint 9 demonstrates all three ownership states:

| Person | Obligation | Status | Ownership | Urgency |
|---|---|---|---|---|
| PER-0001 (Abdulaziz) | Travel Authorization | AtRisk (≤30d) | **Covered** | High |
| PER-0002 (Mohammad) | Travel Authorization | Unsatisfied | **Routed** | High |
| PER-0002 (Mohammad) | Right to Work | Unsatisfied | **Routed** | High |
| PER-0004+ (no Journey) | any Unsatisfied | Unsatisfied | **Unrouted** | Critical |

JRN-0001 (PER-0001) carries `obligationAssignments: [{ obligationType: 'Travel', assignedTo: 'pro.coordinator@geekay.gg' }]`.  
JRN-0002 (PER-0002) has `AssignedTo` but no `obligationAssignments`.  
PER-0003 (Diab) has a Completed journey and all obligations Satisfied — not in the Situation Room.

---

## What the Architecture Looks Like From the Operator's Perspective

The operator interaction model is:

```
Situation Room (now, what needs attention, who owns it)
  ↓ click a gap row
Person Profile → Readiness tab (what specifically is missing, context)
  ↓ click Start Journey
StartJourneyPanel (governance owner + per-obligation assignments → Routed/Covered)
  ↓ or click Resolve
AddCredentialPanel (register evidence → gap clears, Situation Room updates)
  ↓
Situation Room (gap is gone or ownership state has advanced)
```

This is the core operational loop as of Sprint 9. Mission adds a Mission-scoped entry point above the Situation Room and a Mission context to the StartJourneyPanel flow.

---

## Technical Debt Carried Forward

The following items from the Technical Debt Register are architecturally relevant:

- **TD-014:** Fast Refresh warnings on HostContext and AppContext exports — cosmetic, not functional. Will be resolved when those files are restructured.
- **TD-017:** DataRow `border` / `borderLeft` specificity conflict — visual only; does not affect layout or function.
- **TD-018:** Form inputs missing `id`/`name` attributes in some legacy panels — accessibility debt. Priority before production.

All SharePoint implementation stubs (TD-001 through TD-004) remain blocked on IT access. The interfaces are stable.

---

## Mission Activation Gate — Resolved

The activation gate decision was resolved before Sprint 10 implementation. See ADR-002.

**Decision: Option B (status-gated filter in the hook).** Missions generate obligations only when `Status ∈ { Confirmed, Active, PostMission }`. The filter lives in `useMissionGaps`. No new entity, no event bus, consistent with the platform's core pattern of computing from current evidence.

See: `docs/adr/ADR-002-mission-activation-gate.md`

---

*C3 Platform · Architectural Baseline · Sprint 9 · 2026-06-28*  
*Frozen. Revisions require a documented decision record.*
