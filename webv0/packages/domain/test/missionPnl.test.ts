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

describe('HARDEN-3.2 L-02 — money aggregate bounds (fail-closed past MAX_SAFE_INTEGER)', () => {
  // A single line is capped at MAX_AMOUNT_MINOR (900_000_000_000). But nothing caps how
  // many lines a mission carries, so a legal-per-line set can sum past the exact-integer
  // ceiling (2^53-1). Beyond it, `+` silently rounds — a blended USD total would be a
  // plausible-looking lie. The engine must instead WITHHOLD the blend (it is already the
  // one nullable headline; the v1 per-currency/per-category rows stay numeric by contract).
  const MAX_LINE = 900_000_000_000; // === MAX_AMOUNT_MINOR
  // ceil(MAX_SAFE_INTEGER / MAX_LINE) = 10_008 → the 10,008th add is the one that crosses.
  const usdLines = (count: number) =>
    Array.from({ length: count }, () => line({ direction: 'Income', amountMinor: MAX_LINE, currency: 'USD' }));

  it('lines each individually legal but summing past 2^53 collapse the blended USD total to null (never a silently-wrong number)', () => {
    const naiveSum = 10_008 * MAX_LINE;
    expect(Number.isSafeInteger(naiveSum)).toBe(false); // the aggregate is genuinely out of exact range

    const pnl = computeMissionPnl({ startsOn: '2026-08-01', endsOn: null, lines: usdLines(10_008), participants: [], rates: [] });
    // USD is the pivot — no rate can be missing, so the ONLY reason to withhold the blend is the bound.
    expect(pnl.missingRates).toEqual([]);
    expect(pnl.blended).toBeNull();
  });

  it('one line short of the boundary still blends (the guard is not over-eager)', () => {
    const sum = 10_007 * MAX_LINE;
    expect(Number.isSafeInteger(sum)).toBe(true); // last exact partial sum

    const pnl = computeMissionPnl({ startsOn: '2026-08-01', endsOn: null, lines: usdLines(10_007), participants: [], rates: [] });
    expect(pnl.blended).toEqual({ incomeUsdMinor: sum, expenseUsdMinor: 0, profitUsdMinor: sum });
  });
});

describe('HARDEN-3.3 Batch D (R4 L-02) — the /api/v2 tagged P&L says WHY an aggregate is unavailable', () => {
  const MAX_LINE = 900_000_000_000;
  const usdLines = (count: number) =>
    Array.from({ length: count }, () => line({ direction: 'Income', amountMinor: MAX_LINE, currency: 'USD' }));

  it('the 10,008-line overflow surfaces reason OVERFLOW through native + category + blended (never missing_rate, never a rounded number)', () => {
    const pnl = computeMissionPnl({ startsOn: '2026-08-01', endsOn: null, lines: usdLines(10_008), participants: [], rates: [] });
    // native USD income: unavailable(overflow) — the rounded v1 number is NOT re-served as ok.
    const usd = pnl.v2.perCurrency.find((c) => c.currency === 'USD')!;
    expect(usd.income).toEqual({ status: 'unavailable', reason: 'overflow' });
    expect(usd.expense).toEqual({ status: 'ok', amountMinor: 0 });
    // category (PrizeMoney income): native amount + USD roll-up both carry overflow.
    const cat = pnl.v2.perCategory.find((c) => c.category === 'PrizeMoney')!;
    expect(cat.actual.find((a) => a.currency === 'USD')!.amount).toEqual({ status: 'unavailable', reason: 'overflow' });
    expect(cat.actualUsd).toEqual({ status: 'unavailable', reason: 'overflow' });
    // blended: the reason is OVERFLOW — USD is the pivot, so missing_rate would be a lie.
    expect(pnl.missingRates).toEqual([]);
    expect(pnl.v2.blended.income).toEqual({ status: 'unavailable', reason: 'overflow' });
    expect(pnl.v2.blended.profit).toEqual({ status: 'unavailable', reason: 'overflow' });
  });

  it('R5-N07: a finite per-diem overflow MATERIALIZES tagged perCurrency + perCategory rows (never []); v1 blended null [Sentinel probe]', () => {
    // Sentinel's EXACT probe: a schema-valid per-diem cap (900,000,000,000, NOT 2^52) over a
    // 10,008-day finite mission — the product leaves the exact-integer range.
    const CAP = 900_000_000_000;
    const pnl = computeMissionPnl({
      startsOn: '2000-01-01',
      endsOn: '2027-05-26', // 10,008 inclusive days
      lines: [line({ direction: 'Income', amountMinor: 1_000_000, currency: 'USD' })],
      participants: [participant({ perDiemAmountMinor: CAP, perDiemCurrency: 'SAR' })],
      rates: [{ currency: 'SAR', usdPerUnit: 0.2666, updatedAt: '2026-07-10T00:00:00Z' }],
    });
    expect(pnl.perDiem.entries[0]!.days).toBe(10_008);
    expect(Number.isSafeInteger(CAP * 10_008)).toBe(false); // the product is genuinely unsafe

    // v2 emits the row — not [] (the round-5 miss): per-diem total, the SAR currency, and the
    // PerDiem category are all present and tagged overflow.
    expect(pnl.v2.perDiem.entries[0]!.total).toEqual({ status: 'unavailable', reason: 'overflow' });
    const sar = pnl.v2.perCurrency.find((c) => c.currency === 'SAR');
    expect(sar, 'a SAR perCurrency row is materialized').toBeTruthy();
    expect(sar!.expense).toEqual({ status: 'unavailable', reason: 'overflow' });
    const perDiemCat = pnl.v2.perCategory.find((c) => c.category === 'PerDiem');
    expect(perDiemCat, 'a PerDiem perCategory row is materialized').toBeTruthy();
    expect(perDiemCat!.actualUsd).toEqual({ status: 'unavailable', reason: 'overflow' });
    // all blended values overflow; v1 blended collapses to null.
    expect(pnl.v2.blended.income).toEqual({ status: 'unavailable', reason: 'overflow' });
    expect(pnl.v2.blended.profit).toEqual({ status: 'unavailable', reason: 'overflow' });
    expect(pnl.blended).toBeNull();
  });

  it('R5-N08: a PRESENT-rate conversion overflow is tagged overflow (not missing_rate); missingRates=[] [Sentinel probe]', () => {
    // Sentinel's EXACT probe: one 900,000,000,000 AED line with a PRESENT schema-valid rate
    // of 1,000,000 (usdPerUnit) — the conversion product overflows though the rate exists.
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: null,
      lines: [line({ direction: 'Expense', amountMinor: 900_000_000_000, currency: 'AED' })],
      participants: [],
      rates: [{ currency: 'AED', usdPerUnit: 1_000_000, updatedAt: '2026-07-10T00:00:00Z' }],
    });
    // native AED is exact; the USD side is overflow, NOT missing_rate; and the rate is present
    // so missingRates is empty (the round-5 mislabel).
    const aed = pnl.v2.perCurrency.find((c) => c.currency === 'AED')!;
    expect(aed.expense).toEqual({ status: 'ok', amountMinor: 900_000_000_000 });
    const cat = pnl.v2.perCategory.find((c) => c.category === 'Travel')!;
    expect(cat.actual.find((a) => a.currency === 'AED')!.amount).toEqual({ status: 'ok', amountMinor: 900_000_000_000 });
    expect(cat.actualUsd).toEqual({ status: 'unavailable', reason: 'overflow' });
    expect(pnl.v2.blended.expense).toEqual({ status: 'unavailable', reason: 'overflow' });
    expect(pnl.missingRates).toEqual([]); // the rate IS present — never a false missing_rate
  });

  it('an OPEN-ENDED mission reports reason open_ended (not overflow) and still blends the line money', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: null,
      lines: [line({ direction: 'Income', amountMinor: 1_000_000, currency: 'USD' })],
      participants: [participant({ perDiemAmountMinor: 10_000, perDiemCurrency: 'USD' })],
      rates: [],
    });
    expect(pnl.v2.perDiem.openEnded).toBe(true);
    expect(pnl.v2.perDiem.entries[0]!.total).toEqual({ status: 'unavailable', reason: 'open_ended' });
    expect(pnl.v2.blended.income).toEqual({ status: 'ok', amountMinor: 1_000_000 }); // open-ended ≠ poisoned
  });

  it('a missing live rate reports missing_rate (not overflow) at the category USD and the blend', () => {
    const pnl = computeMissionPnl({
      startsOn: '2026-08-01',
      endsOn: null,
      lines: [line({ direction: 'Expense', amountMinor: 50_000, currency: 'EUR' })], // no EUR rate
      participants: [],
      rates: [],
    });
    const cat = pnl.v2.perCategory.find((c) => c.category === 'Travel')!;
    expect(cat.actual.find((a) => a.currency === 'EUR')!.amount).toEqual({ status: 'ok', amountMinor: 50_000 }); // native is exact
    expect(cat.actualUsd).toEqual({ status: 'unavailable', reason: 'missing_rate' });
    expect(pnl.v2.blended.expense).toEqual({ status: 'unavailable', reason: 'missing_rate' });
  });
});
