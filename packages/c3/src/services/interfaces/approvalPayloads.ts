/**
 * approvalPayloads.ts
 *
 * Typed payload shapes for C3Approvals Payload column, keyed by OperationType.
 *
 * Sprint 18 Phase 3A: InitiateJourneyApprovalPayload only.
 * Sprint 20 Phase 3:  AddCredentialApprovalPayload added.
 * Sprint 23 Phase 1:  DeactivateCredentialApprovalPayload added.
 *
 * See: docs/architecture/C3Approvals SP List Schema.md §3.16
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import type { ObligationAssignment } from '@c3/types';

// ---------------------------------------------------------------------------
// InitiateJourneyApprovalPayload
// ---------------------------------------------------------------------------

export interface InitiateJourneyApprovalPayload {
  operationType: 'InitiateJourney';
  personId: string;
  journeyType: 'Onboarding';
  initiatedBy: string;
  initiationReason?: string;
  assignedTo?: string;
  notes?: string;
  missionId?: string;
  obligationAssignments: ObligationAssignment[];
}

// ---------------------------------------------------------------------------
// AddCredentialApprovalPayload
// ---------------------------------------------------------------------------

export interface AddCredentialApprovalPayload {
  operationType: 'AddCredential';
  holderPersonId: string;
  credentialType: string;
  referenceNumber: string;
  issuedBy?: string;
  issuedDate?: string;
  expiryDate?: string;
  validFromDate?: string;
  subType?: string;
  notes?: string;
  supersedesCredentialId?: string;
}

// ---------------------------------------------------------------------------
// DeactivateCredentialApprovalPayload
// ---------------------------------------------------------------------------

/**
 * Payload for OperationType = 'DeactivateCredential'.
 *
 * Captures the full intent of marking an existing credential as inactive
 * (IsActive = false) in C3Credentials. The credential already exists --
 * credentialId identifies the exact row to deactivate.
 *
 * The C3Approvals OperationType choice column has 'DeactivateCredential'
 * pre-provisioned (C3Approvals SP List Schema s3.2). No SP schema change needed.
 *
 * Execution: MERGE C3Credentials item IsActive = false.
 * No new row is created. No cascade to other lists.
 *
 * Sprint 23 Phase 1.
 */
export interface DeactivateCredentialApprovalPayload {
  operationType: 'DeactivateCredential';
  /** CRED-XXXX -- the existing credential being deactivated. */
  credentialId: string;
  /** PER-XXXX -- holder of the credential (for cache invalidation and display). */
  holderPersonId: string;
  /** Raw CredentialType key -- for display in payload summary. */
  credentialType: string;
  /** Reference number -- for display and audit verification. */
  referenceNumber: string;
  /** Reason for deactivation. Required -- carries the audit justification. */
  reason: string;
  /** currentUser.loginName at submission time. Optional -- display only. */
  requestedBy?: string;
}

// ---------------------------------------------------------------------------
// ApprovalPayload
// ---------------------------------------------------------------------------

export type ApprovalPayload =
  | InitiateJourneyApprovalPayload
  | AddCredentialApprovalPayload
  | DeactivateCredentialApprovalPayload;
