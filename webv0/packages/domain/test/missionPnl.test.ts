/**
 * missionPnl.test.ts — the pure P&L derivation (Finance S4, upgraded by S2):
 * line schemas + the category taxonomy, per-currency subtotals, the per-diem
 * roll-in (active-only, open-ended honesty), the per-line income blend with
 * RECEIVED amounts and FX SNAPSHOTS, budget-vs-actual per category, the
 * settlement truth, the all-or-nothing missing-rate rule, and the finance
 * stage machine.
 */
import { describe, expect, it } from 'vitest';
import {
  computeMissionPnl,
  missionLineCreateInputSchema,
  missionLineUpdateInputSchema,
  missionLinePaymentInputSchema,
  setMissionBudgetInputSchema,
  nextMissionFinanceStage,
  suggestEntityCode,
  formatMissionLineId,
  isMissionLineId,
  type FxRate,
  type MissionLineDirection,
  type PaymentStatus,
} from '../src/index';

const rate = (currency: FxRate['currency'], usdPerUnit: number): FxRate => ({ currency, usdPerUnit, updatedAt: '2026-07-10T00:00:00Z' });

/** A fully-typed P&L line fixture (S2 shape). */
const line = (over: {
  direction: MissionLineDirection;
  amountMinor: number;
  currency: FxRate['currency'];
  category?: string;
  paymentStatus?: PaymentStatus | null;
  receivedAmountMinor?: number | null;
  receivedUsdPerUnit?: number | null;
}) => ({
  category: over.direction === 'Income' ? 'PrizeMoney' : 'Travel',
  paymentStatus: over.direction === 'Income' ? ('Expected' as const) : null,
  receivedAmountMinor: null,
  receivedUsdPerUnit: null,
  ...over,
});

const participant = (over: Partial<Parameters<typeof computeMissionPnl>[0]['participants'][number]> = {}) => ({
  personId: 'PER-0001',
  personName: 'Jordan Reyes',
  isActive: true,
  perDiemAmountMinor: 25_000 as number | null,
  perDiemCurrency: 'SAR' as const,
  ...over,
});

describe('input schemas (S2)', () => {
  it('create requires a category that belongs to the direction; PerDiem is engine-owned', () => {
    const ok = missionLineCreateInputSchema.parse({ direction: 'Income', category: 'PrizeMoney', label: 'Prize — 2nd', amountMinor: 1, currency: 'USD' });
    expect(ok.category).toBe('PrizeMoney');
    // an expense category on an income line is refused, and vice versa
    expect(() => missionLineCreateInputSchema.parse({ direction: 'Income', category: 'Travel', label: 'X', amountMinor: 1, currency: 'USD' })).toThrow(/direction/);
    // PerDiem can never be a manual line (the roll-in owns it)
    expect(() => missionLineCreateInputSchema.parse({ direction: 'Expense', category: 'PerDiem', label: 'X', amountMinor: 1, currency: 'USD' })).toThrow();
    // update cannot smuggle category/payment (immutable / own action)
    expect(() => missionLineUpdateInputSchema.parse({ expectedVersion: 0, category: 'Other' })).toThrow();
  });

  it('payment input: received detail only accompanies Received', () => {
    expect(() => missionLinePaymentInputSchema.parse({ expectedVersion: 0, paymentStatus: 'Invoiced', receivedAmountMinor: 100 })).toThrow(/Received/);
    const ok = missionLinePaymentInputSchema.parse({
      expectedVersion: 1,
      paymentStatus: 'Received',
      receivedAmountMinor: 950_000,
      receivedUsdPerUnit: 0.2666,
      paymentSourceLabel: 'ESA',
      refNo: 'FT2501475Z6Z',
    });
    expect(ok).toMatchObject({ paymentStatus: 'Received', receivedAmountMinor: 950_000, paymentSourceLabel: 'ESA' });
  });

  it('budget input: PerDiem is a legal EXPENSE budget category; income lists exclude it; null clears', () => {
    expect(setMissionBudgetInputSchema.parse({ direction: 'Expense', category: 'PerDiem', currency: 'SAR', amountMinor: 400_000, expectedVersion: null }).category).toBe('PerDiem');
    expect(() => setMissionBudgetInputSchema.parse({ direction: 'Income', category: 'PerDiem', currency: 'USD', amountMinor: 1, expectedVersion: null })).toThrow();
    expect(setMissionBudgetInputSchema.parse({ direction: 'Expense', category: 'Travel', currency: 'USD', amountMinor: null, expectedVersion: 0 }).amountMinor).toBeNull();
  });

  it('the finance stage machine steps forward one at a time; Settled is terminal', () => {
    expect(nextMissionFinanceStage('Planning')).toBe('FinancePending');
    expect(nextMissionFinanceStage('FinancePending')).toBe('Confirmed');
    expect(nextMissionFinanceStage('Confirmed')).toBe('Active');
    expect(nextMissionFinanceStage('Active')).toBe('PostMission');
    expect(nextMissionFinanceStage('PostMission')).toBe('Settled');
    expect(nextMissionFinanceStage('Settled')).toBeNull();
  });

  it('suggestEntityCode derives editable initials', () => {
    expect(suggestEntityCode('Geekay UAE')).toBe('GU');
    expect(suggestEntityCode('Geekay Esports FZ-LLC')).toBe('GEF');
    expect(suggestEntityCode('Sponsor')).toBe('SPONSOR');
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
        line({ direction: 'Income', amountMinor: 1_000_000, currency: 'USD' }), // $10,000
        line({ direction: 'Income', amountMinor: 3_672_500, currency: 'AED' }), // AED 36,725
        line({ direction: 'Expense', amountMinor: 200_000, currency: 'USD' }), // $2,000
      ],
      participants: [participant()], // SAR 250/day × 15d = SAR 3,750 expense
      rates: [rate('AED', 0.2723), rate('SAR', 0.2666)],
    });

    expect(pnl.perCurrency).toEqual([
      { currency: 'AED', incomeMinor: 3_672_500, expenseMinor: 0 },
      { currency: 'SAR', incomeMinor: 0, expenseMinor: 375_000 },
      { currency: 'USD', incomeMinor: 1_000_000, expenseMinor: 200_000 },
    ]);
    expect(pnl.perDiem.openEnded).toBe(false);
    expect(pnl.missingRates).toEqual([]);
    const sarUsd = Math.round(375_000 * 0.2666);
    expect(pnl.blended).toEqual({
      incomeUsdMinor: 1_000_000 + Math.round(3_672_500 * 0.2723),
      expenseUsdMinor: 200_000 + sarUsd,
      profitUsdMinor: 1_000_000 + Math.round(3_672_500 * 0.2723) - 200_000 - sarUsd,
    });
  });

  it('S2: a Received line contributes its RECEIVED amount, and its FX SNAPSHOT beats the live table', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: '2026-08-02',
      lines: [
        // Expected SAR 10,000 — but SAR 9,500 landed, at a recorded 0.2650.
        line({
          direction: 'Income',
          amountMinor: 1_000_000,
          currency: 'SAR',
          paymentStatus: 'Received',
          receivedAmountMinor: 950_000,
          receivedUsdPerUnit: 0.265,
        }),
      ],
      participants: [],
      rates: [rate('SAR', 0.2666)], // live table says 0.2666 — the snapshot wins
    });
    expect(pnl.perCurrency).toEqual([{ currency: 'SAR', incomeMinor: 950_000, expenseMinor: 0 }]);
    expect(pnl.blended!.incomeUsdMinor).toBe(Math.round(950_000 * 0.265));
    expect(pnl.settlement).toEqual({ outstandingIncomeCount: 0, incomeComplete: true });
  });

  it('S2: a Received line WITH a snapshot needs no live rate at all', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: null,
      lines: [
        line({ direction: 'Income', amountMinor: 500_000, currency: 'AED', paymentStatus: 'Received', receivedUsdPerUnit: 0.2723 }),
      ],
      participants: [],
      rates: [], // empty table — the snapshot carries the line
    });
    expect(pnl.missingRates).toEqual([]);
    expect(pnl.blended!.incomeUsdMinor).toBe(Math.round(500_000 * 0.2723));
  });

  it('S2: budget-vs-actual per category, with the per-diem roll-in landing under PerDiem', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: '2026-08-15',
      lines: [line({ direction: 'Income', amountMinor: 1_000_000, currency: 'USD', category: 'PrizeMoney' })],
      budgets: [
        { direction: 'Income', category: 'PrizeMoney', currency: 'USD', amountMinor: 1_200_000 },
        { direction: 'Expense', category: 'PerDiem', currency: 'SAR', amountMinor: 400_000 },
      ],
      participants: [participant()], // actual per-diem SAR 375,000
      rates: [rate('SAR', 0.2666)],
    });
    const prize = pnl.perCategory.find((c) => c.category === 'PrizeMoney')!;
    expect(prize.direction).toBe('Income');
    expect(prize.actualUsdMinor).toBe(1_000_000);
    expect(prize.budgetUsdMinor).toBe(1_200_000);
    expect(prize.varianceUsdMinor).toBe(-200_000); // under expectation

    const perDiem = pnl.perCategory.find((c) => c.category === 'PerDiem')!;
    expect(perDiem.direction).toBe('Expense');
    expect(perDiem.actual).toEqual([{ currency: 'SAR', amountMinor: 375_000 }]);
    expect(perDiem.budget).toEqual([{ currency: 'SAR', amountMinor: 400_000 }]);
    expect(perDiem.varianceUsdMinor).toBe(Math.round(375_000 * 0.2666) - Math.round(400_000 * 0.2666)); // under budget

    // income rows sort before expense rows
    expect(pnl.perCategory[0]!.direction).toBe('Income');
  });

  it('S2: settlement truth — outstanding income counted; complete only when all Received (and money exists)', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: null,
      lines: [
        line({ direction: 'Income', amountMinor: 1, currency: 'USD', paymentStatus: 'Received' }),
        line({ direction: 'Income', amountMinor: 2, currency: 'USD', paymentStatus: 'Invoiced' }),
        line({ direction: 'Income', amountMinor: 3, currency: 'USD', paymentStatus: 'Expected' }),
      ],
      participants: [],
      rates: [],
    });
    expect(pnl.settlement).toEqual({ outstandingIncomeCount: 2, incomeComplete: false });

    const empty = computeMissionPnl({ startsOn: '2026-08-01', endsOn: null, lines: [], participants: [], rates: [] });
    expect(empty.settlement).toEqual({ outstandingIncomeCount: 0, incomeComplete: false }); // no money ≠ complete
  });

  it('is honest about missing rates: NO blended figure at all, and the culprits are named', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: '2026-08-15',
      lines: [
        line({ direction: 'Income', amountMinor: 1_000_000, currency: 'USD' }),
        line({ direction: 'Expense', amountMinor: 50_000, currency: 'EUR' }), // no EUR rate stored
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
      lines: [line({ direction: 'Income', amountMinor: 1_000_000, currency: 'USD' })],
      participants: [participant()],
      rates: [rate('SAR', 0.2666)],
    });
    expect(pnl.perDiem.openEnded).toBe(true);
    expect(pnl.perDiem.entries[0]).toMatchObject({ days: null, totalMinor: null });
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
    expect(pnl.perCategory).toEqual([]);
    expect(pnl.blended).toEqual({ incomeUsdMinor: 0, expenseUsdMinor: 0, profitUsdMinor: 0 });
    expect(pnl.missingRates).toEqual([]);
  });
});

describe('HARDEN-2 M-02 — fragmentation invariance (per-currency subtotal blend)', () => {
  const args = (lines: ReturnType<typeof line>[]) => ({
    startsOn: '2026-09-01',
    endsOn: '2026-09-05',
    lines,
    participants: [],
    rates: [rate('SAR', 0.2666)],
  });

  it('one 100.37-SAR expense and three fragments of it blend to the SAME USD total', () => {
    const whole = computeMissionPnl(args([line({ direction: 'Expense', amountMinor: 10_037, currency: 'SAR' })]));
    const split = computeMissionPnl(
      args([
        line({ direction: 'Expense', amountMinor: 3_346, currency: 'SAR' }),
        line({ direction: 'Expense', amountMinor: 3_346, currency: 'SAR' }),
        line({ direction: 'Expense', amountMinor: 3_345, currency: 'SAR' }),
      ]),
    );
    expect(whole.blended).not.toBeNull();
    expect(split.blended!.expenseUsdMinor).toBe(whole.blended!.expenseUsdMinor);
    expect(split.blended!.profitUsdMinor).toBe(whole.blended!.profitUsdMinor);
    // the category row obeys the same law at its own grain
    const wholeCat = whole.perCategory.find((c) => c.category === 'Travel')!;
    const splitCat = split.perCategory.find((c) => c.category === 'Travel')!;
    expect(splitCat.actualUsdMinor).toBe(wholeCat.actualUsdMinor);
  });

  it('a Received income FX snapshot still converts PER LINE (each receipt is its own truth)', () => {
    const snap = (amount: number) =>
      line({
        direction: 'Income',
        amountMinor: amount,
        currency: 'SAR',
        paymentStatus: 'Received',
        receivedAmountMinor: amount,
        receivedUsdPerUnit: 0.265,
      });
    const two = computeMissionPnl(args([snap(5_001), snap(5_001)]));
    // per-line: 2 × round(5001×0.265) = 2 × 1325 — NOT round(10002×0.265) = 2651
    expect(two.blended!.incomeUsdMinor).toBe(2 * Math.round(5_001 * 0.265));
  });
});
