# ADR-013 — Governance Approval Pattern

**Status:** Approved  
**Sprint:** Sprint 16 — People Integration (design); Sprint 18 — implementation begins  
**Date:** 2026-06-29  
**Author:** Architecture review — pre-Sprint 18 write-path preparation  
**Approved by:** Platform Owner — 2026-06-29

> **This ADR reached `Approved` status on 2026-06-29.** All six open decisions (Q1–Q6) have been resolved and are recorded in the Resolved Decisions section below. Sprint 18 implementation of the first governed write path (`initiateJourney`) may now proceed.

> **Meta-note:** This ADR is itself subject to the pattern it defines. Its progression from `Proposed → Approved` demonstrates the lifecycle in practice.

---

## Context

Sprints 1–17 implement C3 as a read-only intelligence platform. Data flows in one direction: SharePoint lists → C3 services → React UI. The platform reads credentials, contracts, people, journeys, and mission data; it computes gaps, generates work items, and surfaces readiness state. It writes nothing.

Starting Sprint 18, C3 will introduce write paths: Journey initiation, state transitions (complete, suspend, cancel), and obligation assignments. These are the first operations where C3 modifies production SharePoint data on behalf of ops staff.

Write operations carry risks that read operations do not:

**Audit risk.** A completed Journey moves a person's gap state from `Routed` to `Covered` or removes it entirely. If a Journey is incorrectly completed, the protocol engine stops flagging a real readiness gap — a person may appear ready who is not. This is a compliance exposure.

**Data integrity risk.** SharePoint lists are the system of record. An erroneous C3 write cannot be safely undone without ops staff manually reviewing and correcting the record. Unlike UI mistakes, a bad write persists across sessions and affects all users.

**Regulatory risk.** Geekay Esports operates under UAE labour law, visa and immigration regulations, and esports federation requirements. A credential gap that is incorrectly marked as resolved — even by accident — could result in a person traveling without valid documentation or competing outside eligibility rules.

**Permission risk.** Not all C3 users should be able to initiate or complete Journeys, assign obligations, or mark compliance records as satisfied. The current platform has a `C3Role` model (`viewer`, `operator`, `admin`, `owner`) but no enforcement of role-gated write operations.

These risks require a formal governance pattern before the first write path ships. This ADR establishes that pattern.

---

## The Governance Approval Pattern

### Lifecycle

Every proposed write operation in C3 moves through the following states:

```
Submitted
  │
  │  (Platform Owner or explicit delegate opens the review)
  ▼
InReview
  │
  ├──────────────────────────────────────┐
  │  (approved; ReviewedBy ≠ SubmittedBy)│  (rejected; RejectionReason recorded)
  ▼                                      ▼
Approved                             Rejected  ←── terminal; record immutable
  │
  │  (C3 executes the SharePoint write)
  │
  ├──────────────────────────────────────┐
  │  (write succeeds)                    │  (write fails)
  ▼                                      ▼
Executed  ←── terminal            ExecutionFailed  ←── terminal; explicit resolution required
```

**Draft state removed.** The original design included a `Draft` state visible only to the submitter. This is deferred — Sprint 18 panels submit directly, with no save-as-draft step. Draft support may be added in Sprint 19+ if operators request it.

### State definitions

| State | Meaning | SharePoint write state |
|---|---|---|
| `Submitted` | The submitter has formally submitted the operation for governance review. The Platform Owner is notified. | No write has occurred. |
| `InReview` | The Platform Owner (or explicit delegate) has opened the submission and is evaluating it. | No write has occurred. |
| `Approved` | The approval decision has been granted. `ReviewedBy` ≠ `SubmittedBy` confirmed. C3 is executing the SharePoint write. | Write execution is in progress or pending. |
| `Rejected` | The operation has been rejected. `RejectionReason` is recorded. The submitter is notified. | No write has occurred. Terminal. |
| `Executed` | The SharePoint operational write succeeded. The record reflects approved state. `ExecutedAt` is set. | Write complete. Terminal. |
| `ExecutionFailed` | Approval was granted but the SharePoint write failed. `ExecutionError` is populated. No operational record was created or mutated. Requires explicit resolution. | No write has occurred. Terminal — must not be silently ignored. |

**Critical distinctions:**

- `Approved` ≠ `Executed`. Approval is the governance decision. Execution is the SharePoint write. These are distinct states.
- `Executed` = operational truth. The SharePoint record exists and reflects the approved operation.
- `ExecutionFailed` = approval granted, write not completed. The operation must be re-triggered or restarted via a new proposal.
- `Rejected` records are immutable. They form the permanent audit trail of declined operations.

**Irreversibility:** Once a write reaches `Executed`, it cannot be undone through the approval pattern. Corrections require a new proposal moving through the full lifecycle. There is no rollback state.

---

## Known Decisions

The following are locked and not subject to further debate.

**Platform Owner holds final approval.** The `owner` C3Role is the sole authority for approving operational-truth-changing writes by default. Any delegation is explicit, recorded, and all-or-nothing in scope (Sprint 18 — see Resolved Decisions Q4).

**Submission is always allowed for authorised submitters.** Any user with a qualifying C3Role (`operator`, `admin`, or `owner`) may submit a proposed operation. Submission is not restricted by the submitter's identity relative to the approver. The Platform Owner may submit their own proposals.

**Self-approval is prohibited at the approval action.** The block applies when `ReviewedBy === SubmittedBy`. The system must enforce this check before advancing `ApprovalStatus` from `InReview` to `Approved`. If they match, the approval action fails with a recorded error; `ApprovalStatus` remains `InReview`. No write proceeds.

**Read operations never require a gate.** No read path — including `listPeople()`, `listJourneysForPerson()`, `listAllCredentials()`, or any diagnostic read — is subject to the approval lifecycle. The gate applies exclusively to write paths.

**Diagnostics writes are excluded.** High-frequency diagnostic log writes use a lighter confirmation pattern, not the full approval lifecycle. They carry no compliance surface.

**No operational-truth write may bypass ADR-013 in the C3 application layer.** There is no code path within C3 that writes to an operational SharePoint list without the approval gate. This constraint is enforced at the service layer, not the UI layer. Out-of-band direct SharePoint edits are a last resort, documented separately (see Resolved Decisions Q3), and are not a C3 application feature.

---

## Approval Authority

**Platform Owner (`owner` C3Role)** holds final approval authority for all C3 write operations.

The Platform Owner:
- Reviews all `Submitted` operations before any write executes
- May approve or reject with a recorded reason
- May submit their own proposals but may not approve them (self-approval prohibition — see Known Decisions)
- Is the only role that can advance a proposal from `InReview` to `Approved` or `Rejected`, unless explicit delegation is in effect

**Delegation (Sprint 18 model — all-or-nothing):**
- Delegation is explicit and recorded — `DelegatedBy` carries the `owner` identity; `DelegateTo` carries the delegate identity
- A delegate may approve any operation type. Scoped delegation (per operation type) is deferred to Sprint 19+
- Delegation must be established before the approval action, not retroactively
- Self-approval prohibition applies equally to delegates — `ReviewedBy` must still differ from `SubmittedBy` even when a delegate is acting

**Escalation (notification only):**
- Escalation to `admin` role is a notification signal, not an authority transfer
- `admin` does not gain approval capability through escalation. See Resolved Decisions Q1 for timeout policy.

**Role matrix for write operations:**

| C3Role | Submit | Review | Approve | Execute Write |
|---|---|---|---|---|
| `viewer` | No | No | No | No |
| `operator` | Yes | No | No | No |
| `admin` | Yes | No | No | No |
| `owner` | Yes (cannot self-approve) | Yes | Yes | No — write is automatic upon `Approved` |
| explicit delegate | Yes (cannot self-approve) | Yes | Yes (within delegation scope) | No |

The write execution itself is automated — no human manually executes the SharePoint call after approval. The `Approved` state unlocks execution; C3 performs the write and advances to `Executed` or `ExecutionFailed`.

---

## Operations Subject to the Approval Gate

All operations that modify SharePoint data are subject to the approval gate. Sprint 18 scope is limited to `initiateJourney` only. The full planned scope is listed below for governance record.

**Journey operations:**

| Operation | Sprint 18? | Risk if wrong |
|---|---|---|
| Initiate Journey | **Yes — Sprint 18 only** | Creates a governance record; person appears as `Routed` in Situation Room |
| Complete Journey | Sprint 19 | Removes person from active monitoring; gaps may no longer surface |
| Suspend Journey | Sprint 19 | May mask a genuine urgency if applied prematurely |
| Cancel Journey | Sprint 19 | Removes routing entirely; person may appear `Unrouted` |
| Add/Update Obligation Assignment | Sprint 19 | Gap moves from `Routed` to `Covered` — incorrect assignment hides a real gap |

**Future write paths — governance record only:**

| Operation | Planned Sprint |
|---|---|
| Credential create / renew | Sprint 20+ |
| Credential deactivate | Sprint 20+ |
| Contract milestone update | Sprint 19+ |
| Person record update | Sprint 19+ |

---

## Operations Excluded from the Approval Gate

The following are not subject to the approval gate:

- All read operations (no gate ever applies to reads — see Known Decisions)
- Diagnostics log writes (excluded — see Known Decisions)
- User preference writes (UI state only, no compliance surface)
- Platform configuration (managed separately through SharePoint site settings, not through C3 UI)

---

## Audit Trail Requirements

Every approval gate lifecycle event must be recorded with:

- Timestamp (UTC ISO 8601)
- Actor identity (email or display name)
- Operation type and target (e.g. `InitiateJourney` for `PER-0003`)
- State transition (e.g. `Submitted → InReview`)
- Reason (required for `Rejected`; optional for `Approved`)
- `ExecutionError` (required for `ExecutionFailed`)

The audit record is immutable once written. It may not be deleted through any C3 interface.

**Retention:** Audit records are retained for the lifetime of the platform. They are not subject to the `IsActive` filtering that applies to operational records.

---

## Implementation Constraints

These are enforced constraints for all Sprint 18 and later write-path implementations.

**1. No write bypasses the gate.** There is no direct-write code path in C3 that skips the approval lifecycle. The approval gate is enforced at the service layer, not the UI layer. A UI that is bypassed (e.g. by API call or direct service call) does not bypass the gate.

**2. Approval state lives in SharePoint.** The approval record is stored in `C3Approvals` (a dedicated SharePoint list), not in memory. This ensures the audit trail survives app restarts, session timeouts, and multi-user concurrent access.

**3. Optimistic execution is prohibited.** C3 does not optimistically apply the write before `Approved` state is recorded. The write only executes after `Approved` is persisted to `C3Approvals`. There is no undo.

**4. `Approved` ≠ `Executed`.** The service must distinguish between the approval decision (`Approved`) and the execution outcome (`Executed` / `ExecutionFailed`). Both states must be persisted to `C3Approvals`. A write that reaches `Approved` but fails to reach `Executed` is an `ExecutionFailed` and must not be silently treated as successful.

**5. The gate applies to the intent, not the data.** The `Payload` field in `C3Approvals` captures what the op intends to do and why — not just the raw SharePoint field values. The approver reviews intent and context, not raw JSON.

**6. Self-approval is enforced at the service layer.** The service checks `ReviewedBy !== SubmittedBy` before executing the approval action. A matching identity blocks the approval and returns a clear error. This check is not optional and cannot be skipped via UI state.

**7. Platform Owner notification is synchronous on submission.** When a proposal reaches `Submitted`, the Platform Owner is notified before the submitter's session ends. The notification mechanism is an in-app badge (minimum for Sprint 18); Power Automate email is an enhancement for Sprint 19+.

**8. `ExecutionFailed` requires explicit resolution.** An `ExecutionFailed` record must not be auto-retried or silently discarded. The Platform Owner must be surfaced the failure. Resolution options are: re-trigger execution (if the failure was transient) or restart with a new proposal.

**9. Mock mode is gate-free by design.** In mock mode, `initiateJourney()` and all other write methods write to in-memory state directly with no approval gate. The gate applies exclusively to the SharePoint service implementations. This is intentional — mock mode supports local development and testing without requiring the `C3Approvals` list to exist.

---

## Resolved Decisions

All six open decisions from the `Proposed` draft are resolved below. These decisions were confirmed by the Platform Owner on 2026-06-29 and supersede the option lists in the original draft.

---

**Q1 — Approval timeout policy**

**Decision:** 3 business days without `owner` action → escalation notification sent to `admin` role. If no `owner` action for a further 2 business days → auto-reject with notification to submitter.

**Rules:**
- Escalation to `admin` is a notification signal only. `admin` does not gain approval authority through escalation.
- `owner` retains sole approval authority throughout the timeout period unless explicit delegation (Q4) is in effect.
- Auto-reject sets `ApprovalStatus: Rejected` with `RejectionReason: "Auto-rejected: approval timeout after 5 business days"`.
- The timeout clock pauses if the proposal enters `InReview` state (i.e. the Platform Owner has opened it). Auto-reject applies only if the proposal remains in `Submitted` without any owner action.

---

**Q2 — Batch approvals**

**Decision:** Individual approvals only for Sprint 18. Each proposal is reviewed and actioned independently.

**Rules:**
- The `ApprovalGatePanel` presents one pending operation at a time in Sprint 18.
- Batch approval capability is deferred to Sprint 19+ once the single-record flow is proven in production.
- The `C3Approvals` list schema does not need to accommodate batch grouping for Sprint 18.

---

**Q3 — Emergency bypass**

**Decision:** No automated break-glass mechanism in Sprint 18. Urgent approvals go through the standard owner approval panel (which is available immediately — there is no artificial delay in the approval UI).

**Out-of-band fallback (last resort only):**
- If the Platform Owner is genuinely unavailable and a time-critical operation cannot wait for approval, a direct SharePoint edit may be made by an authorised IT administrator.
- Any out-of-band action of this kind requires a manual post-hoc audit entry to be added to `C3Approvals` within 24 hours of the action, with `OperationType`, `TargetID`, `SubmittedBy` (the person who acted), `ApprovalStatus: Executed`, and `Reason` noting the out-of-band justification.
- Out-of-band actions are not a C3 application feature. C3 has no UI or service method to record or facilitate them. They are an operational escape valve only.
- Abuse of the out-of-band path is subject to the same operational accountability as any direct SharePoint modification.

---

**Q4 — Delegation scope**

**Decision:** All-or-nothing delegation for Sprint 18. A named delegate may approve any operation type.

**Rules:**
- Delegation is explicit: `DelegatedBy` carries the `owner` identity; `DelegateTo` carries the delegate identity. Both fields are recorded on the `C3Approvals` item at approval time.
- Delegation must be established before the approval action. Retroactive delegation is not permitted.
- Scoped delegation (per operation type, time-bounded) is deferred to Sprint 19+.
- Self-approval prohibition applies equally to delegates: `ReviewedBy` must differ from `SubmittedBy` even when the delegate is acting.
- Delegation does not persist across proposals. Each proposal where a delegate acts must carry `DelegatedBy` and `DelegateTo` on that record. There is no standing delegation configuration in Sprint 18 — delegation is recorded per-approval-action.

---

**Q5 — C3Approvals list schema**

**Decision:** The 16-column schema below is approved as the starting point for Sprint 18. The full schema document (`C3Approvals SP List Schema.md`) will be authored in Sprint 18 Phase 1.

| Column (Display Name) | SP Internal Name | SP Type | Notes |
|---|---|---|---|
| Title (rename: ApprovalID) | `Title` | Single line text | Custom ID format: APR-NNNN |
| Operation Type | `OperationType` | Choice | Values: InitiateJourney, CompleteJourney, SuspendJourney, CancelJourney, AddCredential, DeactivateCredential |
| Target ID | `TargetID` | Single line text | FK to target record (e.g. JRN-NNNN); blank for new-record operations before ID is assigned |
| Target Person ID | `TargetPersonID` | Single line text | FK to C3People PersonID |
| Submitted By | `SubmittedBy` | Single line text | Login name or display name of submitter |
| Submitted At | `SubmittedAt` | Date and Time | UTC ISO |
| Approval Status | `ApprovalStatus` | Choice | Submitted / InReview / Approved / Rejected / Executed / ExecutionFailed |
| Reviewed By | `ReviewedBy` | Single line text | Identity of approver or rejecter — must differ from SubmittedBy |
| Reviewed At | `ReviewedAt` | Date and Time | UTC ISO; null until reviewed |
| Executed At | `ExecutedAt` | Date and Time | UTC ISO; set when SP operational write succeeds |
| Execution Error | `ExecutionError` | Multi-line text | Error detail when ApprovalStatus = ExecutionFailed; null otherwise |
| Delegated By | `DelegatedBy` | Single line text | Owner identity when delegation is in effect; null for direct approvals |
| Delegate To | `DelegateTo` | Single line text | Delegate identity who reviewed; null when no delegation |
| Reason | `Reason` | Multi-line text | Optional context from submitter |
| Rejection Reason | `RejectionReason` | Multi-line text | Required on Rejected; null otherwise |
| Payload | `Payload` | Multi-line text | Serialised JSON of the proposed write input (e.g. InitiateJourneyInput fields) |

**Reserved-word note:** `ApprovalStatus` is used as the internal name (not `Status`) to avoid SP reserved-word collision — same class of issue as the `JourneyType` correction in Sprint 17.

---

**Q6 — Rejection re-submission**

**Decision:** Re-submission creates a new proposal. The rejected `C3Approvals` record is immutable.

**Rules:**
- A rejected proposal may not be revised or mutated. `ApprovalStatus: Rejected` is a terminal state.
- The submitter creates a fresh proposal through the normal submission flow.
- UX may pre-populate the new proposal form from the rejected record as a convenience (e.g. carry forward `Reason`, `Payload` fields). This is a UX nicety — it does not modify the original record.
- The new proposal receives a new `ApprovalID` and is evaluated independently.

---

## Consequences

**What is now true (ADR status: Approved):**

- No C3 write path may be implemented without the Approval Gate in place
- Sprint 18 implementation scope includes the `C3Approvals` list, the approval service, the notification mechanism, and the approval UI — these are preconditions for any Journey write, not add-ons
- The Sprint 18 baseline document must include gate passage criteria for the Approval Gate itself (the approval flow must be tested before any operational write is attempted)
- `initiateJourney` is the only write operation in Sprint 18 scope. All other write paths require separate sprint-level approval

**What does not change:**

- Sprints 1–17 remain read-only. This ADR has no retroactive effect.
- The mock service continues to support write operations locally (no gate in mock mode) — this is by design. The gate applies to the SharePoint service layer only.
- ADR-002 (SharePoint Read / Power Automate Write Pattern) predates this ADR. ADR-013 supersedes ADR-002's write guidance for direct C3 write operations. Power Automate flows remain an option for non-interactive background writes but are out of scope for Sprint 18.

---

## ADR Progression

| State | Date | Actor | Notes |
|---|---|---|---|
| Proposed | 2026-06-29 | Architecture review | Initial draft — design only; open decisions Q1–Q6 outstanding |
| Approved | 2026-06-29 | Platform Owner | All Q1–Q6 resolved; approved for Sprint 18 governed `initiateJourney` implementation |
