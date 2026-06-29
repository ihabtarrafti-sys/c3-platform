/**
 * Mission types — C3 Platform
 *
 * A Mission is Geekay's commitment to deploy people and resources to a defined
 * operational event within a specific time window and jurisdiction. It is the
 * moment a calendar entry becomes real: these people, these dates, this city,
 * this legal entity.
 *
 * Mission is the shared operational context that Obligations, Journeys,
 * Logistics, Finance, and Content all reference. It does not own those
 * domains — it provides the context they derive meaning from.
 *
 * Supersedes the Sprint 6E conceptual placeholder. Sprint 10 (M10-1) is the
 * first full implementation.
 *
 * Key design decision (ADR-002): Obligations are evaluated for Mission
 * participants only when Mission.Status ∈ { Confirmed, Active, PostMission }.
 * Planning and FinancePending missions do not generate operational gaps.
 *
 * Ref: docs/architecture/Mission Model — Architectural Analysis.md
 * Ref: docs/adr/ADR-002-mission-activation-gate.md
 */

// ---------------------------------------------------------------------------
// MissionStatus
// ---------------------------------------------------------------------------

/**
 * The lifecycle state of a Mission.
 *
 * State transitions:
 *   Planning → FinancePending → Confirmed → Active → PostMission → Settled
 *   Any state before Active → Canceled
 *
 * The Confirmed state is the activation gate (ADR-002). Obligations for
 * Mission participants are only evaluated when Status ∈ {Confirmed, Active,
 * PostMission}. Status changes to Settled or Canceled stop gap generation
 * immediately.
 *
 * Operationally, EndDate marks operational closure. Financially, SettlementDate
 * marks financial closure. PostMission spans the gap between the two — an
 * event may end in August but not be financially settled until December.
 */
export type MissionStatus =
  | 'Planning'        // Under consideration — no financial commitment made
  | 'FinancePending'  // Proposed to Finance — awaiting approval
  | 'Confirmed'       // Finance approved — obligations activate here (ADR-002 gate)
  | 'Active'          // Mission is in progress (StartDate has been reached)
  | 'PostMission'     // Event ended — awaiting financial settlement
  | 'Settled'         // Accounts closed — Mission is archived
  | 'Canceled';       // Commitment withdrawn at any pre-Active state

/**
 * Mission statuses that activate obligation evaluation for participants.
 * Used by useMissionGaps to enforce the ADR-002 activation gate.
 */
export const MISSION_OBLIGATION_ACTIVE_STATUSES: MissionStatus[] = [
  'Confirmed',
  'Active',
  'PostMission',
];

// ---------------------------------------------------------------------------
// Supporting types
// ---------------------------------------------------------------------------

/**
 * The legal entity fielding this Mission.
 * Derived from the TR code prefix: TR/ = UAE, SATR/ = KSA.
 */
export type MissionEntity = 'UAE' | 'KSA' | 'Multi';

/**
 * The operational time window of a Mission.
 *
 * Three distinct dates reflect three distinct closure events:
 *   StartDate      — first operational day; obligation spans begin here
 *   EndDate        — last operational day; credential validity must extend through this date
 *   SettlementDate — financial closure; may be weeks or months after EndDate
 *
 * Protocols use { from: StartDate, to: EndDate } as ProtocolContext.span.
 * Urgency computation uses EndDate as the horizon date.
 * SettlementDate is financial metadata — not used in operational gap computation.
 */
export interface MissionSpan {
  /** ISO date string — first operational day. Obligations begin here. */
  StartDate: string;
  /** ISO date string — last operational day. Credentials must be valid through this date. */
  EndDate: string;
  /** ISO date string — financial closure date. May be months after EndDate. */
  SettlementDate: string;
}

// ---------------------------------------------------------------------------
// MissionParticipantRole
// ---------------------------------------------------------------------------

/**
 * The operational role a person plays in a Mission.
 * Determines per diem rate tier and may affect credential requirements in
 * future jurisdiction-aware protocol implementations.
 */
export type MissionParticipantRole =
  | 'Player'
  | 'Coach'
  | 'Manager'
  | 'Analyst'
  | 'Staff';

// ---------------------------------------------------------------------------
// MissionParticipant
// ---------------------------------------------------------------------------

/**
 * A person's participation record for a specific Mission.
 *
 * The ExternalCode uses Geekay's existing participant code system:
 *   RL/PL/026  →  Game: Rocket League / Role: Player / Sequence: 026
 *   RL/CH/004  →  Game: Rocket League / Role: Coach  / Sequence: 004
 *
 * This code links the C3 PersonID to finance and logistics systems that
 * reference participants by code rather than by PersonID.
 *
 * PerDiemRate is the daily allowance for this participant on this Mission.
 * Rate tiers are role-dependent: Player 35 USD, Coach 25 USD, etc.
 * Surfaced in Finance views; not used in operational gap computation.
 */
export interface MissionParticipant {
  /** The Mission this participant belongs to. */
  MissionID: string;
  /** The C3 PersonID of the participant. */
  PersonID: string;
  /** External participant code (e.g. "RL/PL/026") for Finance/Logistics cross-reference. */
  ExternalCode: string;
  /** Operational role on this Mission. */
  Role: MissionParticipantRole;
  /** Daily allowance rate in the Mission's income currency. Optional — set when confirmed. */
  PerDiemRate?: number;
}

// ---------------------------------------------------------------------------
// Mission
// ---------------------------------------------------------------------------

/**
 * A Mission is Geekay's operational commitment to deploy people and resources
 * to a defined event within a specific time window and jurisdiction.
 *
 * MissionID follows the Geekay TR code system:
 *   TR/2026/006   — UAE entity, 2026, 6th commitment of the year
 *   SATR/2026/001 — KSA entity, 2026, 1st commitment of the year
 *
 * The same TR codes are used as Finance Sales Order references. Adopting them
 * as the platform identifier preserves cross-system linkage without introducing
 * a new ID namespace.
 *
 * Mission.Status drives obligation activation (see ADR-002).
 * Mission.Span drives obligation validity windows and urgency horizon dates.
 * Mission.Jurisdiction will drive jurisdiction-aware credential discrimination
 * in a future sprint (e.g. Schengen visa required for Paris).
 *
 * Finance and Logistics are consumers of Mission data. Mission does not own
 * budget lines, flight bookings, or accommodation records — those domains
 * produce their own views from Mission context.
 */
export interface Mission {
  /** TR code identifier, e.g. "TR/2026/006". Used as Finance Sales Order ref. */
  MissionID: string;
  /** Display name, e.g. "RLCS 2026 - World Championship & EWC". */
  Name: string;
  /** Game title, e.g. "Rocket League". Links to team and roster context. */
  Game: string;
  /** Tournament organiser, e.g. "Psyonix / EWC". */
  Organizer: string;
  /** Legal entity fielding this Mission. Derived from the TR code prefix. */
  Entity: MissionEntity;
  /** Current lifecycle state. Drives ADR-002 activation gate. */
  Status: MissionStatus;
  /**
   * Operational jurisdiction — where the Mission takes place.
   * Used to determine which credential requirements apply to participants.
   * Example: "Paris, France" → Schengen visa required for Travel obligation.
   * Jurisdiction-aware evaluation is deferred; this field is stored for future use.
   */
  Jurisdiction: string;
  /**
   * The operational time window.
   * StartDate and EndDate are used in ProtocolContext.span for obligation evaluation.
   * EndDate is the urgency horizon: credentials must be valid through this date.
   * SettlementDate is financial metadata.
   */
  Span: MissionSpan;
  /**
   * Operating currency for all financial planning on this Mission.
   * Denominator for all MissionFinanceLine records. All lines use this currency in v1.
   */
  OperatingCurrency?: 'USD' | 'AED' | 'SAR' | 'EUR';
  /** ISO timestamp when this Mission record was created. */
  CreatedAt: string;
  /** Name of the staff member who created this Mission. */
  CreatedBy: string;
  /** ISO timestamp when this Mission reached Confirmed status. */
  ConfirmedAt?: string;
  /** Name of the staff member who confirmed this Mission. */
  ConfirmedBy?: string;
  /** Free-text operational notes. */
  Notes?: string;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export interface MissionFilter {
  /** Only return Missions with these statuses. Omit for all statuses. */
  status?: MissionStatus[];
  /** Only return Missions for this entity. Omit for all entities. */
  entity?: MissionEntity;
}
