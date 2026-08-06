/**
 * money.ts — the Tablework money-input PARSE capability (F3 / ③).
 *
 * Four NAMED parsers, two per quantity. The names carry the zero-policy because
 * a name is explicit and greppable at the call site; a boolean flag would invite
 * silently passing the wrong policy on a money path.
 *
 * ⚖️ EVERY NAME STATES ITS POLICY — NONE READS AS "THE DEFAULT". The percent
 * side once shipped as `percentToBps` / `positivePercentToBps`, where the
 * unprefixed name looked like the ordinary one and its zero-allowing behaviour
 * was invisible at the call site. That is precisely how a consolidation picks
 * the familiar name and changes a zero policy in silence. Two conventions in one
 * module would be worse still: a reader learns the rule from whichever half they
 * meet first and is then confidently wrong about the other.
 *
 * ⚖️ LAYERING. The DOMAIN parses, THIS module names the policy, the CALL SITE
 * chooses. `parseDecimalToMinor` makes no policy choice — it answers "can this
 * string become minor units?" and returns null for malformed, so zero is a valid
 * parse RESULT there rather than a decision. It is deliberately NOT renamed;
 * naming machinery `…AllowingZero` would make it claim a judgement it never
 * makes. A kit export must state its policy; a domain primitive must not pretend
 * to hold one.
 *
 * ⚖️ M-02 throughout: exact digit-split, integer minor units / bps only. Excess
 * precision is a REFUSAL (null), never a silent round — `percentToBpsAllowingZero('5.555')`
 * and `positiveAmountToMinor('1.005')` both refuse rather than pick a rounding.
 * Floats never enter the result; the digits are split and combined as integers.
 *
 * ⚠️ ZERO IS A REAL DISTINCTION, NOT DRIFT. A 0% org share (all-to-players) and
 * a 0% zero-rated VAT are legitimate, so those sites take `percentToBpsAllowingZero`. A 0%
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
export function percentToBpsAllowingZero(input: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return bps <= 10000 ? bps : null;
}

/** Percent string → bps, ZERO REJECTED: 0 < p ≤ 100 at bps resolution. */
export function positivePercentToBps(input: string): number | null {
  const bps = percentToBpsAllowingZero(input);
  return bps !== null && bps > 0 ? bps : null;
}

/**
 * Major-units string → integer minor units, ZERO ALLOWED; null only when the
 * string is not a well-formed amount. "0.00" → 0.
 *
 * The completing half of the amount pair: registers that legitimately accept a
 * zero amount (a 0.00 subscription, a valued-at-nothing agreement) had no legal
 * kit target and reached past the kit for the domain parser instead.
 */
export function amountToMinorAllowingZero(input: string): number | null {
  return parseDecimalToMinor(input);
}

/**
 * Major-units string → integer minor units, ZERO REJECTED; null when not a
 * positive amount. Delegates the digit-split to the domain parser.
 */
export function positiveAmountToMinor(input: string): number | null {
  const minor = parseDecimalToMinor(input);
  return minor !== null && minor > 0 ? minor : null;
}

/**
 * A positive finite ratio, used for exchange rates. This is deliberately not
 * an amount parser: ratios may carry more than two decimals and exponent form
 * is meaningful. `Number` is used once for both validation and the write so an
 * input such as `1e3` cannot validate as one value and be stored as another.
 * The upper bound is the existing domain law in both SetFxRate and
 * SetLinePayment: usdPerUnit is at most 1,000,000.
 */
export function positiveFiniteRatio(input: string): number | null {
  if (input.trim() === '') return null;
  const ratio = Number(input);
  return Number.isFinite(ratio) && ratio > 0 && ratio <= 1_000_000 ? ratio : null;
}
