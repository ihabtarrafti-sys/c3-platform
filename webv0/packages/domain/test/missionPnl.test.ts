/**
 * missionPnl.test.ts — the pure P&L derivation (Finance S4): line schemas,
 * per-currency subtotals, the per-diem roll-in (active-only, open-ended
 * honesty), the all-or-nothing USD blend, and missing-rate truthfulness.
 */
import { describe, expect, it } from 'vitest';
import {
  computeMissionPnl,
  missionLineCreateInputSchema,
  missionLineUpdateInputSchema,
  formatMissionLineId,
  isMissionLineId,
  type FxRate,
} from '../src/index';

const rate = (currency: FxRate['currency'], usdPerUnit: number): FxRate => ({ currency, usdPerUnit, updatedAt: '2026-07-10T00:00:00Z' });

const participant = (over: Partial<Parameters<typeof computeMissionPnl>[0]['participants'][number]> = {}) => ({
  personId: 'PER-0001',
  personName: 'Jordan Reyes',
  isActive: true,
  perDiemAmountMinor: 25_000 as number | null,
  perDiemCurrency: 'SAR' as const,
  ...over,
});

describe('input schemas', () => {
  it('create requires direction/label/positive amount/currency; update patches with a version', () => {
    const ok = missionLineCreateInputSchema.parse({ direction: 'Income', label: 'Prize — 2nd place', amountMinor: 1_000_000, currency: 'USD' });
    expect(ok.direction).toBe('Income');
    expect(() => missionLineCreateInputSchema.parse({ direction: 'Income', label: '', amountMinor: 1, currency: 'USD' })).toThrow();
    expect(() => missionLineCreateInputSchema.parse({ direction: 'Income', label: 'X', amountMinor: 0, currency: 'USD' })).toThrow();
    expect(() => missionLineCreateInputSchema.parse({ direction: 'Sideways', label: 'X', amountMinor: 1, currency: 'USD' })).toThrow();

    expect(() => missionLineUpdateInputSchema.parse({ expectedVersion: 0 })).toThrow(); // at least one field
    expect(() => missionLineUpdateInputSchema.parse({ expectedVersion: 0, direction: 'Expense' })).toThrow(); // direction immutable
    expect(missionLineUpdateInputSchema.parse({ expectedVersion: 1, amountMinor: 5 })).toMatchObject({ expectedVersion: 1, amountMinor: 5 });
  });

  it('formats and recognises the PNL business id', () => {
    expect(formatMissionLineId(7)).toBe('PNL-0007');
    expect(isMissionLineId('PNL-0007')).toBe(true);
    expect(isMissionLineId('MSN-0007')).toBe(false);
  });
});

describe('computeMissionPnl', () => {
  it('sums per-currency natives and blends to USD when every rate is present', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: '2026-08-15', // 15 inclusive days
      lines: [
        { direction: 'Income', amountMinor: 1_000_000, currency: 'USD' }, // $10,000
        { direction: 'Income', amountMinor: 3_672_500, currency: 'AED' }, // AED 36,725
        { direction: 'Expense', amountMinor: 200_000, currency: 'USD' }, // $2,000
      ],
      participants: [participant()], // SAR 250/day × 15d = SAR 3,750 expense
      rates: [rate('AED', 0.2723), rate('SAR', 0.2666)],
    });

    expect(pnl.perCurrency).toEqual([
      { currency: 'AED', incomeMinor: 3_672_500, expenseMinor: 0 },
      { currency: 'SAR', incomeMinor: 0, expenseMinor: 375_000 },
      { currency: 'USD', incomeMinor: 1_000_000, expenseMinor: 200_000 },
    ]);
    expect(pnl.perDiem.entries).toEqual([
      { personId: 'PER-0001', personName: 'Jordan Reyes', amountMinor: 25_000, currency: 'SAR', days: 15, totalMinor: 375_000 },
    ]);
    expect(pnl.perDiem.openEnded).toBe(false);
    expect(pnl.missingRates).toEqual([]);
    // income = 1,000,000 + round(3,672,500 × .2723) = 1,000,000 + 1,000,022
    expect(pnl.blended).toEqual({
      incomeUsdMinor: 2_000_022,
      expenseUsdMinor: 200_000 + Math.round(375_000 * 0.2666),
      profitUsdMinor: 2_000_022 - (200_000 + Math.round(375_000 * 0.2666)),
    });
  });

  it('is honest about missing rates: NO blended figure at all, and the culprits are named', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: '2026-08-15',
      lines: [
        { direction: 'Income', amountMinor: 1_000_000, currency: 'USD' },
        { direction: 'Expense', amountMinor: 50_000, currency: 'EUR' }, // no EUR rate stored
      ],
      participants: [participant()], // SAR — no rate either
      rates: [],
    });
    expect(pnl.blended).toBeNull();
    expect(pnl.missingRates).toEqual(['EUR', 'SAR']); // sorted; USD is the pivot, never missing
  });

  it('an open-ended mission excludes per-diem totals and says so', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: null,
      lines: [{ direction: 'Income', amountMinor: 1_000_000, currency: 'USD' }],
      participants: [participant()],
      rates: [rate('SAR', 0.2666)],
    });
    expect(pnl.perDiem.openEnded).toBe(true);
    expect(pnl.perDiem.entries[0]).toMatchObject({ days: null, totalMinor: null });
    // The SAR per-diem contributes nothing (unknowable), so no SAR bucket exists
    // and the line-only blend is complete.
    expect(pnl.perCurrency).toEqual([{ currency: 'USD', incomeMinor: 1_000_000, expenseMinor: 0 }]);
    expect(pnl.blended).toEqual({ incomeUsdMinor: 1_000_000, expenseUsdMinor: 0, profitUsdMinor: 1_000_000 });
  });

  it('only ACTIVE participants with a rate roll in; removed ones are dormant history', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: '2026-08-02',
      lines: [],
      participants: [
        participant({ personId: 'PER-0001', isActive: false }), // removed — excluded
        participant({ personId: 'PER-0002', perDiemAmountMinor: null, perDiemCurrency: null }), // no rate — excluded
        participant({ personId: 'PER-0003', perDiemAmountMinor: 10_000, perDiemCurrency: 'USD' }), // 2 days × $100
      ],
      rates: [],
    });
    expect(pnl.perDiem.entries).toHaveLength(1);
    expect(pnl.perDiem.entries[0]).toMatchObject({ personId: 'PER-0003', days: 2, totalMinor: 20_000 });
    expect(pnl.blended).toEqual({ incomeUsdMinor: 0, expenseUsdMinor: 20_000, profitUsdMinor: -20_000 });
  });

  it('an empty mission yields a zero, complete P&L', () => {
    const pnl = computeMissionPnl({ startsOn: '2026-08-01', endsOn: null, lines: [], participants: [], rates: [] });
    expect(pnl.perCurrency).toEqual([]);
    expect(pnl.blended).toEqual({ incomeUsdMinor: 0, expenseUsdMinor: 0, profitUsdMinor: 0 });
    expect(pnl.missingRates).toEqual([]);
  });
});
