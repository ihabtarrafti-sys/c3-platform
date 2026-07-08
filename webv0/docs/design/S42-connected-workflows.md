# Sprint 42 — Connected Workflows + Withdraw-My-Request (Design & Increment Plan)

**Author:** Architect-of-record · **Date:** 2026-07-09 · **Mission (owner direction):** the workflows each option has with each other — the person page becomes the operational hub — plus the product fix for the S41 single-owner wedge finding.

## W1 — Withdraw my request (the wedge fix)

New approval status **`Withdrawn`** (terminal) + action `withdraw`:
- **Only the SUBMITTER** may withdraw, and only while the request is **Submitted or InReview** (before a decision; an Approved request belongs to the reviewers — reject is their tool). This inverts the self-review guard deliberately: reviewers may not withdraw someone else's request; the submitter may not review their own. One request, two disjoint sets of hands.
- No side effects (the operation never ran); one transaction: status flip (version-guarded) + approval event + audit `ApprovalWithdrawn`.
- `PENDING_STATUSES` is unchanged — every duplicate-pending guard (agreements, mission participants) treats Withdrawn as closed automatically, which is exactly how the wedge unblocks.
- Migration **0014**: extend the approval status CHECK with `'Withdrawn'`.
- API: `POST /api/v1/approvals/:approvalId/withdraw` (versioned body). UI: a Withdraw… governed dialog on the approval page, visible ONLY to the submitter of an open request.
- Ships with the wedge finding's other dispositions: customer guidance ≥2 owners (docs), and the agreement Edit… dialog exposing the parent-link field (W3).

## W2 — Person Profile depth (the hub's read side)

PersonProfilePage gains: **Agreements** section (visible only with `canReadAgreements`; value column only with `canViewFinancials`) · **Missions** section (the person's participant memberships joined with mission names) · **Approvals** section (person-scoped approval history, visible to approval-viewing roles). New reads: `GET /people/:personId/missions` (participant rows + mission name/status) and `GET /people/:personId/approvals` (targetPersonId-scoped). Every id everywhere stays a link.

## W3 — In-context governed actions (the hub's write side)

On the person page, for authorized roles, an action row: **Add agreement · Add credential · Start journey · Add to mission** — each a governed submit dialog **pre-filled with this person** (no person picker; the person IS the context). Same honest copy, same approval flow; the hub removes navigation friction, never governance. Plus the S41 UI item: AgreementDetailPage Edit… gains the parent-link field.

## W4 — E2E + deploy + certification

E2E: withdraw path (submitter withdraws; a reviewer cannot; dup-pending unblocks after withdrawal) + person-hub flows (sections render; in-context submit lands pre-filled; role gating holds). Staging deploy (0014 paste → API → web) + owner smoke → S42 hosted cert.
