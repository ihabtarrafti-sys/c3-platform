/**
 * missionLine.ts — mission income/expense lines and the P&L derivation
 * (Finance Sprint 4; design: docs/design/FINANCE-S4-mission-pnl.md).
 *
 * A mission's money story: INCOME lines (prize money, org support, partnership
 * fees, …) against EXPENSE lines (travel, hotels, …), each in its NATIVE
 * currency (integer minor units — the money.ts discipline), plus the roster's
 * per-diems rolling in as an expense automatically (rate × inclusive mission
 * days, from Finance S2). Profit = income − expense, blended to USD through
 * the org's editable FX table (Finance S1).
 *
 * GOVERNANCE: lines are DIRECT-BUT-AUDITED (the per-diem/mission-shell
 * posture) — they RECORD operational facts, unlike agreement terms which are
 * COMMITMENTS to people and therefore governed (S3.5). Writes owner/operations
 * (canManageMissions + canViewFinancials belt-and-braces); reads are gated to
 * canViewFinancials — the whole P&L surface is financial data (section-level
 * denial; legal/hr/visitor never see it). Direction is immutable (an income
 * line cannot flip to expense — remove and re-add). Removal is a soft
 * `isActive` flip (the data plane grants no DELETE).
 *
 * The P&L itself is a pure READ-SIDE DERIVATION (the credentialStatusOn
 * pattern): nothing is stored, and it is HONEST about what it cannot know —
 * a missing FX rate means "no USD blend" (never an invented number), an
 * open-ended mission means per-diem totals are excluded and flagged.
 */

import { z } from 'zod';
import { currencyCodeSchema, convertMinor, usdPerUnitMap, PIVOT_CURRENCY, type CurrencyCode, type FxRate } from './money';
import { missionDayCount, type MissionParticipant } from './mission';

export const MISSION_LINE_DIRECTIONS = ['Income', 'Expense'] as const;
export type MissionLineDirection = (typeof MISSION_LINE_DIRECTIONS)[number];

/** One income or expense line on a mission (surrogate UUID lives in persistence). */
export interface MissionLine {
  /** Canonical business identity, e.g. "PNL-0001". */
  readonly lineId: string;
  readonly tenantId: string;
  /** The owning mission (MSN-XXXX). */
  readonly missionId: string;
  /** Immutable: an income line never flips to expense (remove + re-add). */
  readonly direction: MissionLineDirection;
  /** What this money is, e.g. "Prize — 2nd place", "Flights", "Org support". */
  readonly label: string;
  /** Integer minor units, > 0 (the sign lives in `direction`, never the amount). */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── input contracts ──────────────────────────────────────────────────────────

const labelField = z.string().trim().min(1, 'A label is required').max(200);
const positiveAmountMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const missionLineCreateInputSchema = z
  .object({
    direction: z.enum(MISSION_LINE_DIRECTIONS),
    label: labelField,
    amountMinor: positiveAmountMinor,
    currency: currencyCodeSchema,
  })
  .strict();
export type MissionLineCreateInput = z.infer<typeof missionLineCreateInputSchema>;

/**
 * Update — a PARTIAL patch plus the mandatory expected version (the
 * direct-audited convention: equipment/mission/agreement-patch). Direction is
 * immutable and not representable here.
 */
export const missionLineUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    label: labelField.optional(),
    amountMinor: positiveAmountMinor.optional(),
    currency: currencyCodeSchema.optional(),
  })
  .strict()
  .refine((v) => ['label', 'amountMinor', 'currency'].some((k) => k in v && v[k as keyof typeof v] !== undefined), {
    message: 'An update must change at least one field',
  });
export type MissionLineUpdateInput = z.infer<typeof missionLineUpdateInputSchema>;

// ── the P&L derivation (pure; nothing stored) ────────────────────────────────

/** Native-currency subtotal (per-diem totals included in expense when computable). */
export interface MissionPnlCurrencyTotal {
  readonly currency: CurrencyCode;
  readonly incomeMinor: number;
  readonly expenseMinor: number;
}

/** One active participant's per-diem as it rolls into the P&L. */
export interface MissionPerDiemEntry {
  readonly personId: string;
  readonly personName: string;
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  /** Inclusive mission days; null when the mission is open-ended. */
  readonly days: number | null;
  /** rate × days; null when the mission is open-ended (not includable). */
  readonly totalMinor: number | null;
}

export interface MissionPnl {
  /** Native subtotals, sorted by currency code (deterministic). */
  readonly perCurrency: readonly MissionPnlCurrencyTotal[];
  readonly perDiem: {
    readonly entries: readonly MissionPerDiemEntry[];
    /** True when the mission has no end date — per-diem totals are excluded. */
    readonly openEnded: boolean;
  };
  /**
   * USD blend via the FX table; NULL when any needed rate is missing (the
   * honest answer — never an invented number). Converted per currency-subtotal
   * to minimize rounding.
   */
  readonly blended: {
    readonly incomeUsdMinor: number;
    readonly expenseUsdMinor: number;
    readonly profitUsdMinor: number;
  } | null;
  /** Currencies present in the P&L that have no stored rate, sorted. */
  readonly missingRates: readonly CurrencyCode[];
}

export function computeMissionPnl(args: {
  startsOn: string;
  endsOn: string | null;
  lines: readonly Pick<MissionLine, 'direction' | 'amountMinor' | 'currency'>[];
  participants: readonly Pick<MissionParticipant, 'personId' | 'personName' | 'isActive' | 'perDiemAmountMinor' | 'perDiemCurrency'>[];
  rates: readonly FxRate[];
}): MissionPnl {
  const days = missionDayCount(args.startsOn, args.endsOn);
  const openEnded = args.endsOn === null;

  // Per-diem roll-in: ACTIVE participants with a rate. Removed participants'
  // rates are dormant history, not a live cost.
  const entries: MissionPerDiemEntry[] = args.participants
    .filter((p) => p.isActive && p.perDiemAmountMinor != null && p.perDiemCurrency != null)
    .map((p) => ({
      personId: p.personId,
      personName: p.personName,
      amountMinor: p.perDiemAmountMinor!,
      currency: p.perDiemCurrency!,
      days,
      totalMinor: days != null ? p.perDiemAmountMinor! * days : null,
    }));

  // Native subtotals: lines by direction + computable per-diem totals as expense.
  const byCurrency = new Map<CurrencyCode, { incomeMinor: number; expenseMinor: number }>();
  const bucket = (currency: CurrencyCode) => {
    let b = byCurrency.get(currency);
    if (!b) {
      b = { incomeMinor: 0, expenseMinor: 0 };
      byCurrency.set(currency, b);
    }
    return b;
  };
  for (const line of args.lines) {
    const b = bucket(line.currency);
    if (line.direction === 'Income') b.incomeMinor += line.amountMinor;
    else b.expenseMinor += line.amountMinor;
  }
  for (const e of entries) {
    if (e.totalMinor != null) bucket(e.currency).expenseMinor += e.totalMinor;
  }
  const perCurrency: MissionPnlCurrencyTotal[] = [...byCurrency.entries()]
    .map(([currency, t]) => ({ currency, ...t }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  // USD blend — all-or-nothing per the honesty rule: one missing rate means no
  // blended figure at all (a partial sum would silently misstate profit).
  const map = usdPerUnitMap(args.rates);
  const missingRates = perCurrency
    .map((t) => t.currency)
    .filter((c) => !map[c])
    .sort((a, b) => a.localeCompare(b));

  let blended: MissionPnl['blended'] = null;
  if (missingRates.length === 0) {
    let incomeUsdMinor = 0;
    let expenseUsdMinor = 0;
    for (const t of perCurrency) {
      incomeUsdMinor += convertMinor(t.incomeMinor, t.currency, PIVOT_CURRENCY, map) ?? 0;
      expenseUsdMinor += convertMinor(t.expenseMinor, t.currency, PIVOT_CURRENCY, map) ?? 0;
    }
    blended = { incomeUsdMinor, expenseUsdMinor, profitUsdMinor: incomeUsdMinor - expenseUsdMinor };
  }

  return { perCurrency, perDiem: { entries, openEnded }, blended, missingRates };
}
