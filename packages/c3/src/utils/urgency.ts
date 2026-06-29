import type { Obligation } from '@c3/types';
import type { UrgencyTier } from '@c3/types';

// ---------------------------------------------------------------------------
// Days to expiry
// ---------------------------------------------------------------------------

/**
 * Compute the number of days until an expiry date.
 *
 * Uses midnight-normalised UTC dates (same approach as dateUtils.computeDaysToExpiry)
 * to prevent timezone-driven off-by-one errors.
 *
 * Returns null when no expiryDate is provided.
 * Returns a negative number if the date has already passed.
 */
export const daysUntilExpiry = (expiryDate: string | undefined): number | null => {
  if (!expiryDate) return null;
  const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00Z');
  const expiry = new Date(expiryDate.split('T')[0] + 'T00:00:00Z');
  return Math.floor((expiry.getTime() - today.getTime()) / (86_400 * 1_000));
};

// ---------------------------------------------------------------------------
// Urgency computation
// ---------------------------------------------------------------------------

/**
 * Derive the urgency tier for an operational gap.
 *
 * Without horizonDate (general / rolling-window mode):
 *
 *   Critical  — Unsatisfied + no active Journey (uncovered gap, no accountability)
 *             — Expired credential (negative daysToExpiry, even if Journey exists)
 *   High      — Unsatisfied + active Journey (being worked, but gap remains open)
 *             — AtRisk with ≤ 30 days to expiry
 *   Medium    — AtRisk with 31–90 days to expiry
 *
 * With horizonDate (Mission-relative mode, Sprint 10):
 *
 *   horizonDate is Mission.Span.EndDate — the last day credentials must be valid.
 *
 *   Critical  — Unsatisfied, regardless of Journey (no credential → guaranteed to
 *               block the Mission; the deadline is fixed, not rolling)
 *             — AtRisk where credentialExpiryDate < horizonDate (expires before
 *               Mission ends; the credential will not cover the full commitment)
 *   High      — AtRisk where credentialExpiryDate ≥ horizonDate (credential covers
 *               the Mission span, but is expiring within 30 rolling days)
 *   Medium    — AtRisk where credentialExpiryDate ≥ horizonDate and 31–90 rolling days
 *
 * Key distinction: in Mission mode, an Unsatisfied gap with an active Journey is
 * still Critical — because the fixed Mission deadline makes the absence of a
 * credential categorically more urgent than in the rolling-window case. The Journey
 * may be in progress, but the clock is running against a known end date.
 *
 * Satisfied obligations should never reach this function; they are filtered out
 * before OperationalGap construction. A defensive Medium is returned if they do.
 *
 * @param obligation   The obligation being evaluated.
 * @param journeyId    The JourneyID of the active Journey for this person, if any.
 * @param horizonDate  Optional. When provided, urgency is relative to this date
 *                     (Mission.Span.EndDate) rather than rolling thresholds.
 *                     ISO date string, e.g. "2026-08-16".
 */
export const computeUrgency = (
  obligation: Obligation,
  journeyId: string | undefined,
  horizonDate?: string,
): UrgencyTier => {
  if (obligation.status === 'Satisfied') {
    return 'Medium'; // defensive — should not occur
  }

  // ── Mission-relative mode ─────────────────────────────────────────────────
  if (horizonDate) {
    if (obligation.status === 'Unsatisfied') {
      // No credential exists. The Mission has a fixed deadline. Critical regardless
      // of whether a Journey is in progress — urgency escalates to match the commitment.
      return 'Critical';
    }

    // AtRisk — credential exists. Does it cover the Mission's full span?
    const expiryDate = obligation.credentialExpiryDate;
    if (expiryDate) {
      // Normalize both dates to midnight UTC for a clean day comparison
      const expiry  = new Date(expiryDate.split('T')[0]  + 'T00:00:00Z');
      const horizon = new Date(horizonDate.split('T')[0] + 'T00:00:00Z');

      if (expiry < horizon) {
        // Credential lapses before the Mission ends — the participant will be
        // uncredentialed during the event. Critical.
        return 'Critical';
      }
    }

    // AtRisk but credential covers through horizonDate. Fall through to rolling
    // window urgency — the gap still exists (credential expiring) but the Mission
    // itself is not blocked.
  }

  // ── Rolling-window mode (default, and fall-through from mission AtRisk) ───
  if (obligation.status === 'Unsatisfied') {
    // Uncovered gap (no journey) is the worst operational state: no one is accountable.
    return journeyId ? 'High' : 'Critical';
  }

  // AtRisk — a credential exists but will lapse. Urgency depends on time pressure.
  const days = daysUntilExpiry(obligation.credentialExpiryDate);

  // Already expired — treat as Critical regardless of journey state
  if (days !== null && days < 0) {
    return 'Critical';
  }

  // Expiring within 30 days — High
  if (days !== null && days <= 30) {
    return 'High';
  }

  // Expiring in 31–90 days — Medium
  return 'Medium';
};
