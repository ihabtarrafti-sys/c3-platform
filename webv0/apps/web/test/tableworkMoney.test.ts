/**
 * tableworkMoney.test.ts — the F3/③ money-input parse capability.
 *
 * The consolidation's whole point is that the ZERO POLICY differs by call site
 * and that difference is deliberate, so the divergence is pinned here: if a
 * later edit collapses the three exports into one shared policy, this fails.
 */
import { describe, expect, it } from 'vitest';
import {
  percentToBpsAllowingZero,
  positivePercentToBps,
  amountToMinorAllowingZero,
  positiveAmountToMinor,
} from '../src/tablework/money';

describe('percentToBpsAllowingZero — percent → bps, zero ALLOWED', () => {
  it('splits exact digits into integer bps', () => {
    expect(percentToBpsAllowingZero('15')).toBe(1500);
    expect(percentToBpsAllowingZero('5.5')).toBe(550);
    expect(percentToBpsAllowingZero('5.55')).toBe(555);
    expect(percentToBpsAllowingZero('100')).toBe(10000);
    expect(percentToBpsAllowingZero('0.01')).toBe(1);
  });

  it('accepts zero — a 0% org share (all-to-players) and 0% zero-rated VAT are real', () => {
    expect(percentToBpsAllowingZero('0')).toBe(0);
    expect(percentToBpsAllowingZero('0.0')).toBe(0);
    expect(percentToBpsAllowingZero('0.00')).toBe(0);
  });

  it('REFUSES sub-bps precision rather than rounding it', () => {
    expect(percentToBpsAllowingZero('5.555')).toBeNull();
    expect(percentToBpsAllowingZero('0.001')).toBeNull();
  });

  it('refuses anything that is not a 0..100 percent', () => {
    expect(percentToBpsAllowingZero('100.01')).toBeNull();
    expect(percentToBpsAllowingZero('101')).toBeNull();
    expect(percentToBpsAllowingZero('999')).toBeNull();
    expect(percentToBpsAllowingZero('-1')).toBeNull();
    expect(percentToBpsAllowingZero('')).toBeNull();
    expect(percentToBpsAllowingZero('10.')).toBeNull();
    expect(percentToBpsAllowingZero('.5')).toBeNull();
    expect(percentToBpsAllowingZero('abc')).toBeNull();
  });

  it('tolerates surrounding whitespace', () => {
    expect(percentToBpsAllowingZero(' 10 ')).toBe(1000);
  });
});

describe('positivePercentToBps — percent → bps, zero REJECTED', () => {
  it('agrees with percentToBpsAllowingZero on every non-zero input', () => {
    for (const input of ['15', '5.5', '5.55', '100', '0.01', ' 10 ', '5.555', '100.01', '', '.5', '-1']) {
      expect(positivePercentToBps(input)).toBe(percentToBpsAllowingZero(input));
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
    const divergent = inputs.filter((i) => percentToBpsAllowingZero(i) !== positivePercentToBps(i));
    expect(divergent).toEqual(['0', '0.0', '0.00', '00', '000.00']);
  });
});

describe('amountToMinorAllowingZero — major units → integer minor units, zero ALLOWED', () => {
  it('parses the same amounts as its positive twin', () => {
    expect(amountToMinorAllowingZero('1')).toBe(100);
    expect(amountToMinorAllowingZero('1.5')).toBe(150);
    expect(amountToMinorAllowingZero('1.05')).toBe(105);
    expect(amountToMinorAllowingZero('1234.56')).toBe(123456);
  });

  it('ACCEPTS zero — the whole reason it exists', () => {
    expect(amountToMinorAllowingZero('0')).toBe(0);
    expect(amountToMinorAllowingZero('0.0')).toBe(0);
    expect(amountToMinorAllowingZero('0.00')).toBe(0);
  });

  it('still REFUSES excess precision rather than rounding (M-02)', () => {
    expect(amountToMinorAllowingZero('1.005')).toBeNull();
    expect(amountToMinorAllowingZero('0.001')).toBeNull();
  });

  it('still refuses malformed input', () => {
    expect(amountToMinorAllowingZero('')).toBeNull();
    expect(amountToMinorAllowingZero('abc')).toBeNull();
  });
});

describe('the zero policy is the ONLY divergence between the two amount parsers', () => {
  it('diverges on exactly the zero spellings', () => {
    // The same guard the percent pair carries: if a future edit collapses these
    // onto one implementation, this list changes and the test fails.
    const inputs = [
      '0', '0.0', '0.00', '0.01', '1', '1.5', '1.05', '1.005', '1234.56',
      '99.99', '', ' ', ' 10 ', '10.', '.5', '-1', '1e2', 'abc', '00', '000.00',
    ];
    const divergent = inputs.filter((i) => amountToMinorAllowingZero(i) !== positiveAmountToMinor(i));
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
