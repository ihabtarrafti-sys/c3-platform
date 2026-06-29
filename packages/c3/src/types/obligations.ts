/**
 * Obligation types — C3 Platform
 *
 * An Obligation is a compliance requirement that a person must satisfy to
 * participate in operations (play, travel, work). Obligations are evaluated
 * by protocol functions and resolved by holding active credentials.
 *
 * Sprint 6E added ObligationSpan to allow obligations to be scoped to a
 * specific operational window (e.g. a tournament date range).
 */

import type { CredentialCapability } from './credentials';

// ---------------------------------------------------------------------------
// ObligationSpan
// ---------------------------------------------------------------------------

/**
 * A date range during which an obligation must be satisfied.
 *
 * When a span is set, obligation evaluation checks that the satisfying
 * credential is valid throughout the entire span — not just at the time
 * of evaluation. This catches credentials that expire mid-tournament.
 *
 * Both dates are ISO 8601 date strings (YYYY-MM-DD).
 */
export interface ObligationSpan {
  from: string;
  to: string;
}

// ---------------------------------------------------------------------------
// ObligationStatus
// ---------------------------------------------------------------------------

/**
 * The compliance state of a single obligation.
 *
 *   Satisfied   — credential exists, is active, and does not expire within
 *                 the obligation's risk window.
 *   AtRisk      — credential exists but expires within the risk window
 *                 (default: 90 days, or span-derived).
 *   Unsatisfied — no active credential satisfies this obligation.
 */
export type ObligationStatus = 'Satisfied' | 'AtRisk' | 'Unsatisfied';

// ---------------------------------------------------------------------------
// Obligation
// ---------------------------------------------------------------------------

export interface Obligation {
  /** Unique identifier for this obligation within an evaluation result. */
  id: string;

  /** Name of the protocol that generated this obligation. */
  protocolName: string;

  /** PersonID of the person this obligation applies to. */
  targetPersonID: string;

  /** Human-readable description of what is required (shown in UI). */
  requirement: string;

  /** The capability that must be held to satisfy this obligation. */
  satisfiedByCapability: CredentialCapability;

  /** Current compliance state. */
  status: ObligationStatus;

  /** CredentialID of the credential satisfying this obligation. Null if Unsatisfied. */
  satisfiedByCredentialID?: string;

  /** ISO 8601 expiry date of the satisfying credential. Null if Unsatisfied or no expiry. */
  credentialExpiryDate?: string;

  /** Human-readable explanation of the current status (shown in UI). */
  statusReason: string;

  /**
   * The operational window this obligation must be satisfied throughout.
   * When present, AtRisk is computed relative to span.to rather than the
   * default forward window.
   */
  span?: ObligationSpan;

  /** Default owner role for this obligation (e.g. "Visa Officer", "Team Manager"). */
  defaultOwner?: string;
}

// ---------------------------------------------------------------------------
// ObligationEvaluation
// ---------------------------------------------------------------------------

/**
 * The complete result of running a protocol evaluation function for one person.
 *
 * Returned by ProtocolFn implementations and consumed by hooks and components.
 * The overallStatus is the worst status across all obligations.
 */
export interface ObligationEvaluation {
  /** PersonID the evaluation was run for. */
  personID: string;

  /** Name of the protocol that produced this evaluation. */
  protocolName: string;

  /** ISO 8601 datetime the evaluation was computed. */
  evaluatedAt: string;

  /** All obligations evaluated by the protocol. */
  obligations: Obligation[];

  /**
   * Aggregate status: worst of all obligation statuses.
   * Unsatisfied > AtRisk > Satisfied.
   */
  overallStatus: ObligationStatus;
}
