import type { CredentialCapability } from './credentials';
import type { ProtocolContext, ProtocolFn } from './protocols';

// ---------------------------------------------------------------------------
// Urgency tier
// ---------------------------------------------------------------------------

/**
 * The urgency of an operational gap.
 *
 * Derived from a combination of obligation status, days to expiry, and whether
 * an active Journey exists (indicating the gap is being worked).
 *
 * Critical  — Unsatisfied + no active Journey (uncovered gap, no owner)
 *           — Expired credential (credential already invalid)
 * High      — Unsatisfied + active Journey (gap exists, being worked)
 *           — AtRisk with ≤ 30 days to expiry
 * Medium    — AtRisk with 31–90 days to expiry
 */
export type UrgencyTier = 'Critical' | 'High' | 'Medium';

// ---------------------------------------------------------------------------
// OwnershipState
// ---------------------------------------------------------------------------

/**
 * The three-state ownership model for an operational gap.
 *
 * Derived from operator pressure test (Sprint 8) — the binary Assigned/Unrouted
 * distinction proved insufficient. An operator who sees a Journey exists cannot
 * determine whether that Journey actually covers the specific obligation.
 *
 * Unrouted — No active Journey for this person. The gap has no accountability.
 *            This is an action signal: a Journey needs to be started.
 *            `defaultOwner` (from the Protocol) suggests who should own it.
 *
 * Routed   — An active Journey exists with AssignedTo set. Someone is engaged
 *            with this person's operational readiness. However, coverage is not
 *            explicit — the Journey has not declared ownership of this specific
 *            obligation. The gap may or may not be in scope.
 *
 * Covered  — An active Journey exists AND it explicitly declares responsibility
 *            for this obligation via obligationAssignments. The gap is genuinely
 *            owned. `assignedTo` identifies who holds execution responsibility.
 *            (Requires Sprint 9 Phase 3 — obligationAssignments on Journey.)
 *
 * Ref: Sprint 9 — Operational Gap Ownership
 * Ref: C3 Operator Validation — Sprint 8 Observations, Scenario 6
 */
export type OwnershipState = 'Unrouted' | 'Routed' | 'Covered';

// ---------------------------------------------------------------------------
// OperationalGap
// ---------------------------------------------------------------------------

/**
 * A single actionable operational gap.
 *
 * One OperationalGap is produced per non-Satisfied obligation, per person.
 * A person with three unsatisfied obligations appears three times — each gap
 * is a distinct operational problem with potentially different urgency,
 * ownership, and resolution path.
 *
 * The `blockingReason` field is first-class: it answers "what specifically is
 * preventing readiness?" in human-readable terms (e.g. "Visa expires in 11 days",
 * "No qualifying credential found"). This comes directly from obligation.statusReason.
 *
 * Ownership is three-tier (Sprint 9):
 *   - `ownershipState === 'Unrouted'` — no active Journey. Gap needs routing.
 *     `defaultOwner` suggests who should own it.
 *   - `ownershipState === 'Routed'` — Journey exists with AssignedTo. Someone is
 *     engaged but coverage is not explicitly declared for this obligation.
 *   - `ownershipState === 'Covered'` — Journey explicitly owns this obligation
 *     via obligationAssignments. `assignedTo` names the execution owner.
 *
 * Ref: Sprint 8 — Situation Room
 * Ref: Sprint 9 — Operational Gap Ownership
 * Ref: Ownership principle locked in Sprint 6E architecture review.
 */
export interface OperationalGap {
  // ── Person identity ──────────────────────────────────────────────────────
  personId: string;
  personName: string;
  personRole?: string;
  personTeam?: string;

  // ── The gap ──────────────────────────────────────────────────────────────
  /** Stable obligation identifier within the protocol evaluation. */
  obligationId: string;
  /** Human-readable description of what is required. */
  requirement: string;
  /** The capability that would satisfy this obligation. */
  satisfiedByCapability: CredentialCapability;
  /**
   * First-class explanation of what is blocking readiness.
   * Populated from obligation.statusReason.
   * Examples: "Visa expires in 11 days", "No qualifying credential found"
   */
  blockingReason: string;

  // ── Urgency ──────────────────────────────────────────────────────────────
  urgencyTier: UrgencyTier;
  /**
   * Days until the satisfying credential expires.
   * Null when no credential exists (Unsatisfied) or no expiry date is set.
   * Negative if already expired.
   */
  daysToExpiry: number | null;

  // ── Ownership ────────────────────────────────────────────────────────────
  /** JourneyID of the active Journey for this person, if one exists. */
  journeyId?: string;
  /**
   * The person/role holding execution responsibility for this specific gap.
   * Populated when ownershipState === 'Covered' (from obligationAssignments)
   * or 'Routed' (from Journey.AssignedTo as the journey-level owner).
   */
  assignedTo?: string;
  /**
   * Protocol-level suggested owner for gaps of this obligation type.
   * Always present — sourced from obligation.defaultOwner, defaulting to 'Operations'.
   * Surfaced in Unrouted and Routed states as a coordination hint.
   */
  defaultOwner: string;
  /**
   * Derived ownership state — see OwnershipState for full semantics.
   * Unrouted: no Journey. Routed: Journey exists, no explicit coverage.
   * Covered: Journey explicitly owns this obligation.
   */
  ownershipState: OwnershipState;

  // ── Audit ────────────────────────────────────────────────────────────────
  /** ISO timestamp of when the obligation evaluation was computed. */
  evaluatedAt: string;

  // ── Mission context (Sprint 10) ───────────────────────────────────────────
  /**
   * MissionID of the Mission this gap was computed for.
   * Only set when the gap was produced by useMissionGaps.
   * Absent on gaps produced by the general useOperationalGaps hook.
   */
  missionId?: string;
  /** Display name of the Mission. Only set alongside missionId. */
  missionName?: string;
}

// ---------------------------------------------------------------------------
// GapFilter
// ---------------------------------------------------------------------------

/**
 * Optional filter for `useOperationalGaps`.
 *
 * S14-5 audit (Sprint 14): All three fields are wired and handled correctly
 * by useOperationalGaps. The hook reads filter.protocols, filter.context, and
 * filter.personIds. No UI surface currently passes a non-null filter — each
 * field awaits a UI consumer:
 *
 *   personIds  — PersonSelector / Team scope filter (UI not yet built)
 *   context    — Tournament or Match span scope (UI not yet built).
 *                Note: useMissionGaps evaluates with ProtocolContext directly
 *                via its own evaluation path — it does not use GapFilter.
 *   protocols  — Multi-protocol mode (UI not yet built; requires
 *                jurisdiction-specific protocols such as evaluateKSAObligations)
 *
 * No hook changes are required to unlock filtering. Connect a UI consumer to
 * useOperationalGaps(filter) to enable each field.
 *
 * Note: ProtocolContext.mission is targeted for removal in S14-4. After that
 * change, GapFilter.context will carry only `span` and `jurisdiction`.
 */
export interface GapFilter {
  /**
   * Restrict evaluation to this subset of PersonIDs.
   * When omitted, all persons are evaluated.
   * UI consumer: PersonSelector or Team scope filter (not yet built).
   */
  personIds?: string[];

  /**
   * Protocol context forwarded to each protocol evaluation function.
   * Enables span-aware evaluation for Tournament or Match date ranges.
   * When omitted, protocols use their default threshold (90-day window).
   * UI consumer: Tournament / Match scope modal (not yet built).
   */
  context?: ProtocolContext;

  /**
   * The protocol functions to apply per person.
   * When omitted, defaults to [evaluateOnboardingObligations].
   * UI consumer: multi-protocol mode (not yet built).
   */
  protocols?: ProtocolFn[];
}
