/**
 * approvalPayloads.ts
 *
 * Typed payload shapes for C3Approvals Payload column, keyed by OperationType.
 *
 * Sprint 18 Phase 3A: InitiateJourneyApprovalPayload only.
 * Sprint 20 Phase 3:  AddCredentialApprovalPayload added.
 * Sprint 23 Phase 1:  DeactivateCredentialApprovalPayload added.
 * Sprint 25:           AddPersonApprovalPayload added.
 *
 * See: docs/architecture/C3Approvals SP List Schema.md §3.16
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import type { MissionParticipantRole, ObligationAssignment } from '@c3/types';

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
// AddPersonApprovalPayload
// ---------------------------------------------------------------------------

/**
 * Payload for OperationType = 'AddPerson'.
 *
 * Captures the full intent of creating a new row in C3People. The person
 * does not exist before approval execution — PersonID (PER-XXXX) is assigned
 * by the service layer using the SP atomic item ID pattern.
 *
 * Required: fullName (cannot create without a name).
 * All other fields are optional and mirror C3People writable columns.
 *
 * Email is intentionally absent — it is not in the current C3People SP list
 * schema. Duplicate protection is FullName-based (client-side from loaded list).
 * See TD-24 for server-side email uniqueness enforcement.
 *
 * Execution: POST to C3People (TMP title) → MERGE Title = PER-XXXX.
 * IsActive defaults to true on creation.
 *
 * Sprint 25.
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */
export interface AddPersonApprovalPayload {
  operationType: 'AddPerson';
  /** Full legal name of the person to create. Required. */
  fullName: string;
  /** In-game name / alias. Optional. */
  ign?: string;
  /** Country of nationality, plain text. Optional. */
  nationality?: string;
  /** Primary role or job title. Optional. */
  primaryRole?: string;
  /** Internal HR personnel code (e.g. "FN/PL/001"). Optional. */
  personnelCode?: string;
  /** Current team assignment, plain text. Optional. */
  currentTeam?: string;
  /** Game title the person competes in or supports. Optional. */
  currentGameTitle?: string;
  /** Organisational department. Optional. */
  primaryDepartment?: string;
  /** Operational notes / reason for creation. Optional. */
  notes?: string;
  /** currentUser.loginName at submission time. Optional — audit display only. */
  requestedBy?: string;
}

// ---------------------------------------------------------------------------
// AddMissionParticipantApprovalPayload / RemoveMissionParticipantApprovalPayload
// ---------------------------------------------------------------------------

/**
 * Payload for OperationType = 'AddMissionParticipant' (Sprint 29B).
 *
 * Full ADR-013 governed operation. Execution resolves ALL C3MissionParticipants
 * rows (including inactive) for MissionID+PersonID:
 *   0 rows        → POST new row
 *   1 inactive    → governed reactivation (ETag MERGE; fields refreshed from
 *                   this payload)
 *   1 active      → exact payload match = already-applied (stamp recovery);
 *                   mismatch = ParticipantConflictError
 *   multiple rows → DataIntegrityError (no write)
 *
 * Requester identity is NOT trusted from the payload — C3Approvals.SubmittedBy
 * (stamped by the service from the authenticated session) is authoritative.
 * TargetPersonID on the approval row = personId (real canonical PER-XXXX).
 */
export interface AddMissionParticipantApprovalPayload {
  operationType: 'AddMissionParticipant';
  missionId: string;
  personId: string;
  externalCode: string;
  role: MissionParticipantRole;
  perDiemRate?: number;
  reason?: string;
}

/**
 * Payload for OperationType = 'RemoveMissionParticipant' (Sprint 29B).
 *
 * Full ADR-013 governed operation. Execution sets IsActive = false on the
 * exact active row (ETag MERGE) — rows are NEVER physically deleted. Blocked
 * at submission AND re-checked authoritatively at execution while active kit
 * assignments exist for the person on the mission. An already-inactive row at
 * execution time is treated as already-applied (stamp recovery).
 */
export interface RemoveMissionParticipantApprovalPayload {
  operationType: 'RemoveMissionParticipant';
  missionId: string;
  personId: string;
  /** Mandatory audit justification. */
  reason: string;
}

// ---------------------------------------------------------------------------
// ApprovalPayload
// ---------------------------------------------------------------------------

export type ApprovalPayload =
  | InitiateJourneyApprovalPayload
  | AddCredentialApprovalPayload
  | DeactivateCredentialApprovalPayload
  | AddPersonApprovalPayload
  | AddMissionParticipantApprovalPayload
  | RemoveMissionParticipantApprovalPayload;
