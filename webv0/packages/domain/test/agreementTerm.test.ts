/**
 * agreementTerm.test.ts — the pure term primitives: percentage <-> basis
 * points, the per-kind shape rule (assertTermShape, the one source of truth),
 * the create/update input schemas, and the TRM business id.
 */
import { describe, expect, it } from 'vitest';
import {
  assertTermShape,
  agreementTermCreateInputSchema,
  agreementTermUpdateInputSchema,
  formatPercentBps,
  percentToBps,
  isMonetaryTermKind,
  isPercentTermKind,
  termLabelRequired,
  formatAgreementTermId,
  isAgreementTermId,
  ValidationError,
  type TermValues,
} from '../src/index';

describe('percentage <-> basis points', () => {
  it('percentToBps rounds to integer basis points', () => {
    expect(percentToBps(7.5)).toBe(750);
    expect(percentToBps(15)).toBe(1500);
    expect(percentToBps(12.25)).toBe(1225);
    expect(percentToBps(100)).toBe(10_000);
  });

  it('formatPercentBps trims trailing zeros', () => {
    expect(formatPercentBps(1500)).toBe('15%');
    expect(formatPercentBps(750)).toBe('7.5%');
    expect(formatPercentBps(1225)).toBe('12.25%');
    expect(formatPercentBps(10_000)).toBe('100%');
  });
});

describe('kind classification', () => {
  it('splits monetary and percent kinds; milestone alone requires a label', () => {
    expect(isMonetaryTermKind('Salary')).toBe(true);
    expect(isMonetaryTermKind('PrizeShareTeam')).toBe(false);
    expect(isPercentTermKind('PrizeSharePersonal')).toBe(true);
    expect(termLabelRequired('Milestone')).toBe(true);
    expect(termLabelRequired('Salary')).toBe(false);
  });
});

describe('assertTermShape (the per-kind rule)', () => {
  const money = (over: Partial<TermValues> = {}): TermValues => ({ amountMinor: 100_000, currency: 'USD', percentBps: null, label: null, ...over });
  const pct = (over: Partial<TermValues> = {}): TermValues => ({ amountMinor: null, currency: null, percentBps: 750, label: null, ...over });

  it('accepts a well-formed monetary and percent term', () => {
    expect(() => assertTermShape('Salary', money())).not.toThrow();
    expect(() => assertTermShape('PrizeSharePersonal', pct())).not.toThrow();
    expect(() => assertTermShape('Milestone', money({ label: 'Reach playoffs' }))).not.toThrow();
  });

  it('rejects a monetary term missing amount or currency, or carrying a percentage', () => {
    expect(() => assertTermShape('Salary', money({ amountMinor: null }))).toThrow(ValidationError);
    expect(() => assertTermShape('Salary', money({ currency: null }))).toThrow(ValidationError);
    expect(() => assertTermShape('Salary', money({ percentBps: 100 }))).toThrow(ValidationError);
    expect(() => assertTermShape('Salary', money({ amountMinor: 0 }))).toThrow(ValidationError);
  });

  it('rejects a milestone with no trigger label', () => {
    expect(() => assertTermShape('Milestone', money({ label: null }))).toThrow(ValidationError);
    expect(() => assertTermShape('Milestone', money({ label: '' }))).toThrow(ValidationError);
  });

  it('rejects a percent term out of range or carrying money', () => {
    expect(() => assertTermShape('PrizeShareTeam', pct({ percentBps: null }))).toThrow(ValidationError);
    expect(() => assertTermShape('PrizeShareTeam', pct({ percentBps: 0 }))).toThrow(ValidationError);
    expect(() => assertTermShape('PrizeShareTeam', pct({ percentBps: 10_001 }))).toThrow(ValidationError);
    expect(() => assertTermShape('PrizeShareTeam', pct({ amountMinor: 100, currency: 'USD' }))).toThrow(ValidationError);
  });
});

describe('input schemas', () => {
  it('create parses a monetary term and coerces empty label to null', () => {
    const parsed = agreementTermCreateInputSchema.parse({ kind: 'Salary', amountMinor: 500_000, currency: 'AED', label: '  ' });
    expect(parsed).toMatchObject({ kind: 'Salary', amountMinor: 500_000, currency: 'AED', percentBps: null, label: null });
  });

  it('create rejects a non-positive amount and an out-of-range percentage at the field level', () => {
    expect(() => agreementTermCreateInputSchema.parse({ kind: 'Salary', amountMinor: -1, currency: 'USD' })).toThrow();
    expect(() => agreementTermCreateInputSchema.parse({ kind: 'PrizeShareTeam', percentBps: 10_001 })).toThrow();
  });

  it('update requires an expectedVersion and rejects unknown keys', () => {
    expect(() => agreementTermUpdateInputSchema.parse({ amountMinor: 1, currency: 'USD' })).toThrow();
    expect(() => agreementTermUpdateInputSchema.parse({ expectedVersion: 0, kind: 'Salary' })).toThrow(); // kind is immutable
    const ok = agreementTermUpdateInputSchema.parse({ expectedVersion: 2, percentBps: 500 });
    expect(ok).toMatchObject({ expectedVersion: 2, percentBps: 500 });
  });
});

describe('TRM business id', () => {
  it('formats and recognises the term id', () => {
    expect(formatAgreementTermId(1)).toBe('TRM-0001');
    expect(isAgreementTermId('TRM-0001')).toBe(true);
    expect(isAgreementTermId('AGR-0001')).toBe(false);
  });
});
