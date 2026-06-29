# Sprint 6E — Structural Freeze

**Start:** Pending approval  
**Baseline:** C3 v0.4.0-operational-model (Sprint 6 Phases 6A–6D complete)  
**Type:** Structural freeze sprint — no new features, no new UI  
**Governing documents:** `docs/product/The Geekay Operational Model.md` · `docs/product/C3 Conceptual Framework.md`

---

## Sprint Goal

> Correct the structural gaps identified in the post-6D architecture review before the model grows further. Every change in this sprint is a correction that becomes exponentially more expensive with each sprint deferred. No new capabilities are introduced. Existing behaviour is fully preserved. The sprint ends with an architecture that is ready to validate through real operational workflows.

Sprint 6E is a structural freeze sprint, not a feature sprint. Its output is not visible to users. Its output is a codebase whose internal shape matches the Operational Model it claims to implement.

---

## Locked Architectural Decisions (Pre-Approved)

The following decisions are locked before implementation begins. They are not in scope for re-evaluation during this sprint.

**Journey Generalization**  
`OnboardingJourney` is a named violation of the Operational Model. The model defines one Journey concept with a type property — not a separate interface per journey type. All future journey types (Visa Renewal, Team Transfer, Offboarding, Contract Renewal) must reuse the same entity, service, and hooks. The correction happens now, before a second journey type creates migration debt.

**Protocol Ownership**  
Protocols define default ownership for obligation types. Journeys record actual accountability through `AssignedTo`. Uncovered gaps carry suggested ownership from their Protocol definition. Journey-covered gaps carry assigned accountability from their Journey record. The Situation Room (future) converts suggested ownership into actual ownership through routing. This principle is locked.

**Service-Access Pattern**  
Two patterns exist. One is legacy (SPService facade). One is the permanent pattern (parallel factory). This is not ambiguous — it is undocumented. The decision is already made; it needs to be recorded so future contributors do not discover it by reading history.

**Mission Belongs in the Type System**  
The Operational Model is explicit: Mission belongs in the model before it becomes a product feature. Without a type stub, protocols have no principled place to receive mission context. The stub costs nothing now and prevents a retroactive threading problem later.

---

## Phase 6E-1 — Journey Generalization

### What Changes

`OnboardingJourney` is renamed to `Journey` with a `JourneyType` discriminator field. `IJourneyService` methods become type-aware. The service gains `suspendJourney` and `cancelJourney` to make all four lifecycle states reachable through the interface (not only through seed data). `AssignedTo` is added as an optional field — the first foothold for Journey-level ownership.

**Type changes (`types/journeys.ts`):**

```
JourneyType  = 'Onboarding' | 'VisaRenewal' | 'TeamTransfer' | 'ContractRenewal' | 'Offboarding'
JourneyStatus = 'Active' | 'Completed' | 'Suspended' | 'Cancelled'   ← unchanged

Journey {
  JourneyID, PersonID, Type: JourneyType, Status, InitiatedAt, InitiatedBy,
  AssignedTo?,          ← NEW: who is accountable for closing this Journey
  InitiationReason?, ContractID?, CompletedAt?, Notes?
}

InitiateJourneyInput {
  PersonID, Type: JourneyType, InitiatedBy, AssignedTo?,
  InitiationReason?, ContractID?
}
```

**Service interface changes (`IJourneyService.ts`):**

| Old | New |
|---|---|
| `getActiveOnboardingJourney(personId)` | `getActiveJourney(personId, type: JourneyType)` |
| `listOnboardingJourneys(personId)` | `listJourneysForPerson(personId, type?: JourneyType)` |
| `initiateOnboardingJourney(input)` | `initiateJourney(input: InitiateJourneyInput)` |
| `completeOnboardingJourney(journeyId)` | `completeJourney(journeyId)` |
| *(absent)* | `suspendJourney(journeyId): Promise<Journey>` |
| *(absent)* | `cancelJourney(journeyId): Promise<Journey>` |

**Implementation changes:**
- `MockJourneyService` — updated to new interface; seed data adds `Type: 'Onboarding'` to all three journeys; in-memory write methods updated
- `SharePointJourneyService` — updated to new interface; graceful stub behaviour unchanged
- `useOnboardingJourney` hook — renamed to `useActiveJourney(personId, type: JourneyType)` or updated in place
- `usePersonJourneys` hook — updated to call `listJourneysForPerson`
- `queryKeys.ts` — journey keys updated if method names change
- `PersonProfile` — import updated; existing behaviour preserved

### Why It Belongs in 6E

Every sprint that passes without this change adds more consumers of `OnboardingJourney` as a named type. The hooks, the profile screen, and the mock service all reference it. A second journey type (Visa Renewal) built against the current interface would require either a new service interface alongside the old one or a migration of all existing consumers. The correction is bounded now. It grows with each sprint deferred.

### What It Unlocks

All future journey types reuse `IJourneyService` without new service interfaces or ServiceRegistry slots. `AssignedTo` enables Ownership tracking on Journeys. `suspendJourney` and `cancelJourney` make Suspended and Cancelled states reachable through the service — previously valid as type values, but not reachable through any write operation. Journey Initiation as a workflow (next sprint) can target a type-aware service without interface changes.

### Files Affected

```
packages/c3/src/types/journeys.ts               — rewrite
packages/c3/src/services/interfaces/IJourneyService.ts  — rewrite
packages/c3/src/services/mock/MockJourneyService.ts     — update
packages/c3/src/services/sharepoint/SharePointJourneyService.ts  — update
packages/c3/src/hooks/useOnboardingJourney.ts           — rename/update
packages/c3/src/hooks/usePersonJourneys.ts              — update
packages/c3/src/hooks/queryKeys.ts                      — update journey keys
packages/c3/src/screens/PersonProfile.tsx               — update imports and usages
```

### Risk Level

**Medium.** This is the largest change in the sprint — it touches types, service interface, two service implementations, two hooks, and one screen. The change is mechanical: rename, restructure, add discriminator. No evaluation logic changes. No UI logic changes. The risk is a missed import or a type mismatch caught at build time, not a subtle runtime regression.

Mitigation: the TypeScript compiler catches all consumer mismatches at build time. A clean `build:c3` after this phase is strong evidence of correctness.

### Validation

1. `build:c3` passes with zero errors.
2. `lint:c3` passes with no new warnings beyond the pre-existing Fast Refresh set.
3. PersonProfile visual verification:
   - PER-0001 Readiness tab: Active journey displayed, AtRisk evaluation unchanged.
   - PER-0002 Readiness tab: Active journey displayed, Unsatisfied evaluation unchanged.
   - PER-0003 Readiness tab: Completed journey displayed, Satisfied evaluation unchanged.
4. No UI visual change from pre-6E state.

---

## Phase 6E-2 — Obligation Span and Protocol Context

### What Changes

`Obligation` gains a `span` field. A `ProtocolContext` type is introduced. Protocol evaluation functions gain an optional context parameter. `ObligationSpec` gains `defaultOwner` — the Protocol's declaration of which operational domain owns this obligation type by default.

**Type additions (`types/obligations.ts`):**

```
ObligationSpan {
  from: string;   // ISO date — start of the period the obligation must hold
  to: string;     // ISO date — end of the period the obligation must hold
}

Obligation {
  ...existing fields...
  span?: ObligationSpan;        ← NEW: the period this obligation covers
  defaultOwner?: string;        ← NEW: the role/team that owns this obligation type by default
}
```

**New type (`types/protocols.ts`):**

```
ProtocolContext {
  span?: ObligationSpan;        // if provided, obligations use this span; else use protocol default
  mission?: Mission;            // forward reference — typed as Mission once stub exists (Phase 6E-5)
}
```

**Protocol changes (`protocols/onboardingProtocol.ts`):**

`OBLIGATION_SPECS` extended with `defaultOwner`:

```
{ id: 'passport',     requirement: 'Valid Passport', satisfiedByTypes: ['Passport'],   defaultOwner: 'PRO Coordinator' },
{ id: 'uae-visa',     requirement: 'UAE Visa',        satisfiedByTypes: ['Visa'],        defaultOwner: 'PRO Coordinator' },
{ id: 'emirates-id',  requirement: 'Emirates ID',     satisfiedByTypes: ['EmiratesID'],  defaultOwner: 'Operations Coordinator' },
```

`evaluateOnboardingObligations` signature extended:

```
evaluateOnboardingObligations(
  personID: string,
  credentials: Credential[],
  context?: ProtocolContext,    ← NEW optional parameter
): ObligationEvaluation
```

When `context.span` is provided, the protocol uses it to compute AtRisk status: a credential is AtRisk if it expires before `context.span.to`. When absent, the existing 90-day window (`AT_RISK_THRESHOLD_DAYS`) remains in effect. The `defaultOwner` from each spec propagates to the produced `Obligation`.

**No callers change.** All existing calls pass two arguments; the optional third is not required.

### Why It Belongs in 6E

The 90-day approximation is documented as a deferral. It cannot remain a permanent pattern because it cannot be correct for a Tournament Eligibility Protocol (where the span is exact and known) or a Contract Renewal Protocol (where the span aligns to the employment period). Without a context parameter slot in the evaluation signature, every future protocol either approximates wrongly or introduces a bespoke signature — neither is acceptable.

`defaultOwner` on ObligationSpec is the implementation of the locked ownership principle. Protocols are the source of default ownership. This is where that encoding belongs. The Situation Room will consume it when built.

### What It Unlocks

- Tournament protocols can pass exact tournament date ranges and produce obligations with correct spans.
- Contract protocols can pass the contract period as span; credentials expiring mid-contract become AtRisk.
- `defaultOwner` on evaluated obligations enables the Situation Room to route uncovered gaps to the correct team without additional configuration.
- `ProtocolContext.mission` is the forward connection to the Mission entity — typed as `Mission` once Phase 6E-5 exists.

### Files Affected

```
packages/c3/src/types/obligations.ts            — add ObligationSpan, defaultOwner to Obligation
packages/c3/src/types/protocols.ts              — new file: ProtocolContext, ObligationSpan
packages/c3/src/types/index.ts                  — add export for protocols.ts
packages/c3/src/protocols/onboardingProtocol.ts — add defaultOwner to specs, add context param, propagate span
packages/c3/src/protocols/index.ts              — re-export ProtocolContext
```

### Risk Level

**Low.** All changes are additive. The context parameter is optional; no existing callers change. The `defaultOwner` field on Obligation is optional; ReadinessPanel does not yet render it. The span field on Obligation is optional; evaluation logic uses it only when the caller provides context. A clean build is sufficient evidence of correctness.

### Validation

1. `build:c3` passes.
2. `lint:c3` passes.
3. Existing readiness evaluation output unchanged — PER-0001 AtRisk, PER-0002 Unsatisfied, PER-0003 Satisfied.
4. Manual verification: calling `evaluateOnboardingObligations(personID, credentials, { span: { from: today, to: +10days } })` with a credential expiring in 30 days produces AtRisk (credential expires before span end). This can be verified via the browser console during development.

---

## Phase 6E-3 — `usePersonReadiness` Hook

### What Changes

A new hook `usePersonReadiness` encapsulates the pattern of: fetch credentials → evaluate protocol → return result. PersonProfile's inline evaluation call is replaced with this hook. The evaluation is memoized on the credentials data, not recomputed on every render.

**New hook (`hooks/usePersonReadiness.ts`):**

```
usePersonReadiness(
  personId: string,
  protocolFn: (personId: string, credentials: Credential[], context?: ProtocolContext) => ObligationEvaluation,
  context?: ProtocolContext,
): {
  evaluation: ObligationEvaluation | null;
  isLoading: boolean;
  error: unknown;
}
```

Behaviour:
- Calls `usePersonCredentials(personId)` internally.
- When credentials are loading, returns `{ evaluation: null, isLoading: true, error: null }`.
- When credentials are available, memoizes `protocolFn(personId, credentials, context)` on the credentials reference.
- When credentials error, returns `{ evaluation: null, isLoading: false, error }`.

TanStack Query deduplication ensures that `usePersonCredentials` called from both PersonProfile (for the Credentials display section) and `usePersonReadiness` (for evaluation) does not produce two network requests — both resolve from the same cache entry.

**PersonProfile changes:**

The inline block:

```tsx
const evaluation = evaluateOnboardingObligations(person?.PersonID ?? '', credentials);
```

is replaced with:

```tsx
const { evaluation, isLoading: isEvaluating } = usePersonReadiness(
  person?.PersonID ?? '',
  evaluateOnboardingObligations,
);
```

The Readiness tab renders a loading state when `isEvaluating` is true and `journey` is present, rather than displaying a spurious all-Unsatisfied evaluation before credentials load.

### Why It Belongs in 6E

The current render-path evaluation has two problems: it produces a semantically incorrect result (all Unsatisfied) during the loading window, and it sets a pattern that, if copied to the People Workspace register view or the Command Center, will produce dozens of in-render evaluations with no deduplication or memoization. The hook pattern makes evaluation composable, gated, and memoized by design. It costs one file and a small change to PersonProfile — now, before the pattern propagates.

### What It Unlocks

- PersonProfile can evaluate multiple protocols by calling `usePersonReadiness` multiple times with different protocol functions — no screen-level restructuring required.
- People Workspace can call `usePersonReadiness` per-person in the register list to show aggregate readiness indicators without duplicating logic.
- `useRosterReadiness(personIds[], protocolFn)` follows as a natural extension of this hook's pattern.
- Loading states are correct: no user sees "3 obligations unsatisfied" on a person who has all three credentials, because credentials haven't loaded yet.

### Files Affected

```
packages/c3/src/hooks/usePersonReadiness.ts     — new file
packages/c3/src/screens/PersonProfile.tsx       — replace inline evaluation with hook
```

### Risk Level

**Low.** One new hook, minimal change to one screen. TanStack Query's deduplication is well-established behaviour. The only new logic is the null guard on credential loading — which is a correction, not a new capability.

### Validation

1. `build:c3` passes.
2. `lint:c3` passes.
3. Readiness tab: no visual change for PER-0001, PER-0002, PER-0003 once credentials load.
4. Verify correct loading behaviour: navigate to PersonProfile and observe that the Readiness tab does not flash "3 Unsatisfied" before settling — it shows a loading state until credentials resolve.

---

## Phase 6E-4 — Service-Access Pattern ADR

### What Changes

A new Architecture Decision Record documents the two service-access patterns, which domains use each, and why. The decision is already made; this phase makes it explicit.

**New file (`docs/decisions/ADR-001-service-access-pattern.md`):**

Content covers:
- **Context:** Two patterns emerged during development. The SPService facade predates the domain service layer. The parallel factory pattern was introduced in Sprint 6 to bypass the frozen SPService monolith for new operational domains.
- **Decision:** SPService facade is the legacy compatibility layer. It is frozen and must not change. All new operational domain services follow the parallel factory pattern: the service factory hook reads `config.dataSourceMode` directly and instantiates the appropriate implementation. New domains do not route through SPService.
- **Rationale:** SPService is frozen because changing it risks the existing SP integration. The parallel factory pattern achieves the same outcome (mode-switching between mock and SharePoint) without touching the frozen interface.
- **Consequences:** Future developers add new domain services as parallel factories. Over time, SPService may be deprecated once the original four domains are migrated — but that migration is not required and not planned.
- **Domains by pattern:**
  - SPService facade (legacy): Contracts, People, Amendments, Users
  - Parallel factory (permanent pattern): Credentials, Journeys, and all future domains

### Why It Belongs in 6E

Without documentation, the pattern decision exists only in engineering history. The next contributor to add a domain service will read the codebase, see two patterns, and pick one — likely the first they encounter. The parallel factory pattern is less prominent in the codebase than the SPService pattern. The ADR makes the correct choice obvious without requiring archaeology.

### What It Unlocks

- New services added correctly on first attempt.
- Onboarding new contributors is faster and less reliant on institutional knowledge.
- The path to deprecating SPService is documented — it doesn't need to happen, but if it does, the rationale is already written.

### Files Affected

```
docs/decisions/ADR-001-service-access-pattern.md    — new file
docs/decisions/                                      — new directory
```

### Risk Level

**None.** Documentation only.

### Validation

- ADR file exists and is coherent.
- Lists the specific services in each category.
- Can be reviewed by a developer with no prior context and understood without ambiguity.

---

## Phase 6E-5 — Mission Interface Stub

### What Changes

A documented `Mission` type stub is added to the type system. The Operational Model states: "Mission belongs in the model. It does not need to be a product feature yet." This phase honours that statement with a type node, not an implementation.

**New file (`types/mission.ts`):**

```
MissionType = 'TournamentParticipation' | 'SeasonPreparation' | 'PlayerOnboarding' | 'TeamTransfer'

Mission {
  MissionID: string;
  Type: MissionType;
  Name: string;
  ActivatedAt: string;                // ISO timestamp — when the Mission became operational
  ActivatedBy: string;
  ParticipantPersonIDs: string[];     // Person entities this Mission applies Protocols to
  Span: { from: string; to: string }; // The period this Mission covers — drives obligation spans
  ProtocolRefs: string[];             // Names of Protocols this Mission activates
  Status: 'Active' | 'Completed' | 'Cancelled';
  Notes?: string;
}
```

All fields and the interface itself are annotated with documentation comments referencing the Operational Model. The file begins with a clear comment: `// Mission is a conceptual placeholder. No service, UI, or implementation exists yet.`

`ProtocolContext` in `types/protocols.ts` is updated to reference `Mission`:

```
ProtocolContext {
  span?: ObligationSpan;
  mission?: Mission;    // when present, protocols derive span from mission.Span
}
```

This is the connecting type that links Mission → ProtocolContext → Obligation span — the central spine of the Operational Model — even before Mission becomes a product feature.

### Why It Belongs in 6E

The Operational Model is explicit. The C3 Conceptual Framework says Workspaces, Entities, Journeys, and Protocols all exist in service of computing the gap — and Mission is what activates the context that determines what the gap is. Leaving Mission entirely absent from the type system means that when Protocol signatures need a context parameter that includes Mission, there's no type to import. The connection has to be built retroactively, threading through existing function signatures. Adding the stub now costs thirty lines. Retroactive threading costs far more.

### What It Unlocks

- `ProtocolContext.mission` can be populated when a Tournament or Onboarding Mission entity is built.
- Protocol evaluation functions can inspect `context.mission.Span` rather than falling back to the 90-day default.
- Future developers see Mission in the type index and understand its relationship to Protocols without reading the Operational Model document.
- The TournamentWorkspace (future) can construct a `Mission` from a Tournament record and pass it to protocol evaluation without any type changes.

### Files Affected

```
packages/c3/src/types/mission.ts        — new file
packages/c3/src/types/index.ts          — add export
packages/c3/src/types/protocols.ts      — add mission?: Mission to ProtocolContext
```

### Risk Level

**None.** Types only. No implementation, no service, no UI. No consumers exist yet.

### Validation

- `build:c3` passes (new type file, no implementation errors).
- `ProtocolContext` correctly references `Mission` in IDE type inspection.
- No breaking changes to any existing code — `mission` field is optional.

---

## Phase Sequence and Dependencies

```
6E-1  Journey Generalization          ← highest risk, no dependencies
6E-5  Mission Stub                    ← no dependencies; must precede 6E-2's ProtocolContext update
6E-2  Obligation Span + Context       ← after 6E-5 (ProtocolContext references Mission)
6E-3  usePersonReadiness Hook         ← after 6E-1 (uses generalized Journey) and 6E-2 (context param)
6E-4  Service-Access Pattern ADR      ← independent; fits naturally as sprint close-out
```

Phases 6E-1 and 6E-5 can proceed in parallel if desired. Phase 6E-4 can be written at any point.

---

## Explicit Out-of-Scope

The following items are deliberately excluded from 6E. They belong to the sprint that validates the architecture through operational workflows.

| Item | Rationale for Exclusion |
|---|---|
| New protocols (Tournament, Payroll) | Must wait for ProtocolRegistry pattern; ProtocolContext landed in 6E enables it |
| Situation Room prototype | Requires multi-person readiness queries not yet in place |
| Journey event timeline | Feature work; belongs to operational workflow validation sprint |
| Journey initiation workflow | Feature work; `initiateJourney` write path exists but no UI panel |
| Error boundaries (TD-010) | Valid maintenance work; does not interact with structural changes |
| Fast Refresh fix (TD-014) | Valid maintenance work; does not interact with structural changes |
| New UI of any kind | 6E is structural only; any UI regression is a failure, not an outcome |
| SharePoint implementations | Blocked pending IT access; no change |
| ProtocolRegistry implementation | Conceptually locked; implementation deferred to first multi-protocol sprint |

Error boundaries and Fast Refresh fix are carried forward as 6F and 6G in the existing designations.

---

## Definition of Done

Sprint 6E is complete when all of the following are true:

- [ ] `build:c3` passes with zero errors on post-6E codebase
- [ ] `lint:c3` passes with no new warnings beyond the pre-existing Fast Refresh set
- [ ] PersonProfile Readiness tab behaviour is visually identical to pre-6E state for PER-0001, PER-0002, PER-0003
- [ ] No `OnboardingJourney` type references remain anywhere in the codebase
- [ ] `IJourneyService` contains no method names that include "Onboarding"
- [ ] `Suspended` and `Cancelled` journey states are reachable through service write methods
- [ ] `Obligation` has a `span` field
- [ ] `ProtocolContext` type exists and is exported from `@c3/types` or `@c3/protocols`
- [ ] `evaluateOnboardingObligations` accepts an optional third parameter
- [ ] `usePersonReadiness` hook exists and is used in PersonProfile
- [ ] No inline protocol evaluation calls remain in any screen component
- [ ] `Mission` interface exists in `types/mission.ts` with documentation comments
- [ ] `ADR-001-service-access-pattern.md` exists in `docs/decisions/`
- [ ] All three seed journeys in MockJourneyService include `Type: 'Onboarding'`
- [ ] `AssignedTo` field exists on `Journey` and `InitiateJourneyInput`
- [ ] `defaultOwner` field exists on `ObligationSpec` and propagates to evaluated `Obligation`

---

## After 6E: Validation Sprint

With the architectural freeze complete, the following sprint validates the model through operational workflows:

**Journey Initiation Workflow** — "Initiate Onboarding" action surfaces on People Workspace and/or PersonProfile. Calls `initiateJourney` with `Type: 'Onboarding'` and `AssignedTo`. Journey appears in Readiness tab. Proves write path on generalized Journey type.

**Situation Room Prototype** — Command Center queries obligations across all persons, surfaces AtRisk and Unsatisfied cases, shows `defaultOwner` as the routing suggestion. Proves collective readiness evaluation and the gap-ownership model.

**Journey Event Timeline** — `JourneyEvent[]` structure on Journey; ActivityTimeline component applied to journey events. Proves organizational memory model.

**Team/Mission-Level Readiness** — Evaluate a group of persons against a Protocol; surface aggregate readiness (N of M ready). First use of `Mission` type in a real query.

---

## Phase Summary

| Phase | Description | Type | Risk |
|---|---|---|---|
| 6E-1 | Journey Generalization | Structural | Medium |
| 6E-2 | Obligation Span + Protocol Context | Structural | Low |
| 6E-3 | usePersonReadiness Hook | Structural | Low |
| 6E-4 | Service-Access Pattern ADR | Conceptual | None |
| 6E-5 | Mission Interface Stub | Conceptual | None |

---

*Sprint 6E Proposal · C3 Platform · Geekay Esports*  
*Derived from architecture review conducted post-Sprint 6D, 2026-06-28*  
*Governing model: The Geekay Operational Model v2*
