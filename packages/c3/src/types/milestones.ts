/**
 * MissionMilestone — Sprint 12 (Mission Milestones: Planning Spine)
 *
 * Milestones are planning checkpoints, not task managers. A milestone marks
 * that something has been arranged or confirmed — not the process of arranging it.
 *
 * Design principles:
 *   - MilestoneStatus is computed from PlannedDate + CompletedDate. Never stored.
 *   - The only write operation in v1 is "Mark Complete" (sets CompletedDate).
 *   - Milestones that are Overdue or DueSoon generate MilestoneAlert WorkItems.
 *   - Blocked milestones are modelled but skipped in WorkItem generation (v1).
 *
 * See: docs/releases/Sprint 12 Proposal.md
 */

// ---------------------------------------------------------------------------
// MilestoneStatus
// ---------------------------------------------------------------------------

/**
 * Computed state of a milestone.
 *
 * Complete  — CompletedDate is set. No further action required.
 * Overdue   — PlannedDate has passed; CompletedDate is null. Generates a
 *             High priority MilestoneAlert WorkItem.
 * DueSoon   — PlannedDate is within 7 days; CompletedDate is null. Generates
 *             a MilestoneAlert WorkItem (priority varies by departure proximity).
 * Upcoming  — PlannedDate is more than 7 days out; CompletedDate is null.
 *             No WorkItem generated yet.
 * Blocked   — One or more DependsOn milestones are not yet Complete.
 *             Modelled in v1; WorkItem generation skips Blocked milestones.
 */
export type MilestoneStatus =
  | 'Complete'
  | 'Overdue'
  | 'DueSoon'
  | 'Upcoming'
  | 'Blocked';

// ---------------------------------------------------------------------------
// MilestoneCategory
// ---------------------------------------------------------------------------

/**
 * The planning domain this milestone belongs to.
 * Determines grouping and icon in the Situation Room milestone section.
 *
 * Roster      — Participant selection and eligibility confirmation.
 * Compliance  — Visa applications, tournament registration, credential checks.
 * Logistics   — Flights, accommodation, equipment shipping, freight.
 * Finance     — Budget approval, expense planning, PO issuance.
 * Documents   — Document collection, verification, and pack assembly.
 * Event       — Arrival, practice sessions, match day, departure.
 * PostMission — Expense claims, prize payout, debrief, settlement.
 */
export type MilestoneCategory =
  | 'Roster'
  | 'Compliance'
  | 'Logistics'
  | 'Finance'
  | 'Documents'
  | 'Event'
  | 'PostMission';

// ---------------------------------------------------------------------------
// MissionMilestone
// ---------------------------------------------------------------------------

/**
 * A planning checkpoint within a Mission.
 *
 * Milestones are stored records (not computed). They are created outside the
 * platform in v1 (seeded via mock; future SharePoint list). The only write
 * operation available to operators in v1 is completeMilestone, which sets
 * CompletedDate.
 *
 * Deterministic WorkItem IDs for milestone gaps:
 *   MilestoneAlert: ml-{MilestoneID}
 *
 * DependsOn is modelled for future enforcement. In v1 it is stored but not
 * displayed and does not block WorkItem generation.
 */
export interface MissionMilestone {
  MilestoneID:    string;
  MissionID:      string;
  Name:           string;
  Description?:   string;
  Category:       MilestoneCategory;
  /** Person or role responsible. e.g. "Ops Coordinator" or "Sarah K." */
  Owner?:         string;
  /** ISO date — when this milestone must be done. */
  PlannedDate:    string;
  /** ISO date — when it was completed. Null if not yet done. */
  CompletedDate?: string;
  /**
   * MilestoneIDs that must be Complete before this milestone can be actioned.
   * Modelled in v1. Not enforced or displayed in Sprint 12.
   */
  DependsOn?:     string[];
  Notes?:         string;
  CreatedAt:      string;
}

// ---------------------------------------------------------------------------
// MissionMilestoneView
// ---------------------------------------------------------------------------

/**
 * MissionMilestone extended with computed fields for UI rendering.
 *
 * Produced by computeMilestoneView(milestone) in milestoneUtils.ts.
 * Never stored — always derived from the raw MissionMilestone at read time.
 *
 * daysUntilDue:
 *   positive — days remaining until PlannedDate
 *   negative — days since PlannedDate passed (overdue)
 *   null     — milestone is already Complete (no deadline pressure)
 */
export interface MissionMilestoneView extends MissionMilestone {
  status:       MilestoneStatus;
  daysUntilDue: number | null;
}
