/**
 * approvalPayloads.ts
 *
 * Typed payload shapes for C3Approvals Payload column, keyed by OperationType.
 *
 * The Payload column stores a JSON-serialised representation of the proposed
 * write input. The approver sees a human-readable summary in ApprovalGatePanel
 * (Phase 4); the raw JSON is used by the execution layer to reconstruct the
 * operational write at approval time.
 *
 * Rules (ADR-013 / C3Approvals SP List Schema §6):
 *   - Payload must be a valid JSON object.
 *   - Payload must contain operationType matching the OperationType column.
 *   - Payload is immutable after submission.
 *   - Payload carries the full intent — sufficient to reconstruct the write
 *     without referencing other SP lists.
 *
 * Sprint 18 Phase 3A: InitiateJourneyApprovalPayload only.
 * Sprint 20 Phase 3:  AddCredentialApprovalPayload added.
 *
 * See: docs/architecture/C3Approvals SP List Schema.md §3.16
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import type { ObligationAssignment } from '@c3/types';

// ---------------------------------------------------------------------------
// InitiateJourneyApprovalPayload
// ---------------------------------------------------------------------------

/**
 * Payload for OperationType = 'InitiateJourney'.
 *
 * Captures the full intent of starting an Onboarding Journey for a person.
 * journeyId is intentionally absent at submission time — it will be assigned
 * at execution time when the C3Journeys row is created (Phase 4).
 *
 * initiatedBy: currentUser.loginName (claims format) in SP mode.
 *   Login name is the durable, unique identity for audit purposes.
 *   The SubmittedBy column on the C3Approvals record is also loginName — consistent.
 */
export interface InitiateJourneyApprovalPayload {
  /** Must equal the OperationType column value. Used to validate payload-column alignment. */
  operationType: 'InitiateJourney';
  /** Canonical C3 PersonID, e.g. "PER-0004". Matches TargetPersonID on the approval record. */
  personId: string;
  /** Journey type being initiated. Only 'Onboarding' is produced in Sprint 18. */
  journeyType: 'Onboarding';
  /**
   * Identity of the C3 user who initiated the request.
   * In SP mode: currentUser.loginName (claims format).
   * Used for audit trail and for stamping Journey.InitiatedBy at execution time.
   */
  initiatedBy: string;
  /** Why this journey is being opened. Maps to Journey.InitiationReason at execution. */
  initiationReason?: string;
  /** Governance owner for the journey. Maps to Journey.AssignedTo at execution. */
  assignedTo?: string;
  /** Optional operational notes. Maps to Journey.Notes at execution. */
  notes?: string;
  /** MissionID when opened from a mission-scoped gap. Maps to Journey.MissionID at execution. */
  missionId?: string;
  /**
   * Per-obligation ownership declarations.
   * Empty array when none were supplied — never omitted, to keep the payload
   * schema consistent and avoid null-check at execution time.
   */
  obligationAssignments: ObligationAssignment[];
}

// ---------------------------------------------------------------------------
// AddCredentialApprovalPayload
// ---------------------------------------------------------------------------

/**
 * Payload for OperationType = 'AddCredential'.
 *
 * Captures the full intent of creating a new credential record for a person.
 * CredentialID (CRED-XXXX) is intentionally absent at submission time — it will
 * be assigned at execution time via the POST-then-MERGE pattern against C3Credentials.
 *
 * credentialType: plain string to survive JSON round-trip. Validated against
 *   VALID_CREDENTIAL_TYPES at execution time before the SP write.
 *
 * Date fields (issuedDate, expiryDate, validFromDate): ISO 8601 date strings
 *   (date-only, e.g. "2026-07-01"). SP C3Credentials uses Date Only columns
 *   for these — no time component is stored.
 *
 * Sprint 20 Phase 3.
 * See: docs/architecture/C3Credentials SP List Schema.md
 */
export interface AddCredentialApprovalPayload {
  /** Must equal the OperationType column value. */
  operationType: 'AddCredential';
  /** Canonical C3 PersonID of the credential holder, e.g. "PER-0004". */
  holderPersonId: string;
  /** One of the 18 CredentialType values. Validated at execution time. */
  credentialType: string;
  /** The document's own reference number (passport no., visa no., etc.). */
  referenceNumber: string;
  /** Issuing authority (optional). */
  issuedBy?: string;
  /** ISO 8601 date-only string, e.g. "2026-01-15" (optional). */
  issuedDate?: string;
  /** ISO 8601 date-only string. Absent means non-expiring (optional). */
  expiryDate?: string;
  /** ISO 8601 date-only string for permits with a future start date (optional). */
  validFromDate?: string;
  /** Sub-type discriminator, e.g. "Employment", "Tourist" (optional). */
  subType?: string;
  /** Free-text notes for ops staff (optional). */
  notes?: string;
  /** CredentialID of the document this one replaces (optional). */
  supersedesCredentialId?: string;
}

// ---------------------------------------------------------------------------
// ApprovalPayload
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all typed approval payload shapes.
 * Keyed by the operationType discriminant field.
 *
 * Used by useExecuteApproval to narrow the payload to the correct type
 * before dispatching to the operation-specific execution path.
 */
export type ApprovalPayload =
  | InitiateJourneyApprovalPayload
  | AddCredentialApprovalPayload;
