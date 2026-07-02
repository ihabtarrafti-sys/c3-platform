/**
 * IApprovalsService.ts
 *
 * Service interface for the C3 governance approval layer (ADR-013).
 *
 * Sprint 18 Phase 2B: createApproval live.
 * Sprint 18 Phase 3B: listApprovals and patchApprovalStatus live.
 * Sprint 18 Phase 4A: stampExecution live.
 * Sprint 20 Phase 3:  operationType widened to include 'AddCredential'.
 * Sprint 23 Phase 1:  operationType widened to include 'DeactivateCredential'.
 * Sprint 25:          operationType widened to include 'AddPerson'.
 * Sprint 25 (polish): StampExecutionRequest.Executed.targetPersonId added for AddPerson
 *                     TargetPersonID backfill. AddPerson approvals submit with
 *                     'PENDING-ADDPERSON' placeholder; after execution the field is
 *                     updated to the created PER-XXXX in the same stampExecution MERGE.
 *
 * Lifecycle: Submitted -> InReview -> Approved -> Executed | ExecutionFailed
 *                                  -> Rejected
 *
 * Identity rules (ADR-013):
 *   - SubmittedBy is stamped by the service from currentUser.loginName.
 *   - ReviewedBy is stamped by the service at patchApprovalStatus time.
 *   - Self-approval: ReviewedBy must not equal SubmittedBy.
 *     Enforced in usePatchApprovalStatus (hook layer) and MockApprovalsService.
 *
 * See: docs/architecture/C3Approvals SP List Schema.md
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import type { C3Approval } from '@c3/utils/spApprovalMapper';

// ---------------------------------------------------------------------------
// ApprovalStatus lifecycle value set
// ---------------------------------------------------------------------------

export type ApprovalStatusValue =
  | 'Submitted'
  | 'InReview'
  | 'Approved'
  | 'Rejected'
  | 'Executed'
  | 'ExecutionFailed';

export const APPROVAL_STATUS_VALUES: ReadonlySet<string> = new Set<ApprovalStatusValue>([
  'Submitted',
  'InReview',
  'Approved',
  'Rejected',
  'Executed',
  'ExecutionFailed',
]);

// ---------------------------------------------------------------------------
// CreateApprovalRequest
// ---------------------------------------------------------------------------

export interface CreateApprovalRequest {
  /**
   * PascalCase operation type.
   * 'InitiateJourney' is live since Phase 2B.
   * 'AddCredential'        is live from Sprint 20 Phase 3.
   * 'DeactivateCredential' is live from Sprint 23 Phase 1.
   * 'AddPerson'            is live from Sprint 25.
   *
   * The C3Approvals SP list OperationType choice column must have 'AddPerson'
   * provisioned before first SP DSM use (C3Approvals SP List Schema.md §3.2).
   */
  operationType: 'InitiateJourney' | 'AddCredential' | 'DeactivateCredential' | 'AddPerson';
  /** Opaque secondary target reference (optional). */
  targetId?: string;
  /**
   * Canonical C3 PersonID of the target person, e.g. "PER-0001".
   * For AddPerson approvals, pass "PENDING-ADDPERSON" at submission time --
   * the person does not exist until execution. After execution, the field is
   * backfilled to the created PER-XXXX via StampExecutionRequest.targetPersonId.
   */
  targetPersonId: string;
  /** Human-readable reason for the request (optional). */
  reason?: string;
  /** JSON-serialised payload for the governed operation. */
  payload: string;
}

// ---------------------------------------------------------------------------
// CreateApprovalResult
// ---------------------------------------------------------------------------

export interface CreateApprovalResult {
  /** SP list item ID of the created C3Approvals record. */
  approvalId: number;
  /** APR-XXXX reference title. */
  title: string;
  /** Always 'Submitted' on successful creation. */
  status: 'Submitted';
}

// ---------------------------------------------------------------------------
// PatchApprovalStatusRequest
//
// Caller supplies newStatus and optional rejectionReason.
// The service stamps ReviewedBy (from its factory-captured loginName)
// and ReviewedAt (current ISO datetime) -- callers do not supply these.
//
// Phase 3B: Approved and Rejected only.
// Executed and ExecutionFailed are Phase 4 (handled by stampExecution).
// ---------------------------------------------------------------------------

export interface PatchApprovalStatusRequest {
  /** Target lifecycle status. Only 'Approved' and 'Rejected' are valid in Phase 3B. */
  newStatus: 'Approved' | 'Rejected';
  /**
   * Required when newStatus is 'Rejected'.
   * Written to RejectionReason column.
   * ADR-013: rejection reason is mandatory for auditability.
   */
  rejectionReason?: string;
}

// ---------------------------------------------------------------------------
// StampExecutionRequest
//
// Discriminated union for Phase 4A execution stamping.
//
// Executed branch:
//   - Sets ApprovalStatus = Executed
//   - Sets ExecutedAt = ISO datetime provided by caller
//   - Clears ExecutionError (null)
//   - ReviewedBy / ReviewedAt already stamped at patchApprovalStatus time -- not touched.
//
// ExecutionFailed branch:
//   - Sets ApprovalStatus = ExecutionFailed
//   - Sets ExecutionError = useful message
//   - Does NOT set ExecutedAt (omitted or cleared to null)
//
// Called by useExecuteApproval after the operational write succeeds or fails.
// Never called by patchApprovalStatus.
// ---------------------------------------------------------------------------

export type StampExecutionRequest =
  | {
      newStatus: 'Executed';
      /** ISO datetime string -- wall-clock time of execution. */
      executedAt: string;
      executionError?: null;
      /**
       * Optional: backfill TargetPersonID on the C3Approvals row after execution.
       * Used by the AddPerson path only -- the approval was submitted with
       * 'PENDING-ADDPERSON' because no PER-XXXX existed at submission time.
       * Passing this field causes the MERGE to also write TargetPersonID = personId.
       * Other operation types (InitiateJourney, AddCredential, DeactivateCredential)
       * do not use this field and should not pass it.
       */
      targetPersonId?: string;
    }
  | {
      newStatus: 'ExecutionFailed';
      /** Useful diagnostic message. Max ~250 chars recommended for SP column limits. */
      executionError: string;
      executedAt?: null;
    };

// ---------------------------------------------------------------------------
// IApprovalsService
// ---------------------------------------------------------------------------

export interface IApprovalsService {
  /**
   * Creates a new approval record in C3Approvals with ApprovalStatus: Submitted.
   * Live in Phase 2B.
   */
  createApproval(req: CreateApprovalRequest): Promise<CreateApprovalResult>;

  /**
   * Returns active approvals (Submitted + InReview by default).
   * Live in Phase 3B.
   *
   * filter.status: string[] -- override the default status filter.
   */
  listApprovals(filter?: { status?: string[] }): Promise<C3Approval[]>;

  /**
   * Returns a single approval by SP item ID.
   * Phase 4+ stub -- throws '[C3/Approvals] getApproval: not implemented'.
   */
  getApproval(id: number): Promise<null>;

  /**
   * Patches the ApprovalStatus of an existing record.
   * Live in Phase 3B for Approved and Rejected.
   *
   * The service stamps ReviewedBy from its factory-captured currentUserLoginName
   * and ReviewedAt from the current datetime.
   *
   * Self-approval enforcement (ReviewedBy === SubmittedBy) is applied at the
   * hook layer (usePatchApprovalStatus) and also in MockApprovalsService.
   * SharePointApprovalsService trusts the hook layer check.
   *
   * Does NOT set ExecutedAt, ExecutionError, or create any operational rows.
   * ADR-013: execution is a separate phase (Phase 4).
   */
  patchApprovalStatus(id: number, req: PatchApprovalStatusRequest): Promise<void>;

  /**
   * Stamps C3Approvals as Executed or ExecutionFailed after an execution attempt.
   * Live in Phase 4A.
   *
   * Executed:        sets ApprovalStatus = Executed, ExecutedAt = ISO datetime, ExecutionError = null.
   * ExecutionFailed: sets ApprovalStatus = ExecutionFailed, ExecutionError = message.
   *                  Does NOT set ExecutedAt.
   *
   * Called by useExecuteApproval ONLY. Never called by patchApprovalStatus.
   * Only valid when the current ApprovalStatus is Approved -- callers must enforce this.
   */
  stampExecution(id: number, req: StampExecutionRequest): Promise<void>;
}
