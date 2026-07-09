/**
 * missionLines.test.ts — Finance Sprint 4 evidence against a REAL PostgreSQL.
 * Covers the direct-audited mission income/expense lines (add / patch / soft
 * remove + changed-fields-only audit on the Mission trail), the write gate
 * (owner/ops only), the canViewFinancials READ gate (section-level denial),
 * the active-mission-only rule, RLS isolation, and the FULL P&L assembly —
 * lines + a governed participant's per-diem + the FX table → blended profit.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, AddPersonInput } from '@c3web/domain';
import { ConflictError, ForbiddenError, NotFoundError } from '@c3web/domain';
import {
  addMissionLine,
  setMissionLinePayment,
  setMissionBudget,
  setMissionFinanceStage,
  getMissionsFinanceSummary,
  updateMissionLine,
  removeMissionLine,
  getMissionPnl,
  createMission,
  deactivateMission,
  setParticipantPerDiem,
  setFxRate,
  submitAddPerson,
  submitAddMissionParticipant,
  beginReview,
  approveApproval,
  executeApproval,
} from '@c3web/application';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;

const actor = (tenantId: string, email: string, role: string): Actor =>
  ({ identity: email, displayName: email, role: role as Actor['role'], tenantId });

let alphaId: string;
let alphaOwner: Actor;
let alphaOps: Actor;
let alphaFinance: Actor;
let alphaLegal: Actor;
let alphaVisitor: Actor;
let bravoOwner: Actor;

async function execAsOwner(approvalId: string, version: number) {
  const inReview = await beginReview(p, alphaOwner, approvalId, version);
  const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
  return executeApproval(p, alphaOwner, approved.approvalId, approved.version);
}

async function addPerson(fullName: string): Promise<string> {
  const a = await submitAddPerson(p, alphaOps, { input: { fullName } as AddPersonInput });
  const res = await execAsOwner(a.approvalId, a.version);
  return res.person!.personId;
}

async function newMission(endsOn: string | null = '2026-08-15'): Promise<string> {
  const m = await createMission(p, alphaOps, { name: 'Spring Invitational', gameTitle: null, startsOn: '2026-08-01', endsOn, notes: null });
  return m.missionId;
}

beforeAll(async () => {
  db = await startTestDatabase();
  p = createPersistence({ appConnectionString: db.appUrl });
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  const alpha = await db.seedTenant({
    slug: 'alpha',
    users: [
      { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner' },
      { key: 'ops', email: 'ops@a.com', displayName: 'Ops A', role: 'operations' },
      { key: 'finance', email: 'finance@a.com', displayName: 'Finance A', role: 'finance' },
      { key: 'legal', email: 'legal@a.com', displayName: 'Legal A', role: 'legal' },
      { key: 'visitor', email: 'visitor@a.com', displayName: 'Visitor A', role: 'visitor' },
    ],
  });
  const bravo = await db.seedTenant({ slug: 'bravo', users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }] });
  alphaId = alpha.tenantId;
  alphaOwner = actor(alphaId, 'owner@a.com', 'owner');
  alphaOps = actor(alphaId, 'ops@a.com', 'operations');
  alphaFinance = actor(alphaId, 'finance@a.com', 'finance');
  alphaLegal = actor(alphaId, 'legal@a.com', 'legal');
  alphaVisitor = actor(alphaId, 'visitor@a.com', 'visitor');
  bravoOwner = actor(bravo.tenantId, 'owner@b.com', 'owner');
});

describe('mission lines (direct-audited)', () => {
  it('add → patch (changed-fields-only audit) → soft remove, all on the Mission trail', async () => {
    const msn = await newMission();
    const line = await addMissionLine(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', label: 'Prize — 2nd place', amountMinor: 1_000_000, currency: 'USD' });
    expect(line).toMatchObject({ lineId: 'PNL-0001', direction: 'Income', amountMinor: 1_000_000, currency: 'USD', version: 0 });

    const bumped = await updateMissionLine(p, alphaOwner, msn, line.lineId, { expectedVersion: 0, amountMinor: 1_200_000 });
    expect(bumped).toMatchObject({ amountMinor: 1_200_000, version: 1 });
    // stale version refused
    await expect(updateMissionLine(p, alphaOps, msn, line.lineId, { expectedVersion: 0, amountMinor: 1 })).rejects.toThrow();

    const removed = await removeMissionLine(p, alphaOps, msn, line.lineId, bumped.version);
    expect(removed.isActive).toBe(false);
    expect((await getMissionPnl(p, alphaOwner, msn)).lines).toHaveLength(0); // removed rows hidden

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Mission', msn);
    expect(audit.map((a) => a.action)).toEqual(['MissionCreated', 'MissionLineAdded', 'MissionLineUpdated', 'MissionLineRemoved']);
    const upd = audit.find((a) => a.action === 'MissionLineUpdated')!;
    expect(upd.before).toMatchObject({ amountMinor: 1_000_000 });
    expect(upd.after).toMatchObject({ amountMinor: 1_200_000 });
    expect('label' in (upd.after ?? {})).toBe(false); // only the changed field
  });

  it('write gate: finance/legal/visitor may not add lines; read gate: legal/visitor may not view the P&L', async () => {
    const msn = await newMission();
    await addMissionLine(p, alphaOps, msn, { direction: 'Expense', category: 'Travel', label: 'Flights', amountMinor: 200_000, currency: 'USD' });

    for (const who of [alphaFinance, alphaLegal, alphaVisitor]) {
      await expect(addMissionLine(p, who, msn, { direction: 'Income', category: 'PrizeMoney', label: 'X', amountMinor: 1, currency: 'USD' })).rejects.toBeInstanceOf(ForbiddenError);
    }
    // finance CAN read the P&L; legal and visitor cannot (section-level denial)
    expect((await getMissionPnl(p, alphaFinance, msn)).lines).toHaveLength(1);
    await expect(getMissionPnl(p, alphaLegal, msn)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getMissionPnl(p, alphaVisitor, msn)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('lines may only be changed on an ACTIVE mission (a retired shell is frozen record — still readable)', async () => {
    const msn = await newMission();
    const line = await addMissionLine(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', label: 'Org support', amountMinor: 500_000, currency: 'USD' });
    const mission = await p.reads.forActor(alphaOwner).getMissionById(msn);
    await deactivateMission(p, alphaOps, msn, mission!.version);

    await expect(addMissionLine(p, alphaOps, msn, { direction: 'Expense', category: 'Travel', label: 'X', amountMinor: 1, currency: 'USD' })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateMissionLine(p, alphaOps, msn, line.lineId, { expectedVersion: line.version, amountMinor: 2 })).rejects.toBeInstanceOf(ConflictError);
    await expect(removeMissionLine(p, alphaOps, msn, line.lineId, line.version)).rejects.toBeInstanceOf(ConflictError);
    expect((await getMissionPnl(p, alphaOwner, msn)).lines).toHaveLength(1); // frozen, readable
  });

  it('is tenant-isolated (RLS): another tenant cannot reach the mission P&L', async () => {
    const msn = await newMission();
    await addMissionLine(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', label: 'Prize', amountMinor: 1, currency: 'USD' });
    await expect(getMissionPnl(p, bravoOwner, msn)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('the full P&L assembly (lines + per-diem roll-in + FX blend)', () => {
  it('income − expenses − per-diems = profit, blended to USD via the rate table', async () => {
    const msn = await newMission('2026-08-15'); // 15 inclusive days
    const personId = await addPerson('Jordan Reyes');
    const sub = await submitAddMissionParticipant(p, alphaOps, { input: { missionId: msn, personId, role: 'Player' } });
    await execAsOwner(sub.approvalId, sub.version);
    await setParticipantPerDiem(p, alphaOps, { missionId: msn, personId, perDiemAmountMinor: 25_000, perDiemCurrency: 'SAR' }); // SAR 250/day

    await addMissionLine(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', label: 'Prize — 2nd place', amountMinor: 1_000_000, currency: 'USD' });
    await addMissionLine(p, alphaOps, msn, { direction: 'Expense', category: 'Travel', label: 'Flights', amountMinor: 200_000, currency: 'USD' });
    await setFxRate(p, alphaOps, { currency: 'SAR', usdPerUnit: 0.2666 });

    const { pnl } = await getMissionPnl(p, alphaOwner, msn);
    expect(pnl.perDiem.entries).toEqual([
      { personId, personName: 'Jordan Reyes', amountMinor: 25_000, currency: 'SAR', days: 15, totalMinor: 375_000 },
    ]);
    expect(pnl.perCurrency).toEqual([
      { currency: 'SAR', incomeMinor: 0, expenseMinor: 375_000 },
      { currency: 'USD', incomeMinor: 1_000_000, expenseMinor: 200_000 },
    ]);
    const sarUsd = Math.round(375_000 * 0.2666); // 99,975
    expect(pnl.blended).toEqual({
      incomeUsdMinor: 1_000_000,
      expenseUsdMinor: 200_000 + sarUsd,
      profitUsdMinor: 1_000_000 - 200_000 - sarUsd,
    });
    expect(pnl.missingRates).toEqual([]);
  });

  it('a missing rate yields NO blended figure and names the currency', async () => {
    const msn = await newMission();
    await addMissionLine(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', label: 'Prize', amountMinor: 1_000_000, currency: 'USD' });
    await addMissionLine(p, alphaOps, msn, { direction: 'Expense', category: 'Travel', label: 'Hotels', amountMinor: 367_250, currency: 'AED' }); // no AED rate

    const { pnl } = await getMissionPnl(p, alphaOwner, msn);
    expect(pnl.blended).toBeNull();
    expect(pnl.missingRates).toEqual(['AED']);
  });
});

describe('S2 mission finance: payments, budgets, the financial lifecycle', () => {
  it('income payment walk Expected → Invoiced → Received (+detail), audited; expense lines refused', async () => {
    const msn = await newMission();
    const income = await addMissionLine(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', label: 'Prize', amountMinor: 1_000_000, currency: 'SAR' });
    expect(income.paymentStatus).toBe('Expected'); // born Expected
    const expense = await addMissionLine(p, alphaOps, msn, { direction: 'Expense', category: 'Travel', label: 'Flights', amountMinor: 1, currency: 'USD' });
    expect(expense.paymentStatus).toBeNull();

    const invoiced = await setMissionLinePayment(p, alphaOps, msn, income.lineId, { expectedVersion: income.version, paymentStatus: 'Invoiced' } as never);
    expect(invoiced.paymentStatus).toBe('Invoiced');

    const received = await setMissionLinePayment(p, alphaOwner, msn, income.lineId, {
      expectedVersion: invoiced.version,
      paymentStatus: 'Received',
      receivedAmountMinor: 950_000,
      receivedUsdPerUnit: 0.265,
      paymentSourceLabel: 'ESA',
      refNo: 'FT2501475Z6Z',
    } as never);
    expect(received).toMatchObject({ paymentStatus: 'Received', receivedAmountMinor: 950_000, paymentSourceLabel: 'ESA', refNo: 'FT2501475Z6Z' });

    // the P&L uses the received truth: amount 950,000 at the 0.265 snapshot
    const { pnl } = await getMissionPnl(p, alphaOwner, msn);
    expect(pnl.perCurrency.find((c) => c.currency === 'SAR')).toMatchObject({ incomeMinor: 950_000 });
    expect(pnl.settlement).toMatchObject({ outstandingIncomeCount: 0, incomeComplete: true });

    // an expense line has no payment state
    await expect(
      setMissionLinePayment(p, alphaOps, msn, expense.lineId, { expectedVersion: expense.version, paymentStatus: 'Received' } as never),
    ).rejects.toThrow(/income/i);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Mission', msn);
    expect(audit.filter((a) => a.action === 'MissionLinePaymentSet')).toHaveLength(2);
  });

  it('budget cells upsert / replace / clear, audited; the P&L derives the variance', async () => {
    const msn = await newMission();
    await addMissionLine(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', label: 'Prize', amountMinor: 1_000_000, currency: 'USD' });

    await setMissionBudget(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', currency: 'USD', amountMinor: 1_200_000 } as never);
    // upsert replaces, never duplicates
    await setMissionBudget(p, alphaOwner, msn, { direction: 'Income', category: 'PrizeMoney', currency: 'USD', amountMinor: 1_100_000 } as never);

    let view = await getMissionPnl(p, alphaOwner, msn);
    expect(view.budgets).toHaveLength(1);
    const row = view.pnl.perCategory.find((c) => c.category === 'PrizeMoney')!;
    expect(row).toMatchObject({ budgetUsdMinor: 1_100_000, actualUsdMinor: 1_000_000, varianceUsdMinor: -100_000 });

    // clearing removes the cell; clearing again is a quiet no-op
    await setMissionBudget(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', currency: 'USD', amountMinor: null } as never);
    view = await getMissionPnl(p, alphaOwner, msn);
    expect(view.budgets).toHaveLength(0);
    await setMissionBudget(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', currency: 'USD', amountMinor: null } as never);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Mission', msn);
    expect(audit.filter((a) => a.action === 'MissionBudgetSet')).toHaveLength(3); // set + replace + clear (the no-op clear is unaudited)
  });

  it('the finance stage walks forward one step at a time; Settled demands every income Received', async () => {
    const msn = await newMission();
    let m = (await p.reads.forActor(alphaOwner).getMissionById(msn))!;
    expect(m.financeStage).toBe('Planning'); // born Planning

    // skipping ahead is refused
    await expect(setMissionFinanceStage(p, alphaOps, msn, { expectedVersion: m.version, stage: 'Active' } as never)).rejects.toBeInstanceOf(ConflictError);

    for (const stage of ['FinancePending', 'Confirmed', 'Active', 'PostMission'] as const) {
      m = await setMissionFinanceStage(p, alphaOps, msn, { expectedVersion: m.version, stage } as never);
      expect(m.financeStage).toBe(stage);
    }

    // an outstanding income line blocks settlement
    const income = await addMissionLine(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', label: 'Prize', amountMinor: 1, currency: 'USD' });
    await expect(setMissionFinanceStage(p, alphaOps, msn, { expectedVersion: m.version, stage: 'Settled' } as never)).rejects.toThrow(/not yet Received/);

    await setMissionLinePayment(p, alphaOps, msn, income.lineId, { expectedVersion: income.version, paymentStatus: 'Received' } as never);
    m = await setMissionFinanceStage(p, alphaOwner, msn, { expectedVersion: m.version, stage: 'Settled' } as never);
    expect(m.financeStage).toBe('Settled');

    // Settled is terminal
    await expect(setMissionFinanceStage(p, alphaOwner, msn, { expectedVersion: m.version, stage: 'Settled' } as never)).rejects.toBeInstanceOf(ConflictError);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Mission', msn);
    expect(audit.filter((a) => a.action === 'MissionFinanceStageChanged')).toHaveLength(5);
  });

  it('the org-wide finance summary carries stage, blended profit and outstanding count per mission', async () => {
    const msn = await newMission();
    await createMission(p, alphaOps, { name: 'Second Cup', code: 'TR/2025/004', organizer: 'VSPN', city: 'Riyadh', gameTitle: null, startsOn: '2026-09-01', endsOn: null, notes: null } as never);
    const income = await addMissionLine(p, alphaOps, msn, { direction: 'Income', category: 'PrizeMoney', label: 'Prize', amountMinor: 1_000_000, currency: 'USD' });
    await addMissionLine(p, alphaOps, msn, { direction: 'Expense', category: 'Travel', label: 'Flights', amountMinor: 200_000, currency: 'USD' });

    let rows = await getMissionsFinanceSummary(p, alphaOwner);
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.missionId === msn)!;
    expect(first).toMatchObject({ outstandingIncomeCount: 1, blended: { profitUsdMinor: 800_000 } });
    const second = rows.find((r) => r.missionId !== msn)!;
    expect(second).toMatchObject({ code: 'TR/2025/004', organizer: 'VSPN', outstandingIncomeCount: 0 });

    await setMissionLinePayment(p, alphaOps, msn, income.lineId, { expectedVersion: income.version, paymentStatus: 'Received' } as never);
    rows = await getMissionsFinanceSummary(p, alphaOwner);
    expect(rows.find((r) => r.missionId === msn)!.outstandingIncomeCount).toBe(0);

    // the summary is financial data: legal/visitor are refused
    await expect(getMissionsFinanceSummary(p, alphaLegal)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('the tournament code is unique per tenant when present', async () => {
    await createMission(p, alphaOps, { name: 'A', code: 'SATR/2024/0001', organizer: null, city: null, gameTitle: null, startsOn: '2026-08-01', endsOn: null, notes: null } as never);
    await expect(
      createMission(p, alphaOps, { name: 'B', code: 'SATR/2024/0001', organizer: null, city: null, gameTitle: null, startsOn: '2026-08-01', endsOn: null, notes: null } as never),
    ).rejects.toThrow(); // partial unique index
    // bravo may reuse the same code (per-tenant uniqueness)
    await expect(
      createMission(p, bravoOwner, { name: 'C', code: 'SATR/2024/0001', organizer: null, city: null, gameTitle: null, startsOn: '2026-08-01', endsOn: null, notes: null } as never),
    ).resolves.toBeTruthy();
  });
});
