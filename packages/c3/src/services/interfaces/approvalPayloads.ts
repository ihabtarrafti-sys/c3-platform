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
 * Future operation types add their payload interfaces here.
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
