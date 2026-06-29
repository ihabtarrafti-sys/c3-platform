# ADR-003 — Journey Definition

**Status:** Accepted  
**Sprint:** Sprint 14 — Architecture Hardening  
**Date:** 2026-06-29  
**Author:** Architecture review — post-Sprint 13

---

## Context

Journey is the platform's oldest routing concept. It has accumulated three distinct responsibilities across eight sprints without a single written definition:

- An **accountability record** — evidence that someone is engaged with a person's operational readiness
- A **workflow container** — a vehicle for tracking what type of operational process is underway
- An **obligation coverage signal** — when combined with `obligationAssignments`, the means by which a gap moves from Routed to Covered

This ADR defines what a Journey is, answers the questions the code leaves open, and identifies where decisions are still outstanding and require operator validation.

---

## The Seven Questions

### 1. What is a Journey?

A Journey is an **operational engagement record** — evidence that ops staff have accepted accountability for a specific person reaching a defined readiness state. It records who initiated the engagement, what type of process is underway, who holds governance accountability, and (optionally) who holds execution responsibility for specific obligations.

A Journey does not track individual tasks, documents, or steps. It tracks the existence and governance of the engagement as a whole.

**One sentence:** A Journey is the formal record that Geekay is actively working to get a person ready.

---

### 2. What is the lifecycle of a Journey?

```
(created)
    │
    ▼
  Active ──────────────────────────────┐
    │                                   │
    ├─→ Completed  (normal completion)  │
    │                                   │
    ├─→ Suspended  (temporary block)    │
    │       │                           │
    │       ├─→ Active   (resumed)      │
    │       └─→ Cancelled               │
    │                                   │
    └─→ Cancelled  (abandoned)  ←───────┘
```

A Journey is created via `initiateJourney()` and begins in `Active` state. State transitions are explicit operator actions — no automatic state advancement occurs.

**What "complete" means:** The underlying readiness gap has been resolved. The person's credential(s) are now valid and obligations are satisfied. Completing a Journey does not directly modify credentials — it records that the work is done. Gap computation reflects this automatically because the protocol re-evaluates against credentials on each render.

**What "suspend" means:** The Journey is paused due to an external blocker (e.g., waiting for a government authority to issue a document). The gap remains open. The Journey can be resumed when the blocker clears or cancelled if the situation changes.

**Key constraint:** Completed and Cancelled Journeys are never deleted. They form an audit trail of engagement history for each person.

---

### 3. Can a person have multiple concurrent Journeys?

**Yes — by type.** The rule is: at most one `Active` Journey of each `JourneyType` per person at any time.

The five Journey types are: `Onboarding`, `VisaRenewal`, `TeamTransfer`, `ContractRenewal`, `Offboarding`.

A person may simultaneously have:
- One Active `Onboarding` Journey (new signing, credential establishment)
- One Active `VisaRenewal` Journey (specific credential renewal in progress)

They may not have:
- Two Active `Onboarding` Journeys (only one is meaningful; the first must be resolved before a second can begin)

**Current implementation:** The `IJourneyService.getActiveJourney(personId, type)` interface enforces the per-type uniqueness contract at the service layer. The existing `listAllActiveJourneys` call filters by `'Onboarding'` only — the gap computation hooks do not yet fetch other Journey types.

**Open question — requires operator validation:** When a person has both an Onboarding Journey (general readiness) and a VisaRenewal Journey (specific credential), which Journey's `obligationAssignments` takes precedence for the visa obligation? Currently, only Onboarding Journeys are fetched — this question only becomes live when multi-type Journey fetching is added.

---

### 4. How does a Journey relate to a Mission?

A Journey carries an optional `MissionID` field. When present, this field records that the Journey was initiated because a Mission surfaced the gap — typically because the operator was reviewing the Mission scope in the Situation Room.

This linkage is **informational only and does not scope the Journey to the Mission.**

The Journey remains a general credential readiness workflow for the person. A Journey opened in the context of SATR/2026/003 may resolve a Travel credential that also satisfies TR/2026/006. The Mission linkage records *why the Journey was opened*, not *what the Journey covers*.

**Why this design:** Mission-scoped obligations derive from the Mission's participant list and the ADR-002 activation gate. The Journey is the accountability and routing mechanism — it is deliberately Mission-agnostic so that resolving a credential gap in one Mission context doesn't create a separate Journey when the same gap is surfaced in another Mission.

---

### 5. What does it mean for a Journey to "cover" an obligation?

Coverage is a three-state model (OwnershipState in `situation.ts`):

| State | Condition | What it means |
|---|---|---|
| `Unrouted` | No active Journey for this person | No accountability. Gap needs routing. |
| `Routed` | Active Journey exists with `AssignedTo` set | Someone is engaged. Coverage for this specific obligation is not declared. |
| `Covered` | Active Journey exists AND `obligationAssignments` contains a matching entry | This specific obligation is explicitly owned. Execution responsibility is named. |

A Journey covers a specific obligation when:
1. The Journey is `Active` (Suspended or Completed do not produce coverage)
2. `Journey.obligationAssignments` contains an `ObligationAssignment` where `obligationType === obligation.satisfiedByCapability`

The `assignedTo` field on the matching `ObligationAssignment` becomes the gap's `assignedTo` — it overrides the journey-level governance owner for that specific obligation.

**Distinction:** `Journey.AssignedTo` is the governance owner — accountable for the person being ready overall. `ObligationAssignment.assignedTo` is the execution owner — responsible for satisfying one specific requirement (e.g., the PRO Coordinator who will process the visa).

---

### 6. What operator action creates a Journey, and what creates an obligation assignment?

**Creating a Journey:** `initiateJourney(input)` — an explicit operator decision, currently exposed via the StartJourneyPanel in the Situation Room. A Journey is not created automatically. It reflects a human decision to engage with a person's readiness.

**Creating an obligation assignment within a Journey:**

This is currently possible only at Journey initiation — `InitiateJourneyInput.obligationAssignments` allows recording assignments when the Journey is started. There is **no update path** in the current `IJourneyService` interface. `IJourneyService` has no `addObligationAssignment`, `updateObligationAssignment`, or `assignObligation` method.

**Consequence:** Covered state is achievable today only for obligations assigned at Journey initiation. An operator who initiates a Journey and later realises they need to explicitly assign a specific obligation has no current path to do so via the UI.

**Decision required before SharePoint integration:** Does `obligationAssignments` need an explicit `addObligationAssignment(journeyId, assignment)` mutation? If yes, this requires:
- A new method on `IJourneyService`
- A UI surface (e.g., an obligation assignment panel within the Journey detail)
- A SharePoint write path (the most complex part)

For the SharePoint integration, the obligation assignments storage model also needs to be decided (see Question 7).

**Operator validation pending:** Whether operators actually need to assign obligations post-initiation, or whether assigning at initiation is sufficient for real workflows, has not been validated with Geekay operations staff.

---

### 7. What is the minimum SharePoint list schema required for Journey persistence?

Two SharePoint lists are required.

#### List 1: Journeys

| Column | SP Type | C3 Field | Notes |
|---|---|---|---|
| `Title` (rename: JourneyID) | Single line text | `JourneyID` | Custom ID format: JRN-0007 |
| `PersonID` | Single line text | `PersonID` | FK to People list |
| `Type` | Choice | `Type` | Values: Onboarding, VisaRenewal, TeamTransfer, ContractRenewal, Offboarding |
| `Status` | Choice | `Status` | Values: Active, Completed, Suspended, Cancelled |
| `InitiatedAt` | Date and Time | `InitiatedAt` | ISO format; store as UTC |
| `InitiatedBy` | Single line text | `InitiatedBy` | UserID or display name |
| `AssignedTo` | Single line text | `AssignedTo` | Optional — governance owner |
| `InitiationReason` | Multi-line text | `InitiationReason` | Optional |
| `ContractID` | Single line text | `ContractID` | Optional FK |
| `MissionID` | Single line text | `MissionID` | Optional FK to Missions list |
| `CompletedAt` | Date and Time | `CompletedAt` | Null until Completed state |
| `Notes` | Multi-line text | `Notes` | Optional |

#### List 2: JourneyObligationAssignments (preferred over JSON column)

Storing `obligationAssignments` as a related list is preferred over a JSON multi-line text column on the Journeys list. Reasons:

- Queryable independently (e.g., "which journeys cover Travel obligations")
- Editable without deserialising and reserialising JSON
- Consistent with SP's relational model

| Column | SP Type | C3 Field | Notes |
|---|---|---|---|
| `JourneyID` | Single line text | FK to Journey | Index this column |
| `ObligationType` | Choice | `obligationType` | Values: Identity, Travel, RightToWork, RightToReside, CompetitionEligibility, TransferEligibility, HealthCoverage, HealthClearance, FinancialAccess |
| `Requirement` | Single line text | `requirement` | Audit trail label |
| `AssignedTo` | Single line text | `assignedTo` | Execution owner |
| `AssignedAt` | Date and Time | `assignedAt` | ISO format; store as UTC |

**Query pattern:** `listAllActiveJourneys()` → one batch query on Journeys filtered by `Status eq 'Active'`. A second batch query on JourneyObligationAssignments returns all entries for the fetched journey IDs. The service joins them in memory before returning `Journey[]` with `obligationAssignments` populated.

**Alternative (simpler for v1):** Store `obligationAssignments` as serialised JSON in a multi-line text column on the Journeys list. Loses queryability and editability but eliminates the second list and the join. Acceptable if `addObligationAssignment` remains out of scope and assignments are set only at Journey initiation.

---

## Decisions Made

1. **Journey is accountable engagement, not task tracking.** A Journey does not track individual tasks or document submissions. It records the existence of the engagement and who is responsible.

2. **One Active Journey per type per person.** Multiple concurrent Journey types are permitted; multiple concurrent Journeys of the same type are not.

3. **MissionID on Journey is informational only.** It records why the Journey was opened; it does not scope the Journey to a Mission.

4. **Covered requires an Active Journey with a matching obligationAssignment.** Suspended journeys do not produce coverage.

5. **Journey.AssignedTo is governance; ObligationAssignment.assignedTo is execution.** These are distinct concepts and distinct fields.

6. **ObligationAssignments should be stored as a separate SP list.** JSON column on Journeys is acceptable as a v1 simplification but should not be the long-term schema.

---

## Open Questions (Require Operator Validation)

A. **Do operators need to add obligation assignments after Journey initiation?** If yes, `IJourneyService` needs `addObligationAssignment()` and the UI needs an obligation assignment panel.

B. **When a person has multiple active Journey types, which takes precedence for obligation assignment matching?** Currently only Onboarding Journeys are fetched. Once multi-type fetching is added, a conflict resolution rule is needed.

C. **When should operators suspend vs. cancel a Journey?** The distinction exists in the type but its operational semantics have not been validated. Are both states observable in the Situation Room? Does Suspended produce different gap display than Active?

D. **What is the maximum concurrent Journey count for one person in practice?** The architecture permits multiple types concurrently, but whether operators will realistically run two Journey types simultaneously for the same person is unknown.
