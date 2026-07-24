/**
 * tableworkMoney.test.ts — the F3/③ money-input parse capability.
 *
 * The consolidation's whole point is that the ZERO POLICY differs by call site
 * and that difference is deliberate, so the divergence is pinned here: if a
 * later edit collapses the three exports into one shared policy, this fails.
 */
import { describe, expect, it } from 'vitest';
import {
  percentToBps,
  positivePercentToBps,
  positiveAmountToMinor,
} from '../src/tablework/money';

describe('percentToBps — percent → bps, zero ALLOWED', () => {
  it('splits exact digits into integer bps', () => {
    expect(percentToBps('15')).toBe(1500);
    expect(percentToBps('5.5')).toBe(550);
    expect(percentToBps('5.55')).toBe(555);
    expect(percentToBps('100')).toBe(10000);
    expect(percentToBps('0.01')).toBe(1);
  });

  it('accepts zero — a 0% org share (all-to-players) and 0% zero-rated VAT are real', () => {
    expect(percentToBps('0')).toBe(0);
    expect(percentToBps('0.0')).toBe(0);
    expect(percentToBps('0.00')).toBe(0);
  });

  it('REFUSES sub-bps precision rather than rounding it', () => {
    expect(percentToBps('5.555')).toBeNull();
    expect(percentToBps('0.001')).toBeNull();
  });

  it('refuses anything that is not a 0..100 percent', () => {
    expect(percentToBps('100.01')).toBeNull();
    expect(percentToBps('101')).toBeNull();
    expect(percentToBps('999')).toBeNull();
    expect(percentToBps('-1')).toBeNull();
    expect(percentToBps('')).toBeNull();
    expect(percentToBps('10.')).toBeNull();
    expect(percentToBps('.5')).toBeNull();
    expect(percentToBps('abc')).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(percentToBps(' 10 ')).toBe(1000);
  });
});

describe('positivePercentToBps — percent → bps, zero REJECTED', () => {
  it('agrees with percentToBps on every non-zero input', () => {
    for (const input of ['15', '5.5', '5.55', '100', '0.01', ' 10 ', '5.555', '100.01', '', '.5', '-1']) {
      expect(positivePercentToBps(input)).toBe(percentToBps(input));
    }
  });

  it('rejects zero — a 0% agreement term is meaningless', () => {
    expect(positivePercentToBps('0')).toBeNull();
    expect(positivePercentToBps('0.0')).toBeNull();
    expect(positivePercentToBps('0.00')).toBeNull();
  });
});

describe('the zero policy is the ONLY divergence between the two percent parsers', () => {
  it('diverges on exactly the zero spellings', () => {
    const inputs = [
      '0', '0.0', '0.00', '0.01', '1', '5', '5.5', '5.55', '5.555',
      '99.99', '100', '100.00', '100.01', '101', '999', '', ' ', ' 10 ',
      '10.', '.5', '-1', '1e2', 'abc', '00', '000.00',
    ];
    const divergent = inputs.filter((i) => percentToBps(i) !== positivePercentToBps(i));
    expect(divergent).toEqual(['0', '0.0', '0.00', '00', '000.00']);
  });
});

describe('positiveAmountToMinor — major units → integer minor units, zero REJECTED', () => {
  it('splits exact digits into integer minor units', () => {
    expect(positiveAmountToMinor('1')).toBe(100);
    expect(positiveAmountToMinor('1.5')).toBe(150);
    expect(positiveAmountToMinor('1.05')).toBe(105);
    expect(positiveAmountToMinor('1234.56')).toBe(123456);
  });

  it('REFUSES sub-minor precision rather than rounding it', () => {
    expect(positiveAmountToMinor('1.005')).toBeNull();
    expect(positiveAmountToMinor('0.001')).toBeNull();
  });

  it('rejects zero and non-amounts', () => {
    expect(positiveAmountToMinor('0')).toBeNull();
    expect(positiveAmountToMinor('0.00')).toBeNull();
    expect(positiveAmountToMinor('-5')).toBeNull();
    expect(positiveAmountToMinor('')).toBeNull();
    expect(positiveAmountToMinor('abc')).toBeNull();
  });

  it('never produces a float', () => {
    for (const input of ['0.1', '0.2', '0.3', '1.10', '99.99', '8.11']) {
      const minor = positiveAmountToMinor(input);
      expect(minor).not.toBeNull();
      expect(Number.isInteger(minor)).toBe(true);
    }
    // The classic float trap: 0.1 + 0.2 !== 0.3 in binary, but these are ints.
    expect(positiveAmountToMinor('0.1')! + positiveAmountToMinor('0.2')!).toBe(
      positiveAmountToMinor('0.3'),
    );
  });
});
