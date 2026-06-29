/**
 * Journey types — C3 Platform
 *
 * A Journey is a tracked, multi-step operational workflow for a person.
 * Journeys are initiated by ops staff and progress through a defined lifecycle.
 *
 * Sprint 6E generalized journeys from a single Onboarding type to a
 * polymorphic model covering the full player/staff lifecycle.
 *
 * Sprint 9 (S9-2): Journeys now support per-obligation assignments.
 * The Journey retains a single overall owner (AssignedTo — governance).
 * Individual obligations may be assigned to different operational owners
 * (obligationAssignments — execution). A gap with an explicit assignment
 * is Covered; without one it is Routed. See OwnershipState in situation.ts.
 *
 * Sprint 10 (M10-4): Journeys may be linked to a Mission via MissionID.
 * When set, the Journey is understood as being initiated in the context of
 * a specific operational mission. This preserves the audit trail of why a
 * Journey was opened and enables future Mission-specific timeline views.
 */

import type { CredentialCapability } from './credentials';

// ---------------------------------------------------------------------------
// JourneyType
// ---------------------------------------------------------------------------

/**
 * The kind of operational workflow being executed.
 *
 * Each type maps to a distinct set of tasks, stakeholders, and timelines.
 * The type drives which protocol(s) are evaluated for obligation tracking.
 */
export type JourneyType =
  | 'Onboarding'        // New hire / new signing
  | 'VisaRenewal'       // Visa / residence permit renewal
  | 'TeamTransfer'      // Inter-team or cross-league transfer
  | 'ContractRenewal'   // Contract extension or renegotiation
  | 'Offboarding';      // Departure / contract termination

// ---------------------------------------------------------------------------
// JourneyStatus
// ---------------------------------------------------------------------------

/**
 * The lifecycle state of a Journey.
 *
 * State transitions:
 *   Active → Completed  (normal completion)
 *   Active → Suspended  (temporarily paused, e.g. waiting for documents)
 *   Active → Cancelled  (abandoned)
 *   Suspended → Active  (resumed)
 *   Suspended → Cancelled
 */
export type JourneyStatus =
  | 'Active'
  | 'Completed'
  | 'Suspended'
  | 'Cancelled';

// ---------------------------------------------------------------------------
// ObligationAssignment
// ---------------------------------------------------------------------------

/**
 * An explicit ownership declaration for a single obligation within a Journey.
 *
 * When a Journey has an ObligationAssignment for a given obligation type,
 * the corresponding OperationalGap moves from Routed → Covered in the
 * Situation Room. The `assignedTo` field names the person or team holding
 * execution responsibility for satisfying that specific requirement.
 *
 * This is the execution layer beneath the Journey's governance owner (AssignedTo).
 * The Journey owner is accountable for the person being ready overall.
 * The obligation assignee is responsible for satisfying the specific requirement.
 *
 * Ref: Sprint 9 — Operational Gap Ownership
 * Ref: C3 Operator Validation — Sprint 8 Observations, Scenario 4
 */
export interface ObligationAssignment {
  /** The credential capability this assignment covers. Used to match against obligations. */
  obligationType: CredentialCapability;
  /** Human-readable label of the obligation being assigned (for audit trail). */
  requirement: string;
  /** Name or email of the person/team responsible for resolving this obligation. */
  assignedTo: string;
  /** ISO 8601 datetime when this assignment was recorded. */
  assignedAt: string;
}

// ---------------------------------------------------------------------------
// Journey
// ---------------------------------------------------------------------------

export interface Journey {
  /** Human-readable unique ID, e.g. "JRN-0007". */
  JourneyID: string;

  /** PersonID of the person this journey is for. Foreign key to People list. */
  PersonID: string;

  /** The kind of operational workflow. */
  Type: JourneyType;

  /** Current lifecycle state. */
  Status: JourneyStatus;

  /** ISO 8601 datetime the journey was initiated. */
  InitiatedAt: string;

  /** UserID or display name of the staff member who initiated the journey. */
  InitiatedBy: string;

  /**
   * Overall governance owner — accountable for the person reaching operational readiness.
   * This is the journey-level owner. Obligation-level execution owners are in
   * obligationAssignments.
   */
  AssignedTo?: string;

  /** Free-text reason for initiation (e.g. "New signing from LEC"). Optional. */
  InitiationReason?: string;

  /**
   * ContractID this journey is linked to.
   * Used for ContractRenewal and Offboarding journeys.
   */
  ContractID?: string;

  /**
   * The Mission this Journey was initiated in context of (Sprint 10, M10-4).
   *
   * When set, this Journey was opened because the person is a participant in
   * a specific Mission and their credential gaps were surfaced via the Mission
   * gap view. Preserves the audit trail of why a Journey was opened.
   *
   * Does not restrict the Journey to that Mission — it remains a general
   * credential readiness workflow. The linkage is informational.
   *
   * Foreign key to Mission.MissionID (e.g. "TR/2026/006").
   */
  MissionID?: string;

  /** ISO 8601 datetime the journey reached Completed status. Null if still active. */
  CompletedAt?: string;

  /** Free-text notes for ops staff. */
  Notes?: string;

  /**
   * Per-obligation ownership declarations (Sprint 9).
   *
   * Each entry assigns a specific obligation type to an operational owner.
   * Gaps whose obligation type matches an entry here are Covered in the
   * Situation Room. Gaps without a matching entry are Routed.
   *
   * Optional: journeys started without explicit obligation assignments are
   * Routed (journey exists, coverage not declared).
   */
  obligationAssignments?: ObligationAssignment[];
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type InitiateJourneyInput = {
  PersonID: string;
  Type: JourneyType;
  InitiatedBy: string;
  AssignedTo?: string;
  InitiationReason?: string;
  ContractID?: string;
  /**
   * The Mission this Journey is being initiated in context of (Sprint 10, M10-4).
   * Set when the operator opens the StartJourneyPanel from a Mission-scoped gap.
   */
  MissionID?: string;
  Notes?: string;
  /** Optional obligation-level assignments recorded at journey initiation. */
  obligationAssignments?: ObligationAssignment[];
};
