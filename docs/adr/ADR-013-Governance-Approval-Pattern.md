# ADR-013 — Governance Approval Pattern

**Status:** Proposed  
**Sprint:** Sprint 16 — People Integration (design only)  
**Date:** 2026-06-29  
**Author:** Architecture review — pre-Sprint 18 write-path preparation

> **This ADR must reach `Approved` status before any C3 write-path implementation begins.** The Platform Owner (`owner` C3Role) holds final approval. Implementation is planned for Sprint 18. This document is intentionally design-only — no source code, no UI components, no Power Automate flows.

> **Meta-note:** This ADR is itself subject to the pattern it defines. Its progression from `Proposed → Approved` demonstrates the lifecycle in practice.

---

## Context

Sprints 1–16 implement C3 as a read-only intelligence platform. Data flows in one direction: SharePoint lists → C3 services → React UI. The platform reads credentials, contracts, people, journeys, and mission data; it computes gaps, generates work items, and surfaces readiness state. It writes nothing.

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
Draft
  │
  │  (ops staff submits the proposed action)
  ▼
Submitted
  │
  │  (Platform Owner or delegate reviews)
  ▼
In Review
  │
  ├──────────────────────────────────────┐
  │  (approved)                          │  (rejected)
  ▼                                      ▼
Approved                             Rejected
  │                                      │
  │  (C3 executes the write)             │  (no write occurs; reason recorded)
  ▼                                      ▼
Operational Truth               Rejection Archived
```

**State definitions:**

| State | Meaning |
|---|---|
| `Draft` | The proposed operation has been composed but not submitted for review. Visible only to the submitter. No SharePoint write has occurred. |
| `Submitted` | The submitter has formally submitted the operation for governance review. The Platform Owner is notified. No SharePoint write has occurred. |
| `In Review` | The Platform Owner has opened the submission and is evaluating it. No SharePoint write has occurred. |
| `Approved` | The Platform Owner has approved the operation. C3 executes the SharePoint write. The approval is recorded with timestamp and approver identity. |
| `Rejected` | The Platform Owner has rejected the operation. No SharePoint write occurs. The rejection reason is recorded. The submitter is notified. |
| `Operational Truth` | The write has been executed and the SharePoint record reflects the approved state. The approval record is retained as permanent audit history. |

**Irreversibility:** Once a write reaches `Operational Truth`, it cannot be undone through the approval pattern. Corrections require a new proposal moving through the full lifecycle. There is no rollback button.

---

## Known Decisions

The following are locked and not subject to the open questions below.

**Platform Owner holds final approval.** The `owner` C3Role is the sole authority for approving operational-truth-changing writes. This is not delegated by default. Any delegation is explicit, time-bounded, and recorded (see Open Decisions — Q4).

**Self-approval is prohibited.** The system must verify that the approver identity differs from the submitter identity before executing a write. If they match, the approval is blocked with a recorded error.

**Read operations never require a gate.** No read path — including `listPeople()`, `listJourneysForPerson()`, `listAllCredentials()`, or any diagnostic read — is subject to the approval lifecycle. The gate applies exclusively to write paths.

**Diagnostics writes are excluded.** High-frequency diagnostic log writes use a lighter confirmation pattern, not the full approval lifecycle. They carry no compliance surface.

**Sprint 16 is design-only.** No approval UI, no Power Automate flows, no write operations, and no `C3Approvals` SharePoint list are created in Sprint 16. This ADR must reach `Approved` status during Sprint 16 before Sprint 18 implementation begins.

---

## Approval Authority

**Platform Owner (`owner` C3Role)** holds final approval authority for all C3 write operations.

The Platform Owner:
- Reviews all `Submitted` operations before any write executes
- May approve or reject with a recorded reason
- May not approve their own submissions (self-approval is prohibited — see Known Decisions)
- Is the only role that can advance a proposal from `In Review` to `Approved` or `Rejected`

**Delegation:** Pending resolution of Open Decision Q4 below.

**Role matrix for write operations:**

| C3Role | Submit | Review | Approve | Execute Write |
|---|---|---|---|---|
| `viewer` | No | No | No | No |
| `operator` | Yes | No | No | No |
| `admin` | Yes | No | No | No |
| `owner` | Yes (with self-approval prohibition) | Yes | Yes | No (write is automatic upon approval) |

The write execution itself is automated — no human manually executes the SharePoint call after approval. The approval unlocks the execution; C3 performs the write.

---

## Operations Subject to the Approval Gate

All operations that modify SharePoint data are subject to the approval gate. In the initial write-path implementation (Sprint 18), the following operations are in scope:

**Journey operations:**

| Operation | Trigger | Risk if wrong |
|---|---|---|
| Initiate Journey | Ops staff opens a new engagement for a person | Creates a governance record; person appears as `Routed` in Situation Room |
| Complete Journey | Ops staff marks engagement as finished | Removes person from active monitoring; gaps may no longer surface |
| Suspend Journey | Ops staff pauses engagement | Correct but may mask a genuine urgency if applied prematurely |
| Cancel Journey | Ops staff abandons engagement | Removes routing entirely; person may appear `Unrouted` |
| Add/Update Obligation Assignment | Ops staff assigns an obligation to an owner | Gap moves from `Routed` to `Covered` — incorrect assignment hides a real gap |

**Future write paths (not Sprint 18 — noted for governance planning):**

| Operation | Planned Sprint |
|---|---|
| Credential create / renew | Sprint 20+ |
| Credential deactivate | Sprint 20+ |
| Contract milestone update | Sprint 19+ |
| Person record update | Sprint 18+ |

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
- Operation type and target (e.g. "Complete Journey JRN-0007 for PER-0003")
- State transition (e.g. `Submitted → In Review`)
- Reason (required for `Rejected`; optional for `Approved`)

The audit record is immutable once written. It may not be deleted through any C3 interface.

**Retention:** Audit records are retained for the lifetime of the platform. They are not subject to the `IsActive` filtering that applies to operational records.

---

## Implementation Constraints (Design Principles)

These are design constraints for Sprint 18 implementation. No code is written in this ADR.

**1. No write bypasses the gate.** There is no direct-write code path that skips the approval lifecycle. The approval gate is not a UI layer that can be bypassed by API calls — it is enforced at the service layer.

**2. Approval state lives in SharePoint.** The approval record is stored in a dedicated SharePoint list (`C3Approvals`), not in memory. This ensures the audit trail survives app restarts, session timeouts, and multi-user concurrent access.

**3. Optimistic execution is prohibited.** C3 does not optimistically apply the write before approval. The write only executes after an `Approved` state is recorded. There is no undo.

**4. The gate applies to the intent, not the data.** The approval record captures what the op intends to do and why — not just the raw SharePoint field values. The approver reviews intent and context, not raw JSON.

**5. Self-approval is prohibited.** The system must check that the approver identity differs from the submitter identity. If they match, the approval is blocked with a clear error.

**6. Platform Owner notification is synchronous.** When a proposal reaches `Submitted`, the Platform Owner is notified before the submitter's session ends. The notification mechanism (email, Teams message, in-app badge) is a Sprint 18 implementation decision.

---

## Open Decisions Before Sprint 18

These questions are formally unresolved. They must be answered and this ADR updated to `Approved` before Sprint 18 implementation begins. Resolving them during Sprint 16 is the target.

**Q1 — Approval timeout.** If a `Submitted` proposal is not reviewed within N days, what happens?
- Option A: Auto-reject with notification to submitter and escalation to admin
- Option B: Escalate to a designated fallback approver
- Option C: Remain pending indefinitely (risk: queue buildup blocks operations)
- *Decision needed: timeout policy and escalation path*

**Q2 — Batch approvals.** Can the Platform Owner approve multiple operations in a single review action (e.g. "approve all pending Journey initiations for this week's roster")? Or is each operation reviewed individually?
- Batch is faster but reduces per-record scrutiny and makes the audit trail less granular
- *Decision needed: batch allowed, batch allowed with individual confirmation, or individual-only*

**Q3 — Emergency bypass.** Is there a break-glass procedure for time-sensitive situations (e.g. a person needs to travel in 2 hours, Journey must be completed immediately)?
- If yes: who authorizes it, what is the post-hoc audit requirement, and how is abuse prevented?
- If no: what is the fallback when approval is unavailable and urgency is real?
- *Decision needed: bypass policy and accountability mechanism*

**Q4 — Delegation scope.** Can delegation be scoped to operation type (e.g. "Deputy may approve Journey completions but not obligation assignments")? Or is delegation all-or-nothing?
- Scoped delegation reduces risk; all-or-nothing is simpler to implement and audit
- *Decision needed: scope model for delegation*

**Q5 — C3Approvals list schema.** The Sprint 18 provisioning handover will require a `C3Approvals` SP list schema document (equivalent to `C3People SP List Schema.md`). This schema is not defined in this ADR — it is a Sprint 18 deliverable contingent on Q1–Q4 above being resolved.
- *Deliverable needed: C3Approvals SP List Schema, authored in Sprint 18 pre-work*

**Q6 — Rejection re-submission.** When a proposal is rejected, can the submitter revise and re-submit? Or must they create a new proposal?
- Revision preserves context and reason history; new proposal is cleaner for audit purposes
- *Decision needed: revision or new-proposal policy*

---

## Consequences

**What becomes true when this ADR reaches `Approved`:**

- No C3 write path may be implemented without the Approval Gate in place
- Sprint 18 implementation scope includes the `C3Approvals` list, the approval service, the notification mechanism, and the approval UI — these are preconditions for any Journey write, not add-ons
- The Sprint 18 baseline document must include gate passage criteria for the Approval Gate itself (i.e. the approval flow must be tested before any operational write is attempted)
- Open Decisions Q1–Q6 above become Sprint 18 planning blockers; they must be resolved before implementation begins

**What does not change:**

- Sprint 16 and Sprint 17 remain read-only. This ADR has no implementation effect until Sprint 18.
- The mock service continues to support write operations locally (no gate in mock mode) — this is by design. The gate applies to the SharePoint service layer only.
- ADR-002 (SharePoint Read / Power Automate Write Pattern) predates this ADR. ADR-013 supersedes ADR-002's write guidance for direct C3 write operations. Power Automate flows remain an option for non-interactive background writes but are out of scope for Sprint 18.

---

## ADR Progression

| State | Date | Actor | Notes |
|---|---|---|---|
| Proposed | 2026-06-29 | Architecture review | Initial draft — design only; open decisions Q1–Q6 outstanding |
| Approved | — | Platform Owner | Prerequisite to Sprint 18; all open decisions must be resolved first |
