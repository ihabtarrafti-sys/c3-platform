import { describe, expect, it } from 'vitest';
import {
  convertMinor,
  formatMoney,
  usdPerUnitMap,
  setFxRateInputSchema,
  parseDecimalToMinor,
  MAX_AMOUNT_MINOR,
  PIVOT_CURRENCY,
  type FxRate,
} from '../src/money';

const rates: FxRate[] = [
  { currency: 'AED', usdPerUnit: 0.2723, updatedAt: '2026-07-10T00:00:00.000Z' },
  { currency: 'SAR', usdPerUnit: 0.2666, updatedAt: '2026-07-10T00:00:00.000Z' },
];

describe('money — cross-rate conversion via the USD pivot', () => {
  const map = usdPerUnitMap(rates);

  it('pins the pivot to 1 and same-currency is identity', () => {
    expect(map[PIVOT_CURRENCY]).toBe(1);
    expect(convertMinor(10_000, 'AED', 'AED', map)).toBe(10_000);
  });

  it('converts to USD using usdPerUnit', () => {
    // 1000.00 AED × 0.2723 = 272.30 USD → 27230 minor
    expect(convertMinor(100_000, 'AED', 'USD', map)).toBe(27_230);
  });

  it('derives a cross-rate (AED → SAR) through USD', () => {
    // 100.00 AED = 27.23 USD; ÷ 0.2666 = 102.14 SAR → 10214 minor
    expect(convertMinor(10_000, 'AED', 'SAR', map)).toBe(10_214);
  });

  it('returns null when a needed rate is missing (never invents a number)', () => {
    expect(convertMinor(10_000, 'EUR', 'USD', map)).toBeNull();
  });
});

describe('money — formatting and rate validation', () => {
  it('formats integer minor units in the currency', () => {
    expect(formatMoney(100_000, 'AED')).toContain('1,000.00');
    expect(formatMoney(100_000, 'AED')).toContain('AED');
  });

  it('setFxRate rejects the pivot currency (USD is fixed at 1)', () => {
    expect(setFxRateInputSchema.safeParse({ currency: 'USD', usdPerUnit: 1 }).success).toBe(false);
    expect(setFxRateInputSchema.safeParse({ currency: 'AED', usdPerUnit: 0.2723 }).success).toBe(true);
    expect(setFxRateInputSchema.safeParse({ currency: 'AED', usdPerUnit: 0 }).success).toBe(false);
  });
});

describe('HARDEN-2 M-02 — parseDecimalToMinor: the exact-decimal law', () => {
  it('parses plain decimals exactly (never through IEEE-754)', () => {
    expect(parseDecimalToMinor('12')).toBe(1200);
    expect(parseDecimalToMinor('12.3')).toBe(1230);
    expect(parseDecimalToMinor('12.34')).toBe(1234);
    expect(parseDecimalToMinor('0.07')).toBe(7);
    expect(parseDecimalToMinor('  65  ')).toBe(6500);
    // the classic float trap: 0.29 has no exact binary representation
    expect(parseDecimalToMinor('0.29')).toBe(29);
    expect(parseDecimalToMinor('4.015')).toBeNull(); // Math.round(401.49999…) would have LIED
  });

  it('refuses excess precision, signs, exponents, grouping, and emptiness', () => {
    expect(parseDecimalToMinor('12.345')).toBeNull();
    expect(parseDecimalToMinor('-5')).toBeNull();
    expect(parseDecimalToMinor('+5')).toBeNull();
    expect(parseDecimalToMinor('1e3')).toBeNull();
    expect(parseDecimalToMinor('1,000')).toBeNull();
    expect(parseDecimalToMinor('')).toBeNull();
    expect(parseDecimalToMinor('.')).toBeNull();
    expect(parseDecimalToMinor('12.')).toBeNull();
    expect(parseDecimalToMinor('abc')).toBeNull();
  });

  it('holds the MAX_AMOUNT_MINOR bound exactly', () => {
    expect(parseDecimalToMinor('9000000000')).toBe(MAX_AMOUNT_MINOR); // the cap itself
    expect(parseDecimalToMinor('9000000000.01')).toBeNull(); // one cent past it
    expect(parseDecimalToMinor('9999999999')).toBeNull(); // regex-legal, cap-refused
  });
});
