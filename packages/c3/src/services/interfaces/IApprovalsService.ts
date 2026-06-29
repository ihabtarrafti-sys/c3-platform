/**
 * IApprovalsService.ts
 *
 * Service interface for the C3 governance approval layer (ADR-013).
 *
 * Sprint 18 Phase 2B ships createApproval (live for initiateJourney requests).
 * All other methods are Phase 3 stubs — implementations throw with a
 * [C3/Approvals] warning.
 *
 * Lifecycle: Submitted → InReview → Approved → Executed | ExecutionFailed
 *                                 → Rejected
 *
 * Identity rules (ADR-013):
 *   - SubmittedBy is stamped by the service from currentUser.loginName.
 *     Callers must NOT supply SubmittedBy.
 *   - SubmittedAt is stamped by the service at call time.
 *   - ApprovalStatus begins as 'Submitted'.
 *   - Self-approval enforcement (ReviewedBy !== SubmittedBy) is applied at
 *     patchApprovalStatus time — Phase 3 scope, not Phase 2B.
 *
 * See: docs/architecture/C3Approvals SP List Schema.md
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

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
//
// Caller-supplied fields only. The service stamps SubmittedBy, SubmittedAt,
// and ApprovalStatus — these must not appear in the request.
//
// TargetPersonID: canonical C3 PersonID (e.g. "PER-0001"), not a numeric
// SharePoint list item ID. SP list lookup field IDs are an implementation
// detail of the service layer.
// ---------------------------------------------------------------------------

export interface CreateApprovalRequest {
  /** PascalCase. Only 'InitiateJourney' is live in Phase 2B. */
  operationType: 'InitiateJourney';
  /** Opaque secondary target reference (optional). Reserved for future operations. */
  targetId?: string;
  /** Canonical C3 PersonID of the target person, e.g. "PER-0001". */
  targetPersonId: string;
  /** Human-readable reason for the request (optional). Stored in Reason column. */
  reason?: string;
  /** JSON-serialised payload for the governed operation (e.g. InitiateJourneyPayload). */
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
// IApprovalsService
// ---------------------------------------------------------------------------

export interface IApprovalsService {
  /**
   * Creates a new approval record in C3Approvals with ApprovalStatus: Submitted.
   *
   * SubmittedBy is stamped from currentUser.loginName captured in the service
   * factory — callers do not supply identity. This is the only live method in
   * Phase 2B. Only operationType 'InitiateJourney' is accepted.
   */
  createApproval(req: CreateApprovalRequest): Promise<CreateApprovalResult>;

  /**
   * Returns approvals matching the given filter.
   * Phase 3+ — throws '[C3/Approvals] listApprovals: not implemented'.
   */
  listApprovals(filter?: Record<string, unknown>): Promise<never[]>;

  /**
   * Returns a single approval by SP item ID.
   * Phase 3+ — throws '[C3/Approvals] getApproval: not implemented'.
   */
  getApproval(id: number): Promise<null>;

  /**
   * Patches the ApprovalStatus of an existing record (InReview, Approved,
   * Rejected, Executed, ExecutionFailed). Enforces ReviewedBy !== SubmittedBy
   * at approval action time (ADR-013).
   * Phase 3+ — throws '[C3/Approvals] patchApprovalStatus: not implemented'.
   */
  patchApprovalStatus(id: number, update: Record<string, unknown>): Promise<never>;
}
