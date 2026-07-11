# Track B1 — Request Corrections (edit-before-review + revise-and-resubmit)

**Status: BUILT. Migration 0038.** First item of the Track B queue.

**The owner's locked design (round-2 refinement, 2026-07-10):** "polish freely
until review starts — every change on the record; after that, frozen;
corrections are new requests."

## The three lanes

**(a) EDIT BEFORE REVIEW** — your OWN request, `Submitted` ONLY, in-place,
same APR id. Every edit is on the record: an approval event names the changed
FIELDS (never values — see disclosure note), the audit stream carries the
same, and the register/detail show an **"Edited ×N"** badge. The DB payload
freeze MOVES from birth to the **beginReview boundary** (migration 0038): the
`approval_immutable_guard` trigger now admits payload/reason changes only
while the row is `Submitted` and stays `Submitted` — from `InReview` onward
"the approver approves exactly what executes" is machine-enforced, exactly as
before.

**An edit may not change the TARGET.** The one-open-request-per-target guards
were checked at submission; letting an edit retarget would dodge them. Per-op
target keys (`EDIT_TARGET_KEYS`) must be byte-equal between old and new
input — otherwise the answer is withdraw/revise. `ImportBatch` is excluded
from editing entirely (a staged batch is corrected by re-staging the file).

**(b) REVISE & RESUBMIT** — for `Submitted`/`InReview`/`Rejected`/`Withdrawn`:
the original input prefills a fresh request; submission runs the op's REAL
submit path (all duplicate-pending and business guards apply); the new row
carries `revisionOf`, the old row gains `supersededBy` (write-once, any
status — linking a terminal row is legal). For `Submitted`/`InReview` the old
request is withdrawn first (the existing S42 withdraw, submitter-only);
`Rejected`/`Withdrawn` are already closed, so it is link-only.
**Refused:** `Approved` (belongs to the reviewers — their tools are execute
or reject), `ExecutionFailed` (the owner's re-execute lane owns recovery),
`Executed` (done is done).

*Atomicity, honestly:* withdraw and the fresh submit are two transactions
(each op's submit owns its own tx). The new input is schema-validated BEFORE
the withdraw, so the residual failure window is a business-guard refusal
inside the real submit after a successful withdraw — the old request is then
withdrawn and the user retries from the still-prefilled form. Documented
rather than papered over; the linking write is a third, cosmetic-on-failure
step.

**(c) WITHDRAW** — already live since S42; unchanged.

## Disclosure note (why the record shows field NAMES, not values)

Approval events and audit summaries are readable by reviewer-standing roles,
and H-01's law is that payload VALUES reach a reader only through the
role-projected DTO. So the edit record carries `changed: [field names]` and
the count; the reviewer always sees the FULL current (projected) payload in
the H-07 proposed-change panel — which is precisely what they approve. A
value-level diff surface would need its own projection pass; deferred until
someone actually asks for it.

## Signals law compliance (ships in the same sprint)

New cockpit check **`RejectedAwaitingRevision`**: rejected requests that no
revision supersedes — the "fix it and resend" queue. All five sync points
(SIGNAL_KINDS, SITUATION_CHECKS, SITUATION_CHECK_KINDS, api-contracts enum,
web KIND_LABEL) + the index-alignment guard.

## Mechanics

- **0038**: `edit_count int NOT NULL DEFAULT 0` (trigger-guarded monotone),
  `revision_of text` (write-once at INSERT, composite self-FK),
  `superseded_by text` (write-once NULL→value, composite self-FK);
  `approval_immutable_guard()` replaced (0001 stays frozen per H-08).
- **writeTx**: `updateApprovalPayload` (version- AND `status='Submitted'`-
  guarded, bumps `edit_count`), `setSupersededBy` (WHERE superseded_by IS
  NULL), `insertApproval` gains optional `revisionOf`.
- **application/editApproval.ts**: `editApprovalPayload` (submitter-only,
  Submitted-only, payload revalidated through `approvalPayloadSchema`,
  target-key equality, events+audit) and `reviseApproval` (status gate,
  validate-first, withdraw when open, dispatch to the op's real submit,
  link both rows).
- **API**: `POST /api/v1/approvals/:id/edit`, `POST /api/v1/approvals/:id/revise`;
  approval DTO + `editCount`/`revisionOf`/`supersededBy` (additive — contract
  artifact regenerated deliberately).
- **Web**: ApprovalDetailPage — Edited ×N badge, revision/supersession links,
  Edit/Revise dialogs driven by one per-op field-spec registry (prefilled
  from the actor's own projected payload; submit-capable roles hold full
  disclosure, so prefill is complete by construction).
