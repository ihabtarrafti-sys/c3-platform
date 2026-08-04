/**
 * freshness.ts — pure stale-backup evaluation, shared by the monitor.
 * The monitor reads status/latest-success.json (read-only credential) and
 * NEVER downloads or decrypts a dump. This module decides stale vs. fresh.
 */
export const DEFAULT_STALE_THRESHOLD_HOURS = 36;

/** CR-012: clock skew tolerated before a future timestamp is ruled untrustworthy. */
export const FUTURE_SKEW_TOLERANCE_HOURS = 0.25;

export interface FreshnessResult {
  readonly stale: boolean;
  readonly reason: string;
  readonly ageHours: number | null;
  readonly lastSuccessUtc: string | null;
}

/**
 * @param latestSuccessJson raw body of status/latest-success.json, or null if
 *        the object is missing/unreadable.
 */
export function evaluateFreshness(
  latestSuccessJson: string | null,
  now: Date,
  thresholdHours: number = DEFAULT_STALE_THRESHOLD_HOURS,
): FreshnessResult {
  if (!latestSuccessJson) {
    return { stale: true, reason: 'No latest-success marker found (no successful backup recorded).', ageHours: null, lastSuccessUtc: null };
  }
  let parsed: { lastSuccessUtc?: unknown };
  try {
    parsed = JSON.parse(latestSuccessJson);
  } catch {
    return { stale: true, reason: 'latest-success marker is not valid JSON.', ageHours: null, lastSuccessUtc: null };
  }
  const ts = parsed.lastSuccessUtc;
  if (typeof ts !== 'string') {
    return { stale: true, reason: 'latest-success marker has no lastSuccessUtc.', ageHours: null, lastSuccessUtc: null };
  }
  const then = Date.parse(ts);
  if (Number.isNaN(then)) {
    return { stale: true, reason: `latest-success timestamp is unparseable: ${ts}`, ageHours: null, lastSuccessUtc: ts };
  }
  const ageHours = (now.getTime() - then) / 3_600_000;
  // ⛔ CR-012. A FUTURE timestamp used to read as FRESH: the age went negative,
  // `ageHours > threshold` was false, and the check passed. But a marker dated
  // in the future is not a newer backup — it is an UNTRUSTWORTHY marker (clock
  // skew at best; a corrupted or fabricated pointer at worst), and the one thing
  // it must not do is silence the monitor. Small skew is tolerated; beyond it,
  // the marker is treated as evidence of a problem, not of freshness.
  if (ageHours < -FUTURE_SKEW_TOLERANCE_HOURS) {
    return {
      stale: true,
      reason: `latest-success timestamp is in the FUTURE (${ts}, ${(-ageHours).toFixed(1)}h ahead) — an untrustworthy marker is not a fresh backup.`,
      ageHours,
      lastSuccessUtc: ts,
    };
  }
  if (ageHours > thresholdHours) {
    return { stale: true, reason: `Newest backup is ${ageHours.toFixed(1)}h old (threshold ${thresholdHours}h).`, ageHours, lastSuccessUtc: ts };
  }
  return { stale: false, reason: `Fresh: newest backup is ${ageHours.toFixed(1)}h old.`, ageHours, lastSuccessUtc: ts };
}
