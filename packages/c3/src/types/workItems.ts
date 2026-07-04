/**
 * WorkItem — Sprint 11 (Command Center: Operational Work Queue)
 *
 * Core distinction: OperationalGap = evidence (describes state).
 *                   WorkItem       = intent (describes work).
 *
 * OperationalGap answers "what is operationally true?"
 * WorkItem answers "what does an operator need to do about it?"
 *
 * A WorkItem is always generated from a trigger (OperationalGap, MissionDeparture,
 * MilestoneGap, or future trigger types). It is never created manually by an operator.
 *
 * Sprint 11 computes WorkItems from live operational state. IDs are deterministic
 * — the same underlying condition always produces the same WorkItem ID. This makes
 * the model persistence-ready without requiring any schema changes.
 *
 * Sprint 12 adds MilestoneAlert / MilestoneGap for planning-spine integration.
 *
 * See: docs/architecture/WorkItem Model — Sprint 11 Design.md
 * See: docs/releases/Sprint 12 Proposal.md
 */

import type { UrgencyTier } from './situation';

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

/**
 * The operational type of work a WorkItem represents.
 *
 * CredentialRenewal      — An existing credential is approaching expiry. Action: renew it.
 * CredentialAcquisition  — A required credential does not exist. Action: obtain it.
 * JourneyInitiation      — Unrouted gaps exist for a person. Action: start their Journey.
 * ObligationRouting      — A Journey exists but specific obligations are unassigned.
 *                          Action: assign an owner to the obligation.
 * MissionDeparturePressure — A Mission is departing within 30 days with unresolved
 *                            gaps for its participants. Action: review the Mission in
 *                            the Situation Room and resolve blocking gaps.
 * MilestoneAlert         — A planning milestone is Overdue or DueSoon for a Mission.
 *                          Action: resolve the planning gap and mark complete.
 *                          Sprint 12 (Mission Milestones).
 * MissionReadinessGap    — A readiness facet of an upcoming mission is in a
 *                          state that cannot resolve itself. Sprint 30 v1 emits
 *                          it for exactly one condition: a Confirmed/Active
 *                          mission inside the departure-pressure window with
 *                          ZERO active participants (which generates no gaps
 *                          and therefore no MissionDeparturePressure item —
 *                          this closes that blind spot). Action: assign the
 *                          roster in the Mission workspace.
 *
 * Note: MissionDeparturePressure, MilestoneAlert, and MissionReadinessGap are
 * mission-scoped categories. All others are scoped to a single person.
 */
export type WorkItemCategory =
  | 'CredentialRenewal'
  | 'CredentialAcquisition'
  | 'JourneyInitiation'
  | 'ObligationRouting'
  | 'MissionDeparturePressure'
  | 'MilestoneAlert'
  | 'MissionReadinessGap';

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/**
 * Three-tier priority for operator attention ordering.
 *
 * Distinct from UrgencyTier (Critical / High / Medium), which describes the
 * urgency of an individual OperationalGap. WorkItemPriority applies mission
 * pressure, departure proximity, and routing state as additional signals to
 * determine what an operator should move on *now*.
 *
 * Immediate — Act today. Mission departs ≤ 7 days, or an unrouted critical gap
 *             exists for a mission participant within that window.
 * High      — Act this week. Mission departs ≤ 14 days, or a critical gap exists
 *             for a mission participant, or a credential expires within 30 days.
 *             Also: any overdue MilestoneAlert regardless of departure proximity.
 * Normal    — Act when capacity allows. All ObligationRouting items. Gaps not
 *             linked to an imminent mission. MilestoneAlert items due 4–14 days
 *             with no imminent departure.
 */
export type WorkItemPriority = 'Immediate' | 'High' | 'Normal';

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * Lifecycle state of a WorkItem.
 *
 * Sprint 11: all computed WorkItems are Open. InProgress and Resolved are
 * modelled now so the persistence layer can adopt them without a type change.
 *
 * Resolved WorkItems should disappear from the computed queue once the underlying
 * condition clears (credential renewed, Journey started, milestone completed, etc.).
 * Persistence layer will need to archive orphaned Resolved records when that happens.
 */
export type WorkItemStatus = 'Open' | 'InProgress' | 'Resolved';

// ---------------------------------------------------------------------------
// OwnerSource
// ---------------------------------------------------------------------------

/**
 * Describes how the `owner` field on a WorkItem was determined.
 *
 * Used to colour-code owner badges in the UI — an explicit obligation assignment
 * is higher-confidence than a protocol default suggestion.
 *
 * ObligationAssignment — Explicit. Sourced from journey.obligationAssignments.
 *                        Highest confidence: someone committed to owning this gap.
 * JourneyOwner         — Derived. Sourced from journey.AssignedTo.
 *                        A person is engaged with this person's readiness, but
 *                        hasn't explicitly committed to this specific obligation.
 * ProtocolDefault      — Suggested. Sourced from obligation.defaultOwner or
 *                        milestone.Owner. The protocol recommends this role/person,
 *                        but no one has actively accepted the work.
 * Unrouted             — No ownership determined. Highest urgency signal.
 */
export type OwnerSource =
  | 'ObligationAssignment'
  | 'JourneyOwner'
  | 'ProtocolDefault'
  | 'Unrouted';

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

/**
 * What generated this WorkItem.
 *
 * OperationalGap   — Triggered by a single gap computed by useOperationalGaps
 *                    or useMissionGaps. Person-scoped.
 * MissionDeparture — Triggered by a Mission entering the 30-day departure
 *                    window with unresolved participant gaps. Cross-person.
 * MilestoneGap     — Triggered by a planning milestone that is Overdue or DueSoon.
 *                    Mission-scoped. Sprint 12 (Mission Milestones).
 * MissionReadinessGap — Triggered by a readiness facet of an upcoming mission.
 *                    Mission-scoped. Sprint 30 v1: facet 'Participants' only
 *                    (zero-roster condition). The facet discriminator exists so
 *                    a future kit facet trigger extends this variant without
 *                    renaming the work-item type or category.
 *
 * Future trigger types (not Sprint 11/12/30): ContractExpiry, RosterChange, ManualEntry.
 */
export type WorkItemTrigger =
  | {
      type: 'OperationalGap';
      personId: string;
      obligationId: string;
      /** The urgency of the underlying gap — used in priority computation. */
      gapUrgency: UrgencyTier;
    }
  | {
      type: 'MissionDeparture';
      missionId: string;
      openGapCount: number;
      daysUntilDeparture: number;
    }
  | {
      type: 'MilestoneGap';
      missionId: string;
      missionName: string;
      milestoneId: string;
      milestoneName: string;
      /**
       * Days until (positive) or since (negative) the milestone's PlannedDate.
       * Negative = overdue. Used in priority computation.
       */
      daysUntilDue: number;
      daysUntilDeparture: number;
    }
  | {
      type: 'MissionReadinessGap';
      missionId: string;
      /**
       * The readiness facet in a gap state. Sprint 30 v1: 'Participants' only.
       * A future kit trigger adds 'Kit' here — the type is designed to extend
       * without renaming.
       */
      facet: 'Participants';
      daysUntilDeparture: number;
    };

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/**
 * Navigation targets for this WorkItem.
 *
 * Determines where the action button navigates the operator.
 *
 * personId  — Navigate to PersonProfile → Readiness tab.
 * missionId — Navigate to Situation Room pre-scoped to this Mission.
 *             Used by MissionDeparturePressure and MilestoneAlert items.
 */
export interface WorkItemLinks {
  personId?: string;
  missionId?: string;
}

// ---------------------------------------------------------------------------
// WorkItem
// ---------------------------------------------------------------------------

/**
 * A single unit of operational work.
 *
 * WorkItems are generated by workItemGenerators.ts from live operational state.
 * They are never created manually. Status is always Open in Sprint 11/12.
 *
 * Deterministic IDs per category:
 *   JourneyInitiation:        ji-{personId}
 *   CredentialAcquisition:    ca-{personId}-{obligationType}
 *   CredentialRenewal:        cr-{personId}-{obligationType}
 *   ObligationRouting:        or-{personId}-{obligationType}
 *   MissionDeparturePressure: mdp-{missionId}
 *   MilestoneAlert:           ml-{milestoneId}
 *   MissionReadinessGap:      mrg-{missionId}-{facetSlug} (v1: mrg-{missionId}-participants)
 *
 * The ID uniquely identifies the operational condition. Same condition → same ID.
 * When a persistence layer is introduced, WorkItems can be matched to persisted
 * state by ID without any migration.
 */
export interface WorkItem {
  /**
   * Deterministic ID derived from the trigger.
   * Same underlying operational condition always produces the same ID.
   * Persistence-path ready — see note above.
   */
  id: string;

  category: WorkItemCategory;

  /** Short action-oriented title. e.g. "Renew Alex Chen's UK Work Permit" */
  title: string;

  /** One-line supporting context. e.g. "Expires in 11 days · Senior Manager" */
  detail?: string;

  /**
   * Person or role responsible for executing this work.
   * May be a display name (e.g. "Sarah K.") or a role label (e.g. "Operations").
   * Absent when ownerSource is 'Unrouted'.
   */
  owner?: string;

  /** How the owner was determined — drives badge colour in the UI. */
  ownerSource: OwnerSource;

  priority: WorkItemPriority;

  /**
   * ISO date of the earliest binding deadline.
   * Credential expiry, Mission start date, milestone PlannedDate, or obligation due date.
   * Absent when no concrete deadline applies.
   */
  dueDate?: string;

  /**
   * Name of the Mission this work item is blocking, if any.
   * Shown as an accent chip in the WorkItemCard.
   * Drives priority escalation in workItemPriority.ts.
   */
  blockingMission?: string;

  /** Sprint 11: always 'Open'. Modelled for the persistence path. */
  status: WorkItemStatus;

  /** The operational signal that generated this WorkItem. */
  trigger: WorkItemTrigger;

  /** Navigation targets. Determines action button destination. */
  links: WorkItemLinks;
}
