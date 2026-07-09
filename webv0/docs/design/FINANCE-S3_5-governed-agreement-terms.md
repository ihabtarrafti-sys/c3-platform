# Finance Sprint 3.5 — governing agreement financial terms (dual-control)

Owner decision (2026-07-10): **changing a salary — and every financial term — must
require owner approval.** So the term operations built direct-audited in Sprint 3
are promoted to the **governed approval pipeline**: requester ≠ approver, the
owner executes. Applied to ALL kinds, not just Salary — a $100k milestone or a
prize-share % is as material as base pay, and singling out one kind would be a
leaky rule.

## What changed

Three new governed operations join the pipeline:

| Operation | Payload | Executor |
|---|---|---|
| **AddAgreementTerm** | agreementId + kind + value set | allocate TRM → `insertAgreementTerm` |
| **UpdateAgreementTerm** | agreementId + termId + new value set | version-guarded `updateAgreementTerm` |
| **RemoveAgreementTerm** | agreementId + termId | soft `deactivateAgreementTerm` |

- **Submit** (`submitAgreementTermOps`): owner/operations only (`assertSubmitApproval` +
  `assertViewFinancials`); the agreement must be Active; Update/Remove require the
  term to exist and belong to the agreement; `assertTermShape` runs friendly at
  submit; a **duplicate-pending-per-term** guard blocks a second open change to the
  same TRM (closing the version race the direct path used a version guard for).
- **Execute** (`executeApproval`): the authoritative in-transaction re-check —
  agreement still Active, term still present, `assertTermShape` again — then the
  write through the SAME version-guarded `writeTx` methods the S3 direct path used,
  plus the same-tx `AgreementTermAdded/Updated/Removed` audit. A terminated
  agreement or a vanished term is a truthful ExecutionFailed, never a partial write.
- The **direct** term-write use-cases and their `POST/PATCH/DELETE …/terms(/:termId)`
  routes are **removed**. `listAgreementTerms` (read, `canViewFinancials`) is
  unchanged.
- **Web**: the Add / Edit / Remove confirms now **submit for approval** ("nothing
  changes until an owner executes it"); the Approvals inbox and detail render the
  three new operations (`approval-term-subject`).

## Migration

`0020_governed_agreement_terms.sql` only widens the `approval.operation_type`
CHECK to admit the three types. The `agreement_term` table (0019) is unchanged;
any rows the S3 direct path created stay valid (future changes now go through
governance).

## Idempotency (no new column needed)

Re-execute is safe without a `created_by_approval_id` link: the `status ===
'Executed'` short-circuit prevents a second Add, and the `updateApprovalStatus`
version guard rolls back a concurrent duplicate's insert (the mission-participant
precedent). The idempotent branch returns the approval; the UI refetches terms.

## Evidence

Typecheck all 9 projects. Gate PASSED — **434 tests** (persistence + api term
suites rewritten to the governed round-trip: submit → owner-execute, submit-time
shape + gate + active-only + duplicate-pending-per-term, the `canViewFinancials`
read gate with legal denied, RLS). E2E 11/11 — `agreements.spec` now has ops
request a salary + a share (owner executes each), a governed edit, and a governed
remove, asserting the term is unchanged until execution and the approval subject
reads correctly (`test.slow()` for the added round-trips).

## Deploy

Migration 0020 (owner paste) → API (owner paste) → web (me). Deploy pastes:
`C:\Projects\C3-FINANCE-S3_5-DEPLOY-PASTES.md`.
