/**
 * money.ts — the Tablework money-input PARSE capability (F3 / ③).
 *
 * One shared core behind three NAMED parsers. The names carry the zero-policy
 * because a name is explicit and greppable at the call site; a boolean flag
 * would invite silently passing the wrong policy on a money path.
 *
 * ⚖️ M-02 throughout: exact digit-split, integer minor units / bps only. Excess
 * precision is a REFUSAL (null), never a silent round — `percentToBps('5.555')`
 * and `positiveAmountToMinor('1.005')` both refuse rather than pick a rounding.
 * Floats never enter the result; the digits are split and combined as integers.
 *
 * ⚠️ ZERO IS A REAL DISTINCTION, NOT DRIFT. A 0% org share (all-to-players) and
 * a 0% zero-rated VAT are legitimate, so those sites take `percentToBps`. A 0%
 * agreement term is meaningless, so that site takes `positivePercentToBps`.
 *
 * ⚠️ Per-row guards belong at the CALL SITE, not in here. DistributionsSection
 * requires each share row to be > 0 while its org row legitimately accepts 0 —
 * both read the same parser. Pulling that guard inward would silently reject a
 * valid 0% org share: a money-behavior change wearing a refactor's clothes.
 */
import { parseDecimalToMinor } from '@c3web/domain';

/**
 * Percent string → bps, ZERO ALLOWED. "15" → 1500; "5.5" → 550; null when not
 * a 0..100 percent at bps resolution.
 */
export function percentToBps(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return bps <= 10000 ? bps : null;
}

/** Percent string → bps, ZERO REJECTED: 0 < p ≤ 100 at bps resolution. */
export function positivePercentToBps(input: string): number | null {
  const bps = percentToBps(input);
  return bps !== null && bps > 0 ? bps : null;
}

/**
 * Major-units string → integer minor units, ZERO REJECTED; null when not a
 * positive amount. Delegates the digit-split to the domain parser.
 */
export function positiveAmountToMinor(input: string): number | null {
  const minor = parseDecimalToMinor(input);
  return minor !== null && minor > 0 ? minor : null;
}
