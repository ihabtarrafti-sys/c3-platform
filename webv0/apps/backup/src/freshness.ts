/**
 * freshness.ts — pure stale-backup evaluation, shared by the monitor.
 * The monitor reads status/latest-success.json (read-only credential) and
 * NEVER downloads or decrypts a dump. This module decides stale vs. fresh.
 */
export const DEFAULT_STALE_THRESHOLD_HOURS = 36;

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
  if (ageHours > thresholdHours) {
    return { stale: true, reason: `Newest backup is ${ageHours.toFixed(1)}h old (threshold ${thresholdHours}h).`, ageHours, lastSuccessUtc: ts };
  }
  return { stale: false, reason: `Fresh: newest backup is ${ageHours.toFixed(1)}h old.`, ageHours, lastSuccessUtc: ts };
}
