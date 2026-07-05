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
// Sprint 31 — approved query classes (Approval Query Integrity — Sprint 31.md)
// ---------------------------------------------------------------------------

/** Pending band: blocks duplicate membership requests; shown as pending chips. */
export const PENDING_STATUSES: readonly ApprovalStatusValue[] =
  ['Submitted', 'InReview', 'Approved'];

/**
 * Actionable set: pending band + ExecutionFailed. ExecutionFailed is actionable
 * recovery state and must NEVER be confined to a limited history window.
 */
export const ACTIONABLE_STATUSES: readonly ApprovalStatusValue[] =
  ['Submitted', 'InReview', 'Approved', 'ExecutionFailed'];

/** Terminal states eligible for the deliberate recent-history window. */
export const TERMINAL_STATUSES: readonly ApprovalStatusValue[] =
  ['Executed', 'Rejected'];

/** Default size of the terminal recent-history window (Executed + Rejected). */
export const DEFAULT_TERMINAL_HISTORY_LIMIT = 200;

/** Options accepted by the Sprint 31 read methods. */
export interface ApprovalQueryOptions {
  /** Propagated through EVERY page request. Aborts reject with AbortError —
   *  cancellation is distinguishable from failure and never resolves empty. */
  signal?: AbortSignal;
}

/**
 * Result of a fresh single-row read (getApproval).
 * etag is the row's CURRENT SharePoint ETag — callers performing a subsequent
 * status update MUST pass it as the IF-MATCH precondition (never the cached
 * card, never '*'). Mock DSM returns a synthetic etag.
 */
export interface ApprovalReadResult {
  approval: C3Approval;
  etag: string | null;
}

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
   * 'AddMissionParticipant' and 'RemoveMissionParticipant' are live from
   * Sprint 29B (governed participant membership).
   *
   * The C3Approvals SP list OperationType choice column must have every value
   * provisioned before first SP DSM use (C3Approvals SP List Schema.md §3.2;
   * S29B delta: scripts/Update-S29B-ParticipantGovernanceDelta.ps1).
   */
  operationType:
    | 'InitiateJourney'
    | 'AddCredential'
    | 'DeactivateCredential'
    | 'AddPerson'
    | 'AddMissionParticipant'
    | 'RemoveMissionParticipant';
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
   * LEGACY (pre-S31) read: single request, $top=500, SubmittedAt-desc order.
   * Contract unchanged for compatibility; production consumers migrated to the
   * S31 semantic methods below. Do not add new consumers.
   */
  listApprovals(filter?: { status?: string[] }): Promise<C3Approval[]>;

  /**
   * COMPLETE pending band (Submitted, InReview, Approved) — exhaustively paged,
   * single-status indexed queries, merged/deduped by Id, sorted Id desc.
   * Fail-closed: any page or mapper failure rejects; never a partial success.
   * Powers the duplicate-pending guard — completeness is correctness-critical.
   */
  listPendingApprovals(opts?: ApprovalQueryOptions): Promise<C3Approval[]>;

  /**
   * COMPLETE actionable set (pending band + ExecutionFailed) — same paging,
   * ordering, and fail-closed contract as listPendingApprovals.
   */
  listActionableApprovals(opts?: ApprovalQueryOptions): Promise<C3Approval[]>;

  /**
   * COMPLETE person history — all 6 statuses, server-filtered on the indexed
   * TargetPersonID column (OData-literal-escaped), exhaustively paged,
   * sorted Id desc, fail-closed.
   */
  listApprovalsByPerson(personId: string, opts?: ApprovalQueryOptions): Promise<C3Approval[]>;

  /**
   * WINDOWED terminal history (Executed, Rejected): the newest `limit` rows by
   * Id across both statuses. Deliberately incomplete — consumers MUST label the
   * result as "showing latest N" and never present loaded counts as totals.
   */
  listRecentTerminalApprovals(
    opts?: ApprovalQueryOptions & { limit?: number },
  ): Promise<C3Approval[]>;

  /**
   * Fresh single-row read by the retained SP numeric item Id (never derived by
   * parsing an APR Title). Returns null when the row does not exist. A row that
   * exists but fails mapping raises ApprovalQueryIntegrityError (truthful
   * corruption signal — never null, never a silent skip). Live since S31
   * (retires the TD-06 throwing stub).
   */
  getApproval(id: number, opts?: ApprovalQueryOptions): Promise<ApprovalReadResult | null>;

  /**
   * Patches the ApprovalStatus of an existing record.
   * Live in Phase 3B for Approved and Rejected.
   *
   * The service stamps ReviewedBy from its factory-captured currentUserLoginName
   * and ReviewedAt from the current datetime.
   *
   * Self-approval enforcement (canonical-identity comparison via
   * utils/identity.checkSelfReview — S33 Defect B; fails closed on
   * indeterminate identity) is applied at the hook layer
   * (usePatchApprovalStatus) and also in MockApprovalsService.
   * SharePointApprovalsService trusts the hook layer check.
   *
   * Does NOT set ExecutedAt, ExecutionError, or create any operational rows.
   * ADR-013: execution is a separate phase (Phase 4).
   *
   * S31: when `etag` is supplied (from the immediately-preceding getApproval
   * freshness read) it becomes the IF-MATCH precondition — a concurrent change
   * surfaces as a truthful concurrency failure. Absent etag preserves the
   * legacy behaviour for unmigrated callers only; new paths MUST pass it.
   */
  patchApprovalStatus(id: number, req: PatchApprovalStatusRequest, etag?: string): Promise<void>;

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
   *
   * S31: `etag` semantics identical to patchApprovalStatus — pass the ETag from
   * the freshness read; a mid-execution change 412s into the existing
   * partial-execution recovery path.
   */
  stampExecution(id: number, req: StampExecutionRequest, etag?: string): Promise<void>;
}
