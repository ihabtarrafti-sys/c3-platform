const normalizeToMidnight = (isoStr: string): Date => {
  const datePart = isoStr.split('T')[0];
  return new Date(datePart + 'T00:00:00Z');
};

// ---------------------------------------------------------------------------
// normalizeSpDate
//
// Normalises a raw SharePoint date/datetime column value to a date-only
// string ("YYYY-MM-DD") for use in the Credential, Journey, and other
// SP-backed interfaces.
//
// Invalid input → undefined, NOT a sentinel date.
//   A sentinel (e.g. "1970-01-01") would cause computeUrgency to treat the
//   document as critically expired from 56 years ago. undefined means the
//   document is treated as non-expiring — the safer operational default.
//   The warning log records the anomaly for correction.
//
//   null / undefined / ''  → undefined (silent — absent field is expected)
//   non-string             → undefined + console.warn
//   unparseable string     → undefined + console.warn
// ---------------------------------------------------------------------------

/**
 * Normalise a raw SharePoint date/datetime column value to a YYYY-MM-DD string.
 *
 * SP DateOnly columns return ISO-like strings ("2026-07-09T00:00:00Z").
 * SP DateTime columns return full ISO strings. Both are reduced to date-only.
 *
 * Shared by all SP mapper utilities (spCredentialMapper, spJourneyMapper, etc.)
 * to ensure consistent date normalisation and avoid divergence across mappers.
 *
 * @param val      Raw value from SP REST response (may be null, undefined, or string).
 * @param context  Log context label (e.g. "Item 7.ExpiryDate") for warning messages.
 * @param warnRef  Shared warn counter — incremented on non-fatal anomalies.
 * @returns        "YYYY-MM-DD" on success; undefined on null/empty/invalid.
 */
export function normalizeSpDate(
  val: unknown,
  context: string,
  warnRef: { count: number },
  prefix = '[C3/Credential]',
): string | undefined {
  if (val === null || val === undefined || val === '') return undefined;
  if (typeof val !== 'string') {
    console.warn(`${prefix} ${context}: unexpected date type ${typeof val} — treated as absent`);
    warnRef.count++;
    return undefined;
  }
  const d = new Date(val);
  if (isNaN(d.getTime())) {
    console.warn(`${prefix} ${context}: invalid date "${val}" — treated as absent (non-expiring)`);
    warnRef.count++;
    return undefined;
  }
  return d.toISOString().split('T')[0];
}

export const computeDaysToExpiry = (endDate: string): number => {
  const today = normalizeToMidnight(new Date().toISOString());
  const end = normalizeToMidnight(endDate);
  return Math.floor((end.getTime() - today.getTime()) / (86_400 * 1000));
};