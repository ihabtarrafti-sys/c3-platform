/**
 * missionLine.ts — mission income/expense lines, budgets, and the P&L
 * derivation (Finance Sprint 4, upgraded by S2 Mission Finance;
 * design: docs/design/S2-mission-finance-upgrade.md).
 *
 * S2 upgrades, straight from Geekay's real mastersheets + the frozen app's
 * Mission Finance v1 design:
 *   - every line carries a CATEGORY from the merged taxonomy (per direction);
 *     'PerDiem' is RESERVED for the roll-in engine — never a manual line, but
 *     a legal EXPENSE BUDGET category (budget vs rolled-in actual);
 *   - INCOME lines carry payment tracking: Expected → Invoiced → Received,
 *     with the received amount (may differ from expected), an optional FX
 *     snapshot at receipt (usdPerUnit truth on the day the money landed), a
 *     bank/payment-source LABEL (ESA, ADCB — never account numbers), and the
 *     external bank reference (e.g. FT2501475Z6Z) for reconciliation;
 *   - BUDGETS: one planned amount per (direction, category, currency),
 *     upsert-set like FX rates; the P&L derives budget-vs-actual variance.
 *
 * GOVERNANCE unchanged from S4: lines/budgets are DIRECT-BUT-AUDITED (they
 * RECORD operational facts; commitments stay governed). Reads are gated to
 * canViewFinancials. Direction AND category are immutable on a line (remove +
 * re-add). The P&L stays a PURE derivation — nothing computed is stored — and
 * keeps the honesty rules: a missing rate = no invented blend; an open-ended
 * mission excludes per-diem totals and says so. Income lines blend PER LINE:
 * a Received line with an FX snapshot converts at ITS OWN recorded truth.
 */

import { z } from 'zod';
import { currencyCodeSchema, convertMinor, usdPerUnitMap, MAX_AMOUNT_MINOR, PIVOT_CURRENCY, type CurrencyCode, type FxRate } from './money';
import { missionDayCount, type MissionParticipant } from './mission';

export const MISSION_LINE_DIRECTIONS = ['Income', 'Expense'] as const;
export type MissionLineDirection = (typeof MISSION_LINE_DIRECTIONS)[number];

// ── the category taxonomy (GK-Core income types ∪ frozen-app Mission Finance v1) ──

export const INCOME_CATEGORIES = [
  'PrizeMoney',
  'AppearanceFee',
  'Support',
  'Sponsorship',
  'RevenueShare',
  'Buyout',
  'Campaign',
  'TravelReimbursement',
  'Other',
] as const;
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

/** Manual expense categories. 'PerDiem' is engine-owned (see PER_DIEM_CATEGORY). */
export const EXPENSE_CATEGORIES = [
  'RegistrationFee',
  'Travel',
  'Accommodation',
  'PlayerFee',
  'Equipment',
  'Logistics',
  'Contingency',
  'Other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * The per-diem expense category: produced ONLY by the roster roll-in (a manual
 * 'PerDiem' line would double-count), but a legal BUDGET category — their
 * tournament budget template budgets per-diems, and the engine supplies the
 * actual.
 */
export const PER_DIEM_CATEGORY = 'PerDiem' as const;

export type MissionLineCategory = IncomeCategory | ExpenseCategory | typeof PER_DIEM_CATEGORY;

export function categoriesForDirection(direction: MissionLineDirection): readonly string[] {
  return direction === 'Income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
}

/** Budget categories additionally admit the engine-owned PerDiem on the expense side. */
export function budgetCategoriesForDirection(direction: MissionLineDirection): readonly string[] {
  return direction === 'Income' ? INCOME_CATEGORIES : [...EXPENSE_CATEGORIES, PER_DIEM_CATEGORY];
}

// ── payment tracking (income lines only) ─────────────────────────────────────

export const PAYMENT_STATUSES = ['Expected', 'Invoiced', 'Received'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** One income or expense line on a mission (surrogate UUID lives in persistence). */
export interface MissionLine {
  /** Canonical business identity, e.g. "PNL-0001". */
  readonly lineId: string;
  readonly tenantId: string;
  /** The owning mission (MSN-XXXX). */
  readonly missionId: string;
  /** Immutable: an income line never flips to expense (remove + re-add). */
  readonly direction: MissionLineDirection;
  /** Immutable, from the taxonomy for its direction ('Other' = the honest bucket). */
  readonly category: string;
  /** What this money is, e.g. "Prize — 2nd place", "Flights", "Org support". */
  readonly label: string;
  /** Integer minor units, > 0 (the sign lives in `direction`, never the amount). */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  /** Income only: Expected → Invoiced → Received. Null on expense lines. */
  readonly paymentStatus: PaymentStatus | null;
  /** Received only: what actually landed (fees/partials); null = as expected. */
  readonly receivedAmountMinor: number | null;
  /** Received only, optional: usdPerUnit truth AT RECEIPT (the FX snapshot). */
  readonly receivedUsdPerUnit: number | null;
  /** Bank/payment source LABEL only (ESA, ADCB) — never account numbers. */
  readonly paymentSourceLabel: string | null;
  /** External bank reference for reconciliation, e.g. "FT2501475Z6Z". */
  readonly refNo: string | null;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── input contracts ──────────────────────────────────────────────────────────

const labelField = z.string().trim().min(1, 'A label is required').max(200);
const positiveAmountMinor = z.number().int().positive().max(MAX_AMOUNT_MINOR);
const shortOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

export const missionLineCreateInputSchema = z
  .object({
    direction: z.enum(MISSION_LINE_DIRECTIONS),
    category: z.string().min(1),
    label: labelField,
    amountMinor: positiveAmountMinor,
    currency: currencyCodeSchema,
  })
  .strict()
  .refine((v) => categoriesForDirection(v.direction).includes(v.category), {
    message: 'The category does not belong to this direction (per-diem lines come from the roster roll-in).',
    path: ['category'],
  });
export type MissionLineCreateInput = z.infer<typeof missionLineCreateInputSchema>;

/**
 * Update — a PARTIAL patch plus the mandatory expected version. Direction,
 * category, and payment tracking are NOT representable here: the first two
 * are immutable; payment moves through its own audited action.
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

/**
 * SetLinePayment (S2) — the audited income-payment action. Any status is
 * settable (corrections are legal; the trail is the truth), but received
 * detail may only accompany Received.
 */
export const missionLinePaymentInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    paymentStatus: z.enum(PAYMENT_STATUSES),
    receivedAmountMinor: positiveAmountMinor.nullish().transform((v) => v ?? null),
    /** usdPerUnit at receipt; a positive rate (USD lines never need one). */
    receivedUsdPerUnit: z.number().positive().max(1_000_000).nullish().transform((v) => v ?? null),
    paymentSourceLabel: shortOptional(60),
    refNo: shortOptional(60),
  })
  .strict()
  .refine((v) => v.paymentStatus === 'Received' || (v.receivedAmountMinor === null && v.receivedUsdPerUnit === null), {
    message: 'Received amount and FX snapshot only accompany the Received status.',
  });
export type MissionLinePaymentInput = z.infer<typeof missionLinePaymentInputSchema>;

// ── budgets (upsert-set per direction+category+currency, like FX rates) ──────

export interface MissionBudget {
  readonly tenantId: string;
  readonly missionId: string;
  readonly direction: MissionLineDirection;
  readonly category: string;
  readonly currency: CurrencyCode;
  /** Integer minor units, > 0 (setting 0/clearing removes the row). */
  readonly amountMinor: number;
  /** HARDEN-2 M-03: optimistic-concurrency token — every cell write bumps it. */
  readonly version: number;
  readonly updatedAt: string;
}

export const setMissionBudgetInputSchema = z
  .object({
    direction: z.enum(MISSION_LINE_DIRECTIONS),
    category: z.string().min(1),
    currency: currencyCodeSchema,
    /** Null clears the budget row for this key. */
    amountMinor: positiveAmountMinor.nullable(),
    /**
     * HARDEN-2 M-03: the cell version the caller read, or null when the caller
     * believes the cell is EMPTY. A null against an existing cell (or a version
     * against a missing/stale cell) is a concurrency refusal — budgets are no
     * longer last-write-wins.
     */
    expectedVersion: z.number().int().min(0).nullable(),
  })
  .strict()
  .refine((v) => budgetCategoriesForDirection(v.direction).includes(v.category), {
    message: 'The category does not belong to this direction.',
    path: ['category'],
  });
export type SetMissionBudgetInput = z.infer<typeof setMissionBudgetInputSchema>;

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

/** S2: budget-vs-actual per (direction, category), natives + blended variance. */
export interface MissionPnlCategoryRow {
  readonly direction: MissionLineDirection;
  readonly category: string;
  readonly actual: readonly { currency: CurrencyCode; amountMinor: number }[];
  readonly budget: readonly { currency: CurrencyCode; amountMinor: number }[];
  /** actualUsd − budgetUsd; null when any needed rate is missing. */
  readonly actualUsdMinor: number | null;
  readonly budgetUsdMinor: number | null;
  readonly varianceUsdMinor: number | null;
}

/** S2: settlement truth, derived — feeds the →Settled transition guard. */
export interface MissionSettlement {
  /** ACTIVE income lines not yet Received. */
  readonly outstandingIncomeCount: number;
  /** True when there is at least one active income line and every one is Received. */
  readonly incomeComplete: boolean;
}

/**
 * M-04: THE single settlement predicate, shared by the read-side P&L and the
 * write-side settle guard so they can never disagree. Evaluated over ACTIVE
 * income lines only (a removed line neither blocks settlement nor counts as
 * money), and settlement requires ≥1 active income line — an empty or
 * expense-only mission has nothing to settle. Callers pass already-active lines
 * (the read path filters is_active upstream; the settle guard filters the
 * FOR-UPDATE-locked set), so this function trusts is_active if present.
 */
export function missionSettlement(
  lines: readonly (Pick<MissionLine, 'direction' | 'paymentStatus'> & { readonly isActive?: boolean })[],
): MissionSettlement {
  const activeIncome = lines.filter((l) => l.direction === 'Income' && l.isActive !== false);
  const outstandingIncomeCount = activeIncome.filter((l) => l.paymentStatus !== 'Received').length;
  return { outstandingIncomeCount, incomeComplete: activeIncome.length > 0 && outstandingIncomeCount === 0 };
}

/** R4 L-02 (v2): WHY an aggregate is unavailable — explicit, never one overloaded null. */
export type PnlUnavailableReason = 'overflow' | 'missing_rate' | 'open_ended';
/** A money aggregate that is either exact or HONESTLY unavailable with its reason. */
export type PnlAmount =
  | { readonly status: 'ok'; readonly amountMinor: number }
  | { readonly status: 'unavailable'; readonly reason: PnlUnavailableReason };

/**
 * R4 L-02: the /api/v2 P&L shape. Every potentially-unbounded aggregate is a tagged
 * PnlAmount, so an overflow / missing rate / open-ended gap is REPORTED, never a
 * silently-rounded number (v1's frozen `number` fields cannot say why — the UI reads this).
 */
export interface MissionPnlV2 {
  readonly perCurrency: readonly { currency: CurrencyCode; income: PnlAmount; expense: PnlAmount }[];
  readonly perDiem: {
    readonly openEnded: boolean;
    readonly entries: readonly {
      personId: string;
      personName: string;
      amountMinor: number;
      currency: CurrencyCode;
      days: number | null;
      total: PnlAmount;
    }[];
  };
  readonly perCategory: readonly {
    direction: MissionLineDirection;
    category: string;
    actual: readonly { currency: CurrencyCode; amount: PnlAmount }[];
    budget: readonly { currency: CurrencyCode; amount: PnlAmount }[];
    actualUsd: PnlAmount;
    budgetUsd: PnlAmount;
    varianceUsd: PnlAmount;
  }[];
  readonly blended: { income: PnlAmount; expense: PnlAmount; profit: PnlAmount };
}

export interface MissionPnl {
  /** Native subtotals, sorted by currency code (deterministic). */
  readonly perCurrency: readonly MissionPnlCurrencyTotal[];
  readonly perDiem: {
    readonly entries: readonly MissionPerDiemEntry[];
    /** True when the mission has no end date — per-diem totals are excluded. */
    readonly openEnded: boolean;
  };
  /** S2: budget-vs-actual rows, income first then expense, category-sorted. */
  readonly perCategory: readonly MissionPnlCategoryRow[];
  readonly settlement: MissionSettlement;
  /**
   * USD blend; NULL when any needed rate is missing (the honest answer).
   * INCOME blends PER LINE: Received lines use their received amount, and a
   * recorded FX snapshot beats the live table (the truth at receipt).
   * Expenses and per-diems blend per currency-subtotal off the live table.
   */
  readonly blended: {
    readonly incomeUsdMinor: number;
    readonly expenseUsdMinor: number;
    readonly profitUsdMinor: number;
  } | null;
  /** Currencies present in the P&L that have no usable rate, sorted. */
  readonly missingRates: readonly CurrencyCode[];
  /** R4 L-02: the tagged view served by /api/v2 (v1's serializer never emits it). */
  readonly v2: MissionPnlV2;
}

type PnlLine = Pick<
  MissionLine,
  'direction' | 'category' | 'amountMinor' | 'currency' | 'paymentStatus' | 'receivedAmountMinor' | 'receivedUsdPerUnit'
>;

/** The amount a line truly contributes: received truth when it landed, else the expectation. */
function effectiveAmountMinor(line: PnlLine): number {
  return line.paymentStatus === 'Received' && line.receivedAmountMinor != null ? line.receivedAmountMinor : line.amountMinor;
}

export function computeMissionPnl(args: {
  startsOn: string;
  endsOn: string | null;
  lines: readonly PnlLine[];
  budgets?: readonly Pick<MissionBudget, 'direction' | 'category' | 'currency' | 'amountMinor'>[];
  participants: readonly Pick<MissionParticipant, 'personId' | 'personName' | 'isActive' | 'perDiemAmountMinor' | 'perDiemCurrency'>[];
  rates: readonly FxRate[];
}): MissionPnl {
  const budgets = args.budgets ?? [];
  const days = missionDayCount(args.startsOn, args.endsOn);
  const openEnded = args.endsOn === null;
  const map = usdPerUnitMap(args.rates);

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
      // L-02: null (not-computable) rather than a silently-imprecise product if
      // amount × days would leave the exact-integer range.
      totalMinor: days != null && Number.isSafeInteger(p.perDiemAmountMinor! * days) ? p.perDiemAmountMinor! * days : null,
    }));

  // Native subtotals (income at its EFFECTIVE amount) + computable per-diems as expense.
  // L-02: any aggregate that leaves the exact-integer range flips `unbounded`, which
  // collapses the authoritative blended USD total to null (fail-closed) — a P&L never
  // reports a silently-imprecise grand total. The native per-currency subtotals keep the
  // frozen-v1 `number` shape; a single-currency subtotal past 2^53 minor units is not
  // physically reachable, but if it ever were, `unbounded` refuses the blend.
  let unbounded = false;
  // R4 L-02 (v2): overflow is tracked PER SLOT so v2 can say WHICH aggregate left the exact
  // range; any slot overflow also flips the global `unbounded` (v1's blended collapse).
  const overflowSlots = new Set<string>();
  const trackAdd = (slot: string, acc: number, add: number): number => {
    const sum = acc + add;
    if (!Number.isSafeInteger(sum)) {
      unbounded = true;
      overflowSlots.add(slot);
    }
    return sum;
  };
  // R4 L-02: a FINITE mission whose per-diem product left the exact range is an OVERFLOW —
  // it must poison the blend (v1) and carry the reason (v2), never be quietly omitted the
  // way an open-ended (days=null) entry legitimately is.
  for (const e of entries) {
    if (e.days != null && e.totalMinor == null) unbounded = true;
  }
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
    if (line.direction === 'Income') b.incomeMinor = trackAdd(`cur:${line.currency}:income`, b.incomeMinor, effectiveAmountMinor(line));
    else b.expenseMinor = trackAdd(`cur:${line.currency}:expense`, b.expenseMinor, line.amountMinor);
  }
  for (const e of entries) {
    if (e.totalMinor != null) {
      const b = bucket(e.currency);
      b.expenseMinor = trackAdd(`cur:${e.currency}:expense`, b.expenseMinor, e.totalMinor);
    }
  }
  const perCurrency: MissionPnlCurrencyTotal[] = [...byCurrency.entries()]
    .map(([currency, t]) => ({ currency, ...t }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  // A currency is UNBLENDABLE when some contribution needs the live table and
  // the table has no rate. An income line with its own snapshot never does.
  const missing = new Set<CurrencyCode>();
  const liveUsd = (amountMinor: number, currency: CurrencyCode): number | null => {
    const usd = convertMinor(amountMinor, currency, PIVOT_CURRENCY, map);
    if (usd === null) missing.add(currency);
    return usd;
  };

  // HARDEN-2 M-02: live-rate money blends PER CURRENCY-SUBTOTAL — one
  // conversion per currency, so splitting an amount across rows can never move
  // the USD total by a cent. Received income with an FX snapshot converts per
  // line: each receipt is its own economic truth (the recorded rate at landing).
  const hasSnapshot = (line: PnlLine): boolean =>
    line.direction === 'Income' && line.paymentStatus === 'Received' && line.receivedUsdPerUnit != null;
  // M-05 defensive: a USD line is the pivot — always convert at 1, never at a
  // stored snapshot (which the boundary now forbids, but the P&L must not inflate
  // even if a legacy non-unity value survives).
  const snapshotUsd = (line: PnlLine): number =>
    Math.round(effectiveAmountMinor(line) * (line.currency === PIVOT_CURRENCY ? 1 : line.receivedUsdPerUnit!));
  const addTo = (slot: string, m: Map<CurrencyCode, number>, currency: CurrencyCode, amount: number) =>
    m.set(currency, trackAdd(`${slot}:${currency}`, m.get(currency) ?? 0, amount));

  const liveIncomeByCurrency = new Map<CurrencyCode, number>();
  const liveExpenseByCurrency = new Map<CurrencyCode, number>();
  let incomeUsdMinor = 0;
  let expenseUsdMinor = 0;
  for (const line of args.lines) {
    if (hasSnapshot(line)) incomeUsdMinor = trackAdd('blend:income', incomeUsdMinor, snapshotUsd(line));
    else if (line.direction === 'Income') addTo('blendsub:income', liveIncomeByCurrency, line.currency, effectiveAmountMinor(line));
    else addTo('blendsub:expense', liveExpenseByCurrency, line.currency, line.amountMinor);
  }
  for (const e of entries) {
    if (e.totalMinor != null) addTo('blendsub:expense', liveExpenseByCurrency, e.currency, e.totalMinor);
  }
  for (const [currency, subtotal] of liveIncomeByCurrency) {
    const usd = liveUsd(subtotal, currency);
    if (usd !== null) incomeUsdMinor = trackAdd('blend:income', incomeUsdMinor, usd);
  }
  for (const [currency, subtotal] of liveExpenseByCurrency) {
    const usd = liveUsd(subtotal, currency);
    if (usd !== null) expenseUsdMinor = trackAdd('blend:expense', expenseUsdMinor, usd);
  }

  // S2: budget-vs-actual per (direction, category). Budgets blend off the live
  // table (planning money has no receipt truth). M-02: category USD follows the
  // same law at its own grain — live-rate money converts once per (category,
  // currency) subtotal; snapshot income lands per line.
  const keyOf = (d: MissionLineDirection, c: string) => `${d}:${c}`;
  const catActual = new Map<string, Map<CurrencyCode, number>>();
  const addCat = (slot: string, mapM: Map<string, Map<CurrencyCode, number>>, key: string, currency: CurrencyCode, amount: number) => {
    let m = mapM.get(key);
    if (!m) {
      m = new Map();
      mapM.set(key, m);
    }
    m.set(currency, trackAdd(`${slot}:${key}:${currency}`, m.get(currency) ?? 0, amount)); // L-02: overflow flips `unbounded`
  };
  const catLive = new Map<string, Map<CurrencyCode, number>>();
  const catSnapshotUsd = new Map<string, number>();
  for (const line of args.lines) {
    const key = keyOf(line.direction, line.category);
    addCat('catA', catActual, key, line.currency, effectiveAmountMinor(line));
    if (hasSnapshot(line)) catSnapshotUsd.set(key, trackAdd(`catUsdA:${key}`, catSnapshotUsd.get(key) ?? 0, snapshotUsd(line)));
    else addCat('catLive', catLive, key, line.currency, effectiveAmountMinor(line));
  }
  for (const e of entries) {
    if (e.totalMinor == null) continue;
    const key = keyOf('Expense', PER_DIEM_CATEGORY);
    addCat('catA', catActual, key, e.currency, e.totalMinor);
    addCat('catLive', catLive, key, e.currency, e.totalMinor);
  }
  const catActualUsd = new Map<string, number | null>();
  for (const key of catActual.keys()) {
    let usd: number | null = catSnapshotUsd.get(key) ?? 0;
    for (const [currency, subtotal] of catLive.get(key) ?? new Map<CurrencyCode, number>()) {
      const c = liveUsd(subtotal, currency);
      usd = usd === null || c === null ? null : trackAdd(`catUsdA:${key}`, usd, c);
    }
    catActualUsd.set(key, usd);
  }
  const catBudget = new Map<string, Map<CurrencyCode, number>>();
  const catBudgetUsd = new Map<string, number | null>();
  for (const b of budgets) {
    const key = keyOf(b.direction, b.category);
    addCat('catB', catBudget, key, b.currency, b.amountMinor);
    const usd = convertMinor(b.amountMinor, b.currency, PIVOT_CURRENCY, map);
    if (usd === null) missing.add(b.currency);
    const cur = catBudgetUsd.has(key) ? catBudgetUsd.get(key)! : 0;
    catBudgetUsd.set(key, cur === null || usd === null ? null : trackAdd(`catUsdB:${key}`, cur, usd));
  }

  const allKeys = [...new Set([...catActual.keys(), ...catBudget.keys()])];
  const perCategory: MissionPnlCategoryRow[] = allKeys
    .map((key) => {
      const [direction, category] = key.split(':') as [MissionLineDirection, string];
      const toList = (m: Map<CurrencyCode, number> | undefined) =>
        [...(m ?? new Map<CurrencyCode, number>()).entries()]
          .map(([currency, amountMinor]) => ({ currency, amountMinor }))
          .sort((a, b) => a.currency.localeCompare(b.currency));
      // Preserve the honest null (unblendable) — never coalesce it into a 0.
      const actualUsdMinor = catActual.has(key) ? catActualUsd.get(key)! : 0;
      const budgetUsdMinor = catBudget.has(key) ? catBudgetUsd.get(key)! : 0;
      return {
        direction,
        category,
        actual: toList(catActual.get(key)),
        budget: toList(catBudget.get(key)),
        actualUsdMinor,
        budgetUsdMinor,
        varianceUsdMinor: actualUsdMinor === null || budgetUsdMinor === null ? null : actualUsdMinor - budgetUsdMinor,
      };
    })
    .sort((a, b) => (a.direction === b.direction ? a.category.localeCompare(b.category) : a.direction === 'Income' ? -1 : 1));

  // Settlement truth (M-04): the shared predicate — ≥1 active income line, all
  // Received. args.lines are already active (the read path filters is_active).
  const settlement = missionSettlement(args.lines);

  const missingRates = [...missing].sort((a, b) => a.localeCompare(b));
  // L-02: the blended USD total is computable only when every rate is present AND no
  // aggregate overflowed the exact-integer range — otherwise it is honestly not computable.
  const blended =
    missingRates.length === 0 && !unbounded
      ? { incomeUsdMinor, expenseUsdMinor, profitUsdMinor: incomeUsdMinor - expenseUsdMinor }
      : null;

  // ── R4 L-02: the tagged /api/v2 view — every unavailable aggregate SAYS WHY. ──────────
  const okOr = (slotOverflowed: boolean, amountMinor: number): PnlAmount =>
    slotOverflowed ? { status: 'unavailable', reason: 'overflow' } : { status: 'ok', amountMinor };
  const v2: MissionPnlV2 = {
    perCurrency: perCurrency.map((t) => ({
      currency: t.currency,
      income: okOr(overflowSlots.has(`cur:${t.currency}:income`), t.incomeMinor),
      expense: okOr(overflowSlots.has(`cur:${t.currency}:expense`), t.expenseMinor),
    })),
    perDiem: {
      openEnded,
      entries: entries.map((e) => ({
        personId: e.personId,
        personName: e.personName,
        amountMinor: e.amountMinor,
        currency: e.currency,
        days: e.days,
        // Distinct reasons: open-ended is a legitimate exclusion; a finite-mission product
        // past 2^53 is an OVERFLOW (and has already poisoned the blend above).
        total:
          e.totalMinor != null
            ? { status: 'ok', amountMinor: e.totalMinor }
            : { status: 'unavailable', reason: e.days == null ? 'open_ended' : 'overflow' },
      })),
    },
    perCategory: perCategory.map((c) => {
      const key = keyOf(c.direction, c.category);
      const nat = (slot: 'catA' | 'catB', list: readonly { currency: CurrencyCode; amountMinor: number }[]) =>
        list.map((a) => ({ currency: a.currency, amount: okOr(overflowSlots.has(`${slot}:${key}:${a.currency}`), a.amountMinor) }));
      const usdOf = (
        usdSlot: string,
        natSlot: 'catA' | 'catB',
        value: number | null,
        list: readonly { currency: CurrencyCode; amountMinor: number }[],
      ): PnlAmount => {
        // A USD roll-up over an overflowed native subtotal (or an overflowed USD sum) is
        // garbage-in — report overflow; a null with clean adds means a rate was missing.
        if (overflowSlots.has(usdSlot) || list.some((a) => overflowSlots.has(`${natSlot}:${key}:${a.currency}`))) {
          return { status: 'unavailable', reason: 'overflow' };
        }
        return value === null ? { status: 'unavailable', reason: 'missing_rate' } : { status: 'ok', amountMinor: value };
      };
      const actualUsd = usdOf(`catUsdA:${key}`, 'catA', c.actualUsdMinor, c.actual);
      const budgetUsd = usdOf(`catUsdB:${key}`, 'catB', c.budgetUsdMinor, c.budget);
      const varianceUsd: PnlAmount =
        actualUsd.status === 'ok' && budgetUsd.status === 'ok'
          ? okOr(!Number.isSafeInteger(actualUsd.amountMinor - budgetUsd.amountMinor), actualUsd.amountMinor - budgetUsd.amountMinor)
          : {
              status: 'unavailable',
              reason:
                (actualUsd.status === 'unavailable' && actualUsd.reason === 'overflow') ||
                (budgetUsd.status === 'unavailable' && budgetUsd.reason === 'overflow')
                  ? 'overflow'
                  : 'missing_rate',
            };
      return { direction: c.direction, category: c.category, actual: nat('catA', c.actual), budget: nat('catB', c.budget), actualUsd, budgetUsd, varianceUsd };
    }),
    blended: (() => {
      // The blend mirrors v1's conservative collapse, but SAYS WHY: overflow anywhere in
      // the P&L beats missing_rate (an untrustworthy figure is worse than an absent rate).
      if (unbounded) {
        const u = { status: 'unavailable' as const, reason: 'overflow' as const };
        return { income: u, expense: u, profit: u };
      }
      if (missingRates.length > 0) {
        const u = { status: 'unavailable' as const, reason: 'missing_rate' as const };
        return { income: u, expense: u, profit: u };
      }
      return {
        income: { status: 'ok' as const, amountMinor: incomeUsdMinor },
        expense: { status: 'ok' as const, amountMinor: expenseUsdMinor },
        profit: { status: 'ok' as const, amountMinor: incomeUsdMinor - expenseUsdMinor },
      };
    })(),
  };

  return { perCurrency, perDiem: { entries, openEnded }, perCategory, settlement, blended, missingRates, v2 };
}
