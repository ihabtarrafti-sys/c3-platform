/**
 * missionPnlOps — mission income/expense lines, payments, budgets, the
 * financial lifecycle, and the P&L reads (Finance Sprint 4, upgraded by S2
 * Mission Finance).
 *
 * Lines/payments/budgets are DIRECT-BUT-AUDITED (they RECORD operational
 * facts — prize money landing, flights paid, a budget planned — unlike
 * agreement terms, which are commitments and governed). Writes require
 * canManageMissions AND canViewFinancials (belt-and-braces); every write is
 * version-guarded (budgets are upsert-keyed) and audited in the SAME
 * transaction on the owning Mission's trail. Money writes attach only to an
 * ACTIVE mission (a retired shell is frozen record).
 *
 * The FINANCE STAGE walks Planning → FinancePending → Confirmed → Active →
 * PostMission → Settled, one forward step at a time; →Settled REQUIRES
 * settlement completeness (every income line Received) — checked in-tx.
 *
 * The P&L read assembles lines + budgets + roster per-diems + the FX table
 * into the PURE domain derivation (computeMissionPnl) — nothing computed is
 * stored, and the whole surface is gated to canViewFinancials. The
 * all-missions FINANCE SUMMARY (the org-wide dashboard) derives the same
 * truth per mission in one pass.
 */
import {
  type Actor,
  type Mission,
  type MissionFinanceStage,
  type MissionFinanceStageInput,
  type MissionLine,
  type MissionBudget,
  type MissionLineCreateInput,
  type MissionLineUpdateInput,
  type MissionLinePaymentInput,
  type MissionPnl,
  type SetMissionBudgetInput,
  computeMissionPnl,
  missionFinanceStageInputSchema,
  missionLineCreateInputSchema,
  missionLineUpdateInputSchema,
  missionLinePaymentInputSchema,
  nextMissionFinanceStage,
  setMissionBudgetInputSchema,
  ConcurrencyError,
  ConflictError,
  formatMissionLineId,
  NotFoundError,
  ValidationError,
} from '@c3web/domain';
import { assertManageMissions, assertReadPeople, assertViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

export interface MissionPnlView {
  readonly lines: MissionLine[];
  readonly budgets: MissionBudget[];
  readonly pnl: MissionPnl;
}

/** The mission's P&L: lines + budgets + per-diem roll-in + USD blend (canViewFinancials). */
export async function getMissionPnl(p: Persistence, actor: Actor, missionId: string): Promise<MissionPnlView> {
  assertReadPeople(actor);
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);
  const mission = await reads.getMissionById(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);

  const [lines, budgets, participants, rates] = await Promise.all([
    reads.listMissionLines(missionId),
    reads.listMissionBudgets(missionId),
    reads.listMissionParticipants(missionId),
    reads.listFxRates(),
  ]);
  const pnl = computeMissionPnl({ startsOn: mission.startsOn, endsOn: mission.endsOn, lines, budgets, participants, rates });
  return { lines, budgets, pnl };
}

/** One mission's row on the org-wide finance dashboard. */
export interface MissionFinanceSummaryRow {
  readonly missionId: string;
  readonly name: string;
  readonly code: string | null;
  readonly organizer: string | null;
  readonly financeStage: MissionFinanceStage;
  readonly isActive: boolean;
  readonly startsOn: string;
  readonly endsOn: string | null;
  readonly outstandingIncomeCount: number;
  readonly blended: MissionPnl['blended'];
  readonly missingRates: MissionPnl['missingRates'];
}

/** S2: the all-missions finance dashboard — every mission's money, one pass. */
export async function getMissionsFinanceSummary(p: Persistence, actor: Actor): Promise<MissionFinanceSummaryRow[]> {
  assertReadPeople(actor);
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);
  const [missions, allLines, allBudgets, allParticipants, rates] = await Promise.all([
    reads.listMissions(),
    reads.listAllMissionLines(),
    reads.listAllMissionBudgets(),
    reads.listAllMissionParticipants(),
    reads.listFxRates(),
  ]);

  // The bulk participant read is slim (no per-diem); per-diem roll-in on the
  // DASHBOARD would need a joined bulk read — deliberately kept out of the
  // summary (each mission's own P&L page carries the full truth). Summary rows
  // therefore blend LINES + BUDGET-less: lines only. Honest and cheap; the
  // per-mission page is one click away.
  void allParticipants;

  return missions.map((m) => {
    const lines = allLines.filter((l) => l.missionId === m.missionId);
    const budgets = allBudgets.filter((b) => b.missionId === m.missionId);
    const pnl = computeMissionPnl({ startsOn: m.startsOn, endsOn: m.endsOn, lines, budgets, participants: [], rates });
    return {
      missionId: m.missionId,
      name: m.name,
      code: m.code,
      organizer: m.organizer,
      financeStage: m.financeStage,
      isActive: m.isActive,
      startsOn: m.startsOn,
      endsOn: m.endsOn,
      outstandingIncomeCount: pnl.settlement.outstandingIncomeCount,
      blended: pnl.blended,
      missingRates: pnl.missingRates,
    };
  });
}

/** Shared write guard: the owning mission must exist and be ACTIVE. */
async function requireActiveMission(tx: { getMission(id: string): Promise<Mission | null> }, missionId: string): Promise<Mission> {
  const mission = await tx.getMission(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);
  if (!mission.isActive) {
    throw new ConflictError('P&L records may only be changed on an active mission.', { missionId });
  }
  return mission;
}

/** Add an income/expense line (owner/operations, direct-audited). */
export async function addMissionLine(
  p: Persistence,
  actor: Actor,
  missionId: string,
  input: MissionLineCreateInput,
): Promise<MissionLine> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const parsed = missionLineCreateInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    await requireActiveMission(tx, missionId);
    const seq = await tx.allocateSequence('missionLine');
    const lineId = formatMissionLineId(seq);
    const line = await tx.insertMissionLine({
      lineId,
      missionId,
      ...parsed,
      // Income is born Expected (the mastersheet truth); expenses carry none.
      paymentStatus: parsed.direction === 'Income' ? 'Expected' : null,
    });

    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionLineAdded',
      actor: actor.identity,
      before: null,
      after: { lineId, direction: parsed.direction, category: parsed.category, label: parsed.label, amountMinor: parsed.amountMinor, currency: parsed.currency },
    });
    return line;
  });
}

/** Patch a line's label/amount/currency (direction+category immutable), version-guarded + audited. */
export async function updateMissionLine(
  p: Persistence,
  actor: Actor,
  missionId: string,
  lineId: string,
  input: MissionLineUpdateInput,
): Promise<MissionLine> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const parsed = missionLineUpdateInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getMissionLine(lineId);
    if (!current || current.missionId !== missionId) throw new NotFoundError('Mission line', lineId);
    await requireActiveMission(tx, missionId);

    // Changed-fields-only patch + honest before/after images (the direct-audited convention).
    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of ['label', 'amountMinor', 'currency'] as const) {
      if (key in parsed && parsed[key] !== undefined && parsed[key] !== current[key]) {
        patch[key] = parsed[key];
        before[key] = current[key];
        after[key] = parsed[key];
      }
    }
    if (Object.keys(patch).length === 0) return current; // no-op patch: nothing changed

    const updated = await tx.updateMissionLine(lineId, parsed.expectedVersion, patch);
    if (!updated) throw new ConcurrencyError('Mission line', lineId);

    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionLineUpdated',
      actor: actor.identity,
      before: { lineId, ...before },
      after: { lineId, ...after },
    });
    return updated;
  });
}

/** Soft-remove a line (owner/operations), version-guarded + audited. */
export async function removeMissionLine(
  p: Persistence,
  actor: Actor,
  missionId: string,
  lineId: string,
  expectedVersion: number,
): Promise<MissionLine> {
  assertManageMissions(actor);
  assertViewFinancials(actor);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getMissionLine(lineId);
    if (!current || current.missionId !== missionId) throw new NotFoundError('Mission line', lineId);
    await requireActiveMission(tx, missionId);

    const removed = await tx.deactivateMissionLine(lineId, expectedVersion);
    if (!removed) throw new ConcurrencyError('Mission line', lineId);

    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionLineRemoved',
      actor: actor.identity,
      before: { lineId, direction: current.direction, category: current.category, label: current.label, amountMinor: current.amountMinor, currency: current.currency },
      after: { lineId, isActive: false },
    });
    return removed;
  });
}

/**
 * S2: set an INCOME line's payment state (Expected → Invoiced → Received —
 * corrections legal, the trail is the truth). Received may carry the received
 * amount, the FX snapshot at receipt, a bank/payment-source LABEL, and the
 * external reference. Expense lines have no payment state (DB CHECK).
 */
export async function setMissionLinePayment(
  p: Persistence,
  actor: Actor,
  missionId: string,
  lineId: string,
  input: MissionLinePaymentInput,
): Promise<MissionLine> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const parsed = missionLinePaymentInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getMissionLine(lineId);
    if (!current || current.missionId !== missionId) throw new NotFoundError('Mission line', lineId);
    if (current.direction !== 'Income') {
      throw new ValidationError('Payment tracking applies to income lines only.', { lineId });
    }
    await requireActiveMission(tx, missionId);

    const updated = await tx.setMissionLinePayment(lineId, parsed.expectedVersion, {
      paymentStatus: parsed.paymentStatus,
      receivedAmountMinor: parsed.receivedAmountMinor,
      receivedUsdPerUnit: parsed.receivedUsdPerUnit,
      paymentSourceLabel: parsed.paymentSourceLabel,
      refNo: parsed.refNo,
    });
    if (!updated) throw new ConcurrencyError('Mission line', lineId);

    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionLinePaymentSet',
      actor: actor.identity,
      before: {
        lineId,
        paymentStatus: current.paymentStatus,
        receivedAmountMinor: current.receivedAmountMinor,
        paymentSourceLabel: current.paymentSourceLabel,
        refNo: current.refNo,
      },
      after: {
        lineId,
        paymentStatus: parsed.paymentStatus,
        receivedAmountMinor: parsed.receivedAmountMinor,
        receivedUsdPerUnit: parsed.receivedUsdPerUnit,
        paymentSourceLabel: parsed.paymentSourceLabel,
        refNo: parsed.refNo,
      },
    });
    return updated;
  });
}

/**
 * S2: set (or clear, amountMinor=null) one budget cell — per (direction,
 * category, currency), the FX-rate upsert posture. Budgets are planning state:
 * the AUDIT EVENT is the history; a cleared cell is deleted.
 */
export async function setMissionBudget(
  p: Persistence,
  actor: Actor,
  missionId: string,
  input: SetMissionBudgetInput,
): Promise<MissionBudget | null> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const parsed = setMissionBudgetInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    await requireActiveMission(tx, missionId);

    if (parsed.amountMinor === null) {
      const existed = await tx.deleteMissionBudget(missionId, parsed.direction, parsed.category, parsed.currency);
      if (!existed) return null; // clearing a non-existent cell is a no-op, not an error
      await tx.appendAuditEvent({
        entityType: 'Mission',
        entityId: missionId,
        action: 'MissionBudgetSet',
        actor: actor.identity,
        before: { direction: parsed.direction, category: parsed.category, currency: parsed.currency },
        after: { direction: parsed.direction, category: parsed.category, currency: parsed.currency, amountMinor: null },
      });
      return null;
    }

    const budget = await tx.upsertMissionBudget(missionId, parsed.direction, parsed.category, parsed.currency, parsed.amountMinor);
    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionBudgetSet',
      actor: actor.identity,
      before: null,
      after: { direction: parsed.direction, category: parsed.category, currency: parsed.currency, amountMinor: parsed.amountMinor },
    });
    return budget;
  });
}

/**
 * S2: advance the mission's FINANCE STAGE — one forward step at a time
 * (Planning → FinancePending → Confirmed → Active → PostMission → Settled).
 * →Settled REQUIRES settlement completeness: every income line Received.
 */
export async function setMissionFinanceStage(
  p: Persistence,
  actor: Actor,
  missionId: string,
  input: MissionFinanceStageInput,
): Promise<Mission> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const parsed = missionFinanceStageInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    const current = await requireActiveMission(tx, missionId);

    const legal = nextMissionFinanceStage(current.financeStage);
    if (parsed.stage !== legal) {
      throw new ConflictError(
        legal === null
          ? 'The mission is Settled — its financial lifecycle is complete.'
          : `The only legal next stage is ${legal}.`,
        { missionId, from: current.financeStage, requested: parsed.stage },
      );
    }

    if (parsed.stage === 'Settled') {
      const lines = await p.reads.forActor(actor).listMissionLines(missionId);
      const outstanding = lines.filter((l) => l.direction === 'Income' && l.paymentStatus !== 'Received').length;
      if (outstanding > 0) {
        throw new ConflictError(`Cannot settle: ${outstanding} income line${outstanding === 1 ? '' : 's'} not yet Received.`, {
          missionId,
          outstanding,
        });
      }
    }

    const updated = await tx.setMissionFinanceStage(missionId, parsed.expectedVersion, parsed.stage);
    if (!updated) throw new ConcurrencyError('Mission', missionId);

    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionFinanceStageChanged',
      actor: actor.identity,
      before: { financeStage: current.financeStage },
      after: { financeStage: parsed.stage },
    });
    return updated;
  });
}
