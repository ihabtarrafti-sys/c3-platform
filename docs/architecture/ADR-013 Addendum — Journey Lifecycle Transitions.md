# ADR-013 Addendum — Journey Lifecycle Transitions

**Sprint:** 19 Phase 2  
**Date:** 2026-07-01  
**Status:** Adopted  
**Relates to:** `docs/adr/ADR-013-Governance-Approval-Pattern.md`

---

## Context

ADR-013 established the governance approval pattern for C3 operational writes:

> All operational writes to SharePoint that create new governance artifacts must go through the C3 approval lifecycle: Submitted → InReview → Approved/Rejected → Executed/ExecutionFailed.

This pattern governs `initiateJourney` — the creation of a new C3Journeys record. Journey initiation is a governance origination event: it declares that a person is subject to an operational readiness workflow, assigns an owner, and creates a durable audit artifact. Independent review (the Approved step) is warranted before this record is created.

Sprint 19 Phase 2 introduces four lifecycle transition operations on existing Journeys: **Complete, Suspend, Resume, and Cancel**. This addendum documents why these operations are exempt from the ADR-013 approval gate and defines the governance model that applies to them instead.

---

## Decision

**Journey lifecycle transitions (Complete, Suspend, Resume, Cancel) are direct role-gated operational actions and are not subject to the ADR-013 approval workflow.**

---

## Rationale

### 1. Governance origination vs. lifecycle management are distinct categories

ADR-013's approval gate exists to prevent unauthorized creation of governance artifacts. The approval step answers: *should this journey exist at all?* Once a journey has been initiated through the governed path (Submitted → Approved → Executed), the governance question has been answered. The journey exists and is valid.

Lifecycle transitions update the state of an already-authorized record. They answer a different question: *is this journey currently active, paused, or finished?* This is operational lifecycle management, not governance origination.

### 2. The IJourneyService interface signals direct-action design intent

All three original stub signatures in `IJourneyService` (`completeJourney`, `suspendJourney`, `cancelJourney`) took only `journeyId` — no approval payload, no governance wrapper. The interface was authored without approval intermediary, consistent with direct operational action.

`approvalPayloads.ts` contains one entry (`InitiateJourneyApprovalPayload`) and its comment reads: *"Future operation types add their payload interfaces here."* This extension point anticipates future governed operations — not lifecycle management of existing ones.

### 3. An approval loop over lifecycle management is operationally unworkable

Requiring approval-to-approve-lifecycle-change creates a layered approval dependency for routine operations:

- Suspend a journey waiting for documents → submit a new approval → wait for an independent owner to review → execute suspension.

This is disproportionate overhead for time-sensitive operational decisions (e.g. pausing a journey while a visa application is pending). The operational cost exceeds the governance benefit.

### 4. The Mock service confirms the intended pattern

`MockJourneyService` implemented all three transitions as direct state updates from the outset. No approval intermediary was introduced. This is the reference implementation.

---

## Governance Model: Direct Role-Gated Action

### Authorized roles

| Role | May manage journey lifecycle |
|---|---|
| `owner` | Yes |
| `operations` | Yes |
| `management` | No (read-only on journeys) |
| `hr` / `legal` / `finance` | No |
| `visitor` | No |

The role check in the UI (`canManageJourneyLifecycle`) is:
```ts
currentUser.c3Role === 'owner' || currentUser.c3Role === 'operations'
```

The service layer enforces fail-close on empty `actorLoginName` before any write.

### Valid transitions

| From \ To | Active | Completed | Suspended | Cancelled |
|---|---|---|---|---|
| **Active** | — | completeJourney | suspendJourney | cancelJourney |
| **Suspended** | resumeJourney | — | — | cancelJourney |
| **Completed** | — | — | — | — |
| **Cancelled** | — | — | — | — |

`InvalidTransitionError` is thrown (service-side, before any write) when the requested transition is not valid for the current status.

### Audit trail (beta)

Lifecycle transitions append a structured line to the Journey's existing `Notes` field:

```
[ISO_TIMESTAMP] ACTION by LOGINNAME[ — reason]
```

Examples:
```
[2026-07-01T10:32:00Z] COMPLETED by owner@geekay.gg
[2026-07-01T14:10:00Z] SUSPENDED by ops@geekay.gg — waiting for visa documentation
[2026-07-01T16:05:00Z] RESUMED by ops@geekay.gg
[2026-07-01T18:30:00Z] CANCELLED by owner@geekay.gg — journey no longer required
```

The actor login is required (`actorLoginName` is validated non-empty before any PATCH write). An audit line is never written with an empty actor.

### Deferred: dedicated audit columns

The `C3Journeys` SP list does not currently have `SuspendedAt`, `CancelledAt`, `SuspensionReason`, or `CancellationReason` columns. The `Notes` append pattern is the audit bridge for the beta period.

Sprint 20 schema work should add these columns and migrate the service layer to write structured fields rather than appending to `Notes`. Until then, the `Notes` field must not be overwritten on lifecycle transitions — only appended to.

---

## SP Write Pattern

```
1. GET item by Title (JourneyID): reads current Status and Notes from C3Journeys
2. Validate transition: throw InvalidTransitionError if Status does not allow the action
3. Fail-close: throw if actorLoginName is empty
4. Build PATCH payload:
   - Complete:  { Status: 'Completed', CompletedAt: ISO_NOW, Notes: APPENDED }
   - Suspend:   { Status: 'Suspended', Notes: APPENDED }
   - Resume:    { Status: 'Active',    Notes: APPENDED }
   - Cancel:    { Status: 'Cancelled', Notes: APPENDED }
5. Fetch fresh X-RequestDigest (never cached)
6. PATCH via POST + X-HTTP-Method: MERGE + IF-MATCH: *
7. Return constructed Journey (base from GET, fields overridden with patch values)
```

---

## Beta Risk Acknowledgement

This addendum documents a deliberate exemption from ADR-013 for lifecycle management operations. The exemption applies **during the beta period only** under the following conditions:

- Lifecycle transitions are restricted to `owner` and `operations` roles.
- Every transition is recorded in the `Notes` audit trail with the actor login name.
- `initiateJourney` continues to be governed by the ADR-013 approval gate without exception.
- This addendum is retained as the auditable rationale for any future audit finding that lifecycle transitions bypass the approval workflow.

Future policy review may extend the approval gate to Cover or Cancel transitions if operational risk increases. This decision is deferred to Sprint 20+.

---

## Files

| File | Role |
|---|---|
| `packages/c3/src/services/errors.ts` | `InvalidTransitionError` definition |
| `packages/c3/src/services/interfaces/IJourneyService.ts` | `JourneyTransitionRequest`, guard functions, updated method signatures |
| `packages/c3/src/services/mock/MockJourneyService.ts` | Mock implementation with guards and Notes audit |
| `packages/c3/src/services/sharepoint/SharePointJourneyService.ts` | SP implementation (GET→guard→MERGE) |
| `packages/c3/src/hooks/useCompleteJourney.ts` | Mutation hook |
| `packages/c3/src/hooks/useSuspendJourney.ts` | Mutation hook |
| `packages/c3/src/hooks/useResumeJourney.ts` | Mutation hook |
| `packages/c3/src/hooks/useCancelJourney.ts` | Mutation hook |
| `packages/c3/src/screens/PersonProfile.tsx` | UI: journey actions (role-gated), confirm dialogs |
