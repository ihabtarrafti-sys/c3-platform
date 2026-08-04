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
 * ⛔ CR-031 — WHAT THE MONITOR IS WATCHING, STATED RATHER THAN ASSUMED.
 *
 * This used to project only `lastSuccessUtc` out of the marker and ignore the rest.
 * The marker names its own `environment` and `mode`, and the monitor read NEITHER —
 * so a perfectly fresh, perfectly genuine PRODUCTION marker satisfied the STAGING
 * monitor, and a fresh `weekly` marker satisfied a monitor watching for `daily`.
 * The tile went green on evidence about a different subject.
 *
 * ⚖️ This is LAW 32's neighbour: there, a check that could not reach its subject
 * reported healthy; here, a check reaches the WRONG subject and reports healthy.
 * Both produce a green that means nothing, and green-that-means-nothing is worse
 * than red — it is the answer that stops the question being asked.
 *
 * ⇒ The expectation is a REQUIRED argument, not an optional one with a default.
 * An optional subject is the same hole with better manners: every caller that
 * forgets it silently returns to the old behaviour, and the type system —
 * the only thing that can enforce this across two independent mirrors — says
 * nothing. Making it required means a new reader CANNOT be written without
 * deciding what it is watching.
 */
export interface FreshnessExpectation {
  /** The environment label the marker must carry, e.g. 'staging' | 'production'. */
  readonly environment: string;
  /** The backup mode the marker must carry, e.g. 'daily'. */
  readonly mode: string;
  /** Age beyond which the newest backup is stale. Defaults to 36h. */
  readonly thresholdHours?: number;
}

/**
 * @param latestSuccessJson raw body of status/latest-success.json, or null if
 *        the object is missing/unreadable.
 * @param expected the subject this monitor is responsible for — see CR-031.
 */
export function evaluateFreshness(
  latestSuccessJson: string | null,
  now: Date,
  expected: FreshnessExpectation,
): FreshnessResult {
  const thresholdHours = expected.thresholdHours ?? DEFAULT_STALE_THRESHOLD_HOURS;
  if (!latestSuccessJson) {
    return { stale: true, reason: 'No latest-success marker found (no successful backup recorded).', ageHours: null, lastSuccessUtc: null };
  }
  let parsed: { lastSuccessUtc?: unknown; environment?: unknown; mode?: unknown };
  try {
    parsed = JSON.parse(latestSuccessJson);
  } catch {
    return { stale: true, reason: 'latest-success marker is not valid JSON.', ageHours: null, lastSuccessUtc: null };
  }

  /*
   * ⛔ CR-031 — THE SUBJECT IS BOUND BEFORE THE AGE IS EVEN LOOKED AT.
   *
   * Order matters here. A marker for the wrong environment is not "fresh evidence
   * with a caveat" — it is evidence about something else, and its age is irrelevant.
   * Checking age first and subject second would let a fresh production marker
   * compute a reassuring `ageHours` on its way to being rejected, which is exactly
   * the number a future reader would be tempted to surface.
   *
   * ⚠️ An ABSENT discriminator fails closed, and deliberately reads differently from
   * a MISMATCHED one: "I cannot tell what this marker describes" and "this marker
   * describes something else" are different problems with different fixes, and a
   * shared message would hide which one occurred.
   */
  for (const [field, want] of [
    ['environment', expected.environment],
    ['mode', expected.mode],
  ] as const) {
    const got = parsed[field];
    if (typeof got !== 'string' || got.length === 0) {
      return {
        stale: true,
        reason: `latest-success marker does not name its ${field} — an unbound marker cannot be confirmed to describe the ${want} backup this monitor is responsible for.`,
        ageHours: null,
        lastSuccessUtc: null,
      };
    }
    if (got !== want) {
      return {
        stale: true,
        reason: `latest-success marker is for ${field}=${got}, but this monitor watches ${field}=${want} — fresh evidence about a different subject is not evidence about this one.`,
        ageHours: null,
        lastSuccessUtc: null,
      };
    }
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
