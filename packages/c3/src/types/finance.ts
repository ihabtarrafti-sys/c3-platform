/**
 * Finance types — C3 Platform
 *
 * MissionFinanceLine is the atomic unit of financial planning for a Mission.
 * One record per budget item. Income and expense lines coexist under the same entity.
 *
 * Everything about financial health — totals, variance, settlement completeness —
 * is computed at query time from raw lines via computeMissionFinanceSummary.
 * Nothing is stored redundantly on the Mission or elsewhere.
 *
 * Mission.Status carries the financial lifecycle:
 *   Planning → FinancePending → Confirmed → Active → PostMission → Settled
 * No separate FinanceStatus field is needed or modelled.
 *
 * v1 constraints:
 *   - One OperatingCurrency per Mission. All lines in that currency. No conversion.
 *   - The only write in v1 is useApproveMission (Mission.Status → Confirmed).
 *   - No line creation, editing, actuals entry, or settlement marking from UI.
 *
 * Ref: docs/architecture/Mission Finance v1 — Design.md
 */

// ---------------------------------------------------------------------------
// FinanceLineDirection
// ---------------------------------------------------------------------------

export type FinanceLineDirection = 'Income' | 'Expense';

// ---------------------------------------------------------------------------
// FinanceLineCategory
// ---------------------------------------------------------------------------

/**
 * Category taxonomy for MissionFinanceLine.
 *
 * Income categories:
 *   PrizeMoney          — Tournament prize pool allocation
 *   AppearanceFee       — Organiser appearance payment
 *   TravelReimbursement — Organiser-covered travel costs
 *   Sponsorship         — Sponsor funding for this specific mission
 *   RevenueShare        — Streaming / content rights revenue
 *
 * Expense categories:
 *   RegistrationFee — Tournament or league entry fee
 *   Travel          — Flights — mission-level or per-participant
 *   Accommodation   — Hotel — mission-level or per-participant
 *   PerDiem         — Daily allowance — per-participant
 *   PlayerFee       — Player appearance / participation fee
 *   Equipment       — Hardware, peripherals, team gear
 *   Logistics       — Freight, customs, local transport
 *   Contingency     — Reserve buffer; unallocated expense headroom
 */
export type FinanceLineCategory =
  // Income
  | 'PrizeMoney'
  | 'AppearanceFee'
  | 'TravelReimbursement'
  | 'Sponsorship'
  | 'RevenueShare'
  // Expense
  | 'RegistrationFee'
  | 'Travel'
  | 'Accommodation'
  | 'PerDiem'
  | 'PlayerFee'
  | 'Equipment'
  | 'Logistics'
  | 'Contingency';

// ---------------------------------------------------------------------------
// MissionFinanceLine
// ---------------------------------------------------------------------------

/**
 * One budget line in a Mission's financial plan.
 *
 * LineID format: fl-{missionSequence}-{lineSequence}
 * Examples: fl-006-01 (TR/2026/006, line 1), fl-003-01 (SATR/2026/003, line 1)
 *
 * Participant-linked vs mission-level:
 *   Set ParticipantID for per-person lines (Travel per flight, PerDiem, PlayerFee).
 *   Leave undefined for mission-level lines (RegistrationFee, Equipment, all income).
 *
 * Actuals model:
 *   ActualAmount is undefined until known. Overwrite model in v1 — no history.
 *   A line may have a PlannedAmount without an ActualAmount for the whole mission
 *   lifecycle (e.g. PrizeMoney when the result is unknown).
 */
export interface MissionFinanceLine {
  /** Unique identifier. Format: fl-{missionSequence}-{lineSequence}. */
  LineID:        string;
  /** MissionID this line belongs to (TR code, e.g. "TR/2026/006"). */
  MissionID:     string;
  Direction:     FinanceLineDirection;
  Category:      FinanceLineCategory;
  /** Human-readable description, e.g. "Flights — PER-0001 (RL/PL/026)". */
  Description:   string;
  /**
   * PersonID of the Mission participant this line applies to.
   * Undefined = mission-level line (whole delegation).
   * Set for Travel (per-person flight), PerDiem, PlayerFee.
   */
  ParticipantID?: string;
  /**
   * Planned amount in Mission.OperatingCurrency.
   * Always set. Represents the budget expectation at plan time.
   */
  PlannedAmount:  number;
  /**
   * Actual amount in Mission.OperatingCurrency.
   * Undefined until known (invoice received or money moved).
   * Overwrite model: corrections update this field directly.
   */
  ActualAmount?:  number;
  /**
   * True when the money has definitively moved:
   *   Expense → payment made (PO issued, wire confirmed)
   *   Income  → funds received
   * v1: set manually by the operator. No payment system integration.
   */
  IsSettled:      boolean;
  Notes?:         string;
  /** ISO timestamp when this line was created. */
  CreatedAt:      string;
}

// ---------------------------------------------------------------------------
// MissionFinanceSummary
// ---------------------------------------------------------------------------

/**
 * Computed financial health of a Mission.
 * Derived from MissionFinanceLine[] at query time. Never stored.
 *
 * Variance notes:
 *   variance = actualNet - plannedNet
 *   Positive = better than plan (more income or less expense than expected).
 *   Negative = worse than plan.
 *   Unreliable while most ActualAmounts are missing. Meaningful in PostMission.
 *
 * Settlement notes:
 *   isFullySettled = true only when every line has IsSettled = true.
 *   An empty line list returns isFullySettled = false (no settlement without lines).
 */
export interface MissionFinanceSummary {
  totalLineCount:        number;
  settledLineCount:      number;

  // --- Planned ---
  totalPlannedIncome:    number;
  totalPlannedExpenses:  number;
  /** totalPlannedIncome − totalPlannedExpenses */
  plannedNet:            number;

  // --- Actuals (partial until PostMission) ---
  /** Sum of ActualAmount for Income lines. Treats undefined as 0. */
  totalActualIncome:     number;
  /** Sum of ActualAmount for Expense lines. Treats undefined as 0. */
  totalActualExpenses:   number;
  /** totalActualIncome − totalActualExpenses */
  actualNet:             number;

  /** actualNet − plannedNet */
  variance:              number;

  /** True when lines.length > 0 and every line is settled. */
  isFullySettled:        boolean;
  /** True when at least one line has ActualAmount set. */
  hasActuals:            boolean;
}
