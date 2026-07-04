/**
 * Mission readiness types — Sprint 30 (Mission Readiness Cockpit).
 *
 * Mission-specific by design — hence the file name types/missionReadiness.ts
 * (renamed from readiness.ts at Sprint 30 review: direct inspection confirmed
 * every type here is a mission-readiness concept and NONE is consumed by the
 * person-level readiness path). usePersonReadiness → ObligationEvaluation
 * describes one person's protocol evaluation; this model describes a
 * mission's aggregate operational readiness across facets. The two shapes
 * have no compatible axis — no generic readiness abstraction exists or is
 * introduced (approved Sprint 30 decision).
 *
 * Two-axis model (locked at Sprint 30 approval):
 *
 *   MissionEvaluationState — lifecycle applicability. Whether readiness is
 *     even a meaningful question for this mission right now.
 *   MissionReadinessState  — evaluated severity. Only meaningful when the
 *     evaluation state is 'Evaluated'.
 *
 * Lifecycle mapping (preserves ADR-002 — the activation gate is not modified):
 *   Planning       → NotEvaluated
 *   FinancePending → NotEvaluated
 *   Confirmed      → Evaluated
 *   Active         → Evaluated
 *   PostMission    → Evaluated
 *   Settled        → NotApplicable
 *   Canceled       → NotApplicable
 *
 * 'Unknown' is a trust failure, not a lifecycle state: an evaluation-eligible
 * mission whose required facet sources could not be loaded or trusted. A failed
 * query must never become an empty successful state — participant query
 * failure ≠ empty roster; kit query failure ≠ NotRecorded; credential/journey
 * query failure ≠ Clear compliance. Loading is a separate, hook-level concern
 * and is never represented in these types.
 *
 * Ref: docs/architecture/Mission Readiness Semantics — Sprint 30.md
 */

// ---------------------------------------------------------------------------
// Evaluation and readiness axes
// ---------------------------------------------------------------------------

/** Lifecycle applicability of readiness evaluation for a mission. */
export type MissionEvaluationState =
  | 'NotApplicable'  // Settled / Canceled — readiness is no longer a question
  | 'NotEvaluated'   // Planning / FinancePending — pre-ADR-002; no gap evidence exists by design
  | 'Evaluated'      // Confirmed / Active / PostMission with all required sources trusted
  | 'Unknown';       // evaluation-eligible, but a required facet source failed or is untrusted

/**
 * Evaluated severity. Only meaningful when evaluation is 'Evaluated'.
 * Overall precedence (worst wins): Blocked > AtRisk > Incomplete > Ready.
 */
export type MissionReadinessState = 'Ready' | 'Incomplete' | 'AtRisk' | 'Blocked';

// ---------------------------------------------------------------------------
// Facet statuses
// ---------------------------------------------------------------------------

/** Participants facet. Counts ACTIVE EXECUTED participants only. */
export type ParticipantsFacetStatus =
  | 'Unknown'  // participant source failed — never rendered as an empty roster
  | 'Empty'    // zero active participants — Incomplete, never Ready
  | 'Present';

/**
 * Compliance facet — existing mission-gap semantics (ADR-002 + mission-horizon
 * urgency). Journey/routing information is folded in via unroutedCount — there
 * is no separate journey facet (approved Sprint 30 decision).
 */
export type ComplianceFacetStatus =
  | 'Unknown'         // credential/journey/participant source failed — never rendered Clear
  | 'NoParticipants'  // zero participants: no one to evaluate — never rendered Clear
  | 'Clear'           // participants exist, all sources trusted, zero gaps
  | 'AtRisk'          // High/Medium gaps, no Critical
  | 'Blocked';        // at least one Critical gap

/**
 * Kit facet — participant-aware denominator. Fulfilled requires:
 *   1. at least one active participant;
 *   2. every active participant has ≥ 1 active kit assignment;
 *   3. every active assignment is Delivered or Confirmed;
 *   4. no active assignment is Missing.
 * Until an explicit kit-not-applicable model exists, every active participant
 * is assumed to require at least one active assignment.
 */
export type KitFacetStatus =
  | 'Unknown'      // kit (or participant) source failed — never rendered NotRecorded
  | 'NotRecorded'  // zero active kit rows (or zero participants to equip)
  | 'InProgress'   // rows exist but coverage or fulfillment is incomplete
  | 'Exception'    // at least one active assignment is Missing — never Ready
  | 'Fulfilled';

// ---------------------------------------------------------------------------
// Facet payloads
// ---------------------------------------------------------------------------

export interface ParticipantsFacet {
  status: ParticipantsFacetStatus;
  /** Active executed participants. Pending requests are NEVER in this count. */
  activeCount: number;
  /**
   * Pending AddMissionParticipant approvals for this mission (informational).
   * null = the pending-change indicator itself is Unknown (approval source
   * failed). A pending-source failure never invalidates the operational
   * evidence above and never invents executed membership.
   */
  pendingAdds: number | null;
  /** Pending RemoveMissionParticipant approvals. null = indicator Unknown. */
  pendingRemovals: number | null;
}

export interface ComplianceFacet {
  status: ComplianceFacetStatus;
  gapCount: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  /** Gaps with no journey accountability — the folded-in routing signal. */
  unroutedCount: number;
}

export interface KitFacet {
  status: KitFacetStatus;
  /** Active kit assignments for this mission. */
  totalAssignments: number;
  /** Assignments in a fulfilled state (Delivered or Confirmed). */
  fulfilledAssignments: number;
  /** Assignments in Missing — drives Exception. */
  missingAssignments: number;
  /** Active participants with ≥ 1 active assignment. */
  coveredParticipants: number;
  /** Active participants with zero active assignments — prevents Fulfilled. */
  uncoveredParticipants: number;
}

export interface MissionReadinessFacets {
  participants: ParticipantsFacet;
  compliance: ComplianceFacet;
  kit: KitFacet;
}

// ---------------------------------------------------------------------------
// MissionReadiness
// ---------------------------------------------------------------------------

/**
 * Computed readiness for one mission.
 *
 * Invariants:
 *   - overall is non-null iff evaluation === 'Evaluated'.
 *   - facets is non-null iff evaluation is 'Evaluated' or 'Unknown'
 *     (an Unknown mission still exposes the facets that DID load; the failed
 *     facet carries its own 'Unknown' status).
 *   - NotEvaluated / NotApplicable missions carry no facets and no overall:
 *     precedence is never applied to them.
 */
export interface MissionReadiness {
  missionId: string;
  evaluation: MissionEvaluationState;
  overall: MissionReadinessState | null;
  facets: MissionReadinessFacets | null;
}

// ---------------------------------------------------------------------------
// Computation inputs
// ---------------------------------------------------------------------------

/**
 * One data source feeding the readiness computation.
 * trusted=false means the source query failed or its result cannot be relied
 * on — the computation must expose Unknown for everything that depends on it,
 * never a successful empty state.
 */
export interface ReadinessSource<T> {
  data: T[];
  trusted: boolean;
}

/**
 * A pending participant-membership approval, parsed from C3Approvals.
 * Informational only: pending ≠ executed.
 */
export interface PendingParticipantChange {
  operationType: 'AddMissionParticipant' | 'RemoveMissionParticipant';
  missionId: string;
  personId: string;
}
