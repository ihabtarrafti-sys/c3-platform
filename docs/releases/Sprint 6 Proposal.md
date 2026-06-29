# Sprint 6 — Operational Model Proof of Concept

**Start:** 2026-06-28  
**Baseline:** C3 v1.0.0-mock (all 13 screens, service registry, form framework, design system frozen)  
**Governing document:** `docs/product/The Geekay Operational Model.md`  
**Constraint:** SharePoint access pending; all phases must function without it

---

## Sprint Goal

> Prove the Geekay Operational Model in working software. Implement the smallest set of changes that makes Credentials, Protocols, Obligations, Journeys, and Readiness visible and computable in the product — before building anything on top of them.

Sprint 6 was restructured before any code was written. The original hardening and write-operations plan was set aside in favor of a single framing question: *what is the smallest implementation that proves the Operational Model in practice?*

Each phase exists because it validates a concept from the Operational Model. The order is deliberate: Credentials first (the evidence layer), then Protocols and Obligations (the evaluation layer), then Journeys (the work layer), then Readiness (the signal layer). Nothing was built ahead of its prerequisite concept.

The locked architectural principle that governs all Track D decisions:

> **Journeys are initiated by operational decisions, not by documents or contracts. The Person owns the Journey.**

---

## Phase 6A — Credential Entity ✅ COMPLETE

**Concept proven:** Credentials are first-class operational entities, not fields on Person.

A passport is not a property. It is an entity with a holder, a validity span, an issuer, and a lifecycle. Storing it as `PassportExpiry: string` on Person confuses the evidence with the entity. Phase 6A establishes Credential as its own domain type.

**Delivered:**
- `types/credentials.ts` — `Credential`, `CredentialType`, `CreateCredentialInput`
- `ICredentialService` + `MockCredentialService` (three persons exercising Satisfied / AtRisk / Unsatisfied)
- `SharePointCredentialService` — graceful stub
- `ServiceRegistry` extended: `credentials: ICredentialService`
- `useCredentialService` — parallel factory hook (bypasses frozen SPService monolith)
- `usePersonCredentials` — TanStack Query read hook
- PersonProfile — Credentials SectionCard with non-interactive `DataRow` display
- `DataRow.onClick` made optional — read-only rows no longer carry `role="button"`, `tabIndex`, or pointer cursor

**What it unlocks:** Phase 6B can evaluate obligations against real credential objects.

---

## Phase 6B — Protocol and Obligation Evaluation ✅ COMPLETE

**Concept proven:** Protocols encode what "ready" means; Obligations are produced when a Protocol is applied to an entity.

The Onboarding Protocol defines three requirements for UAE operational readiness: Valid Passport, UAE Visa, Emirates ID. When evaluated against a person's credentials, it produces three typed Obligations — each with a status (Satisfied / AtRisk / Unsatisfied), a reason, and a reference to the satisfying credential (if any).

Obligations are span-covering, not point-in-time. A credential that expires tomorrow does not satisfy a 90-day obligation. Phase 6B approximates span as a 90-day forward window; full span alignment to Journey/assignment periods is deferred.

**Delivered:**
- `types/obligations.ts` — `ObligationStatus`, `Obligation`, `ObligationEvaluation`
- `protocols/onboardingProtocol.ts` — pure `evaluateOnboardingObligations(personID, credentials)` function
- `protocols/index.ts` — barrel export
- No UI — evaluation is available but not yet displayed

**What it unlocks:** Phase 6D can display a computed readiness evaluation.

---

## Phase 6C — Person-Owned Onboarding Journey ✅ COMPLETE

**Concept proven:** Journeys belong to Person, are initiated by operational decision, and are not owned by contracts or documents.

A Journey is the work that closes the gap. It has a lifecycle (Active → Completed / Suspended / Cancelled), an initiator, a reason, and an optional Contract reference. The `ContractID` field is present but explicitly not ownership — a Contract activation adds Protocol layers to an existing Journey; it does not create one.

**Delivered:**
- `types/journeys.ts` — `JourneyStatus`, `OnboardingJourney`, `InitiateJourneyInput`
- `IJourneyService` — `getActiveOnboardingJourney`, `listOnboardingJourneys`, `initiateOnboardingJourney`, `completeOnboardingJourney`
- `MockJourneyService` — three seed journeys matching credential state; write methods mutate in-memory store
- `SharePointJourneyService` — graceful stub (read: empty/null; write: throws, cannot safely no-op)
- `ServiceRegistry` extended: `journeys: IJourneyService`
- `useJourneyService`, `useOnboardingJourney`, `usePersonJourneys` hooks
- No UI — journey data is available but not yet displayed

**What it unlocks:** Phase 6D can show Journey context alongside the readiness evaluation.

---

## Phase 6D — Readiness Signal ✅ COMPLETE

**Concept proven:** Readiness is computed from real entity state — never stored, never manually maintained.

The Readiness tab on PersonProfile is the first point at which the Operational Model becomes visible. It answers: "Is this person operationally ready for onboarding?" — in real time, from current credential state.

**Delivered:**
- `components/shared/ReadinessPanel.tsx` — reusable; takes `ObligationEvaluation`; renders colored status header (Satisfied / AtRisk / Unsatisfied) and a non-interactive obligation list with status badges
- PersonProfile — Profile / Readiness tab system; Readiness tab shows Journey context (status, initiator, date) and Onboarding Obligations via `ReadinessPanel`
- `usePersonJourneys` — added after bug: `useOnboardingJourney` returned only Active journeys, causing Completed journeys (PER-0003) to show "No journey"; fixed by deriving: active first, else most recent
- Mock data — full replacement: production-quality team names, game titles, departments, roles, nationalities; placeholder persons replaced; duplicate PersonnelCode corrected

**Observable outcomes with mock data:**
| Person | Journey | Overall Readiness |
|---|---|---|
| Abdulaziz Alabdullatif | Active | At Risk (Visa expiring ~11d) |
| Mohammad Alkhalailah | Active | Unsatisfied (no Visa, no Emirates ID) |
| Diab Hassan | Completed | Satisfied (all three obligations met) |

---

## Remaining Phases

### Phase 6E — Error Boundaries (TD-010)

Wrap the application at two levels (app-level and screen-level) so a malformed SharePoint item cannot crash the whole application. Class component boundary with `title`, `description`, optional retry. Screen-level boundaries in `AppShell.tsx`.

**Depends on:** Nothing. **Priority:** Must-do before live data.

---

### Phase 6F — Fast Refresh Fix (TD-014)

Split `AppContext.tsx` and `HostContext.tsx` to separate component exports from non-component exports. Eliminates all 3 pre-existing ESLint `react-refresh/only-export-components` warnings and restores true hot reload for context providers.

**Depends on:** Nothing. **Priority:** Low effort, clean baseline for ongoing development.

---

### Phase 6G — Stage Transition Panel + Renewal Decision Panel (TD-006, TD-007)

Write operations using the form/mutation/feedback pattern established in Phase 5D. Require `flowBaseUrl` in `AppConfig`.

- `StageTransitionPanel` — advance contract stage with reason; entry point from ContractProfile
- `CaptureRenewalDecisionPanel` — capture Renew / Not Renewing / Pending decision; entry point from RenewalsCenter and ContractProfile

**Depends on:** Power Automate flow URL. **Priority:** High once URL is available.

---

### SharePoint Data Layer (Blocked)

Implementing `SharePointPersonService`, `SharePointAmendmentService`, and completing `SharePointContractService` requires SharePoint list access. All service stubs are in place. Blocked pending IT access.

---

## Sprint 6 Phase Summary

| Phase | Description | Status |
|---|---|---|
| 6A | Credential entity, service, hook, PersonProfile display | ✅ Complete |
| 6B | Protocol and Obligation evaluation | ✅ Complete |
| 6C | Person-owned Onboarding Journey | ✅ Complete |
| 6D | Readiness Signal — ReadinessPanel + PersonProfile Readiness tab | ✅ Complete |
| 6E | Error Boundaries | ⬜ Pending |
| 6F | Fast Refresh Fix | ⬜ Pending |
| 6G | Stage Transition + Renewal Decision Panels | ⬜ Blocked (needs flowBaseUrl) |
| — | SharePoint data layer | ⬜ Blocked (needs IT access) |

---

*Sprint 6 restructured: 2026-06-28*  
*Governing document: The Geekay Operational Model v2*  
*C3 Platform · Geekay Esports*
