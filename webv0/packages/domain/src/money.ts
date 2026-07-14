/**
 * money.ts — the currency-aware money primitive (Finance Sprint 1, 2026-07-10).
 *
 * Every money amount in C3 is an INTEGER of the currency's minor unit plus an
 * ISO-4217 currency code — never a float (the credential/cents discipline,
 * generalized). All supported currencies use 2 decimal places (minor = 1/100),
 * which holds for AED, SAR, USD, EUR, GBP; a currency with a different scale
 * would need this revisited (asserted below).
 *
 * FX is display-level and honest: the org maintains one editable rate per
 * currency — its value in USD (the pivot), i.e. `usdPerUnit`. Every cross-rate
 * is DERIVED from those (no arbitrage inconsistency, N rates not N²):
 *   convert(amount, A → B) = amount × usdPerUnit(A) / usdPerUnit(B)
 * USD's own rate is 1. Converted figures are approximate by nature and are only
 * ever shown as a secondary "≈" — the stored amount keeps its native currency.
 */

import { z } from 'zod';

/** Supported ISO-4217 currencies. Extensible — add a code here to support it. */
export const CURRENCY_CODES = ['USD', 'AED', 'SAR', 'EUR', 'GBP'] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** The pivot every stored FX rate is expressed against. */
export const PIVOT_CURRENCY: CurrencyCode = 'USD';

/** All supported currencies are 2-decimal (minor unit = 1/100 of the unit). */
export const MINOR_UNITS_PER_UNIT = 100;

export const currencyCodeSchema = z.enum(CURRENCY_CODES);

export function isCurrencyCode(v: unknown): v is CurrencyCode {
  return typeof v === 'string' && (CURRENCY_CODES as readonly string[]).includes(v);
}

/** A money amount as the domain reasons about it. */
export interface Money {
  /** Integer count of the currency's minor unit (e.g. fils, halalas, cents). */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

/**
 * HARDEN-2 M-02: the largest amount any C3 field accepts — 9×10¹¹ minor units
 * (≈ 9 billion USD), the bound under which every basis-point product
 * (amount × 10000) stays exact in IEEE-754 AND far past any prize pool. The
 * bps arithmetic itself runs in BigInt anyway; this cap makes the promise
 * independent of that.
 */
export const MAX_AMOUNT_MINOR = 900_000_000_000;

/** A non-negative integer amount of minor units (money never validates as float). */
export const amountMinorSchema = z.number().int().min(0).max(MAX_AMOUNT_MINOR);

/**
 * HARDEN-2 M-02: EXACT decimal-string → integer minor units. The ONLY lawful
 * way to turn user-typed major units into money — digits split by a literal
 * dot (never IEEE-754 round-through), at most 2 fraction digits, bounded by
 * MAX_AMOUNT_MINOR. Returns null for anything else: empty, signs, exponents,
 * grouping separators, or excess precision (12.345 is a REFUSAL, not 12.35).
 */
export function parseDecimalToMinor(input: string): number | null {
  const m = /^(\d{1,10})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return minor <= MAX_AMOUNT_MINOR ? minor : null;
}

/**
 * One org-maintained exchange rate: the value of 1 unit of `currency` in USD.
 * USD itself is implicitly 1 and need not be stored.
 */
export interface FxRate {
  readonly currency: CurrencyCode;
  /** Value of 1 unit of `currency` in USD, e.g. AED → 0.272294. */
  readonly usdPerUnit: number;
  readonly updatedAt: string;
}

export const setFxRateInputSchema = z
  .object({
    currency: currencyCodeSchema,
    // A positive rate; USD's rate is fixed at 1 and cannot be overridden.
    usdPerUnit: z.number().positive().max(1_000_000),
  })
  .strict()
  .refine((v) => v.currency !== PIVOT_CURRENCY, { message: 'The pivot currency (USD) rate is fixed at 1 and is not editable.' });
export type SetFxRateInput = z.infer<typeof setFxRateInputSchema>;

/** Build the effective usdPerUnit lookup, with the pivot pinned to 1. */
export function usdPerUnitMap(rates: readonly FxRate[]): Record<string, number> {
  const map: Record<string, number> = { [PIVOT_CURRENCY]: 1 };
  for (const r of rates) map[r.currency] = r.usdPerUnit;
  return map;
}

/**
 * Convert an integer minor amount from one currency to another for DISPLAY,
 * via the USD pivot. Returns null when a needed rate is missing (the caller
 * shows native-only rather than inventing a number). Rounds to the target's
 * minor unit.
 */
/**
 * R5-N08: a conversion is EITHER exact, OR unavailable for a DISCRIMINATED reason — an absent
 * rate ('missing_rate') is a different failure from a present-rate product that leaves the
 * exact-integer range ('overflow'). Collapsing both to null mislabels a real overflow as a
 * missing rate. `convertMinor` stays a thin `value|null` wrapper for existing callers.
 */
export type ConvertResult = { readonly ok: true; readonly value: number } | { readonly ok: false; readonly reason: 'missing_rate' | 'overflow' };

export function convertMinorResult(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  usdPerUnit: Record<string, number>,
): ConvertResult {
  if (from === to) return { ok: true, value: amountMinor };
  const rf = usdPerUnit[from];
  const rt = usdPerUnit[to];
  if (!rf || !rt) return { ok: false, reason: 'missing_rate' };
  // L-02: refuse a conversion whose intermediate or result would leave the IEEE-754
  // exact-integer range — a silently-imprecise money value is worse than none. The check
  // divides (never multiplies) to test the product safely. The rate IS present here, so this
  // is an OVERFLOW, not a missing rate.
  if (amountMinor > Number.MAX_SAFE_INTEGER / rf) return { ok: false, reason: 'overflow' };
  const result = Math.round((amountMinor * rf) / rt);
  if (!Number.isSafeInteger(result)) return { ok: false, reason: 'overflow' };
  return { ok: true, value: result };
}

export function convertMinor(
  amountMinor: number,
  from: CurrencyCode,
  to: CurrencyCode,
  usdPerUnit: Record<string, number>,
): number | null {
  const r = convertMinorResult(amountMinor, from, to, usdPerUnit);
  return r.ok ? r.value : null;
}

/** Format an integer minor amount in its currency, e.g. 100000 AED → "AED 1,000.00". */
export function formatMoney(amountMinor: number, currency: CurrencyCode): string {
  const major = amountMinor / MINOR_UNITS_PER_UNIT;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'code' }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}
