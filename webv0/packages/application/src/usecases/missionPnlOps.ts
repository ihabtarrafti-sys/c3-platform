/**
 * missionPnlOps — mission income/expense lines and the P&L read
 * (Finance Sprint 4).
 *
 * Lines are DIRECT-BUT-AUDITED (the per-diem/mission-shell posture): they
 * RECORD operational facts — prize money received, flights paid — unlike
 * agreement terms, which are commitments to people and therefore governed
 * (S3.5). Writes require canManageMissions AND canViewFinancials
 * (belt-and-braces: money detail should never be writable by a role that
 * cannot see it); every write is version-guarded and audited in the SAME
 * transaction, on the owning Mission's audit trail. Lines attach only to an
 * ACTIVE mission (a retired shell is frozen record). Direction is immutable.
 *
 * The P&L read assembles lines + roster per-diems + the FX table and hands
 * them to the PURE domain derivation (computeMissionPnl) — nothing computed is
 * stored, and the whole surface is gated to canViewFinancials (section-level
 * denial: legal/hr/visitor never see mission money).
 */
import {
  type Actor,
  type Mission,
  type MissionLine,
  type MissionLineCreateInput,
  type MissionLineUpdateInput,
  type MissionPnl,
  computeMissionPnl,
  missionLineCreateInputSchema,
  missionLineUpdateInputSchema,
  ConcurrencyError,
  ConflictError,
  formatMissionLineId,
  NotFoundError,
} from '@c3web/domain';
import { assertManageMissions, assertReadPeople, assertViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

export interface MissionPnlView {
  readonly lines: MissionLine[];
  readonly pnl: MissionPnl;
}

/** The mission's P&L: lines + per-diem roll-in + USD blend (canViewFinancials). */
export async function getMissionPnl(p: Persistence, actor: Actor, missionId: string): Promise<MissionPnlView> {
  assertReadPeople(actor);
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);
  const mission = await reads.getMissionById(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);

  const [lines, participants, rates] = await Promise.all([
    reads.listMissionLines(missionId),
    reads.listMissionParticipants(missionId),
    reads.listFxRates(),
  ]);
  const pnl = computeMissionPnl({ startsOn: mission.startsOn, endsOn: mission.endsOn, lines, participants, rates });
  return { lines, pnl };
}

/** Shared write guard: the line's owning mission must exist and be ACTIVE. */
async function requireActiveMission(tx: { getMission(id: string): Promise<Mission | null> }, missionId: string): Promise<Mission> {
  const mission = await tx.getMission(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);
  if (!mission.isActive) {
    throw new ConflictError('P&L lines may only be changed on an active mission.', { missionId });
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
    const line = await tx.insertMissionLine({ lineId, missionId, ...parsed });

    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionLineAdded',
      actor: actor.identity,
      before: null,
      after: { lineId, direction: parsed.direction, label: parsed.label, amountMinor: parsed.amountMinor, currency: parsed.currency },
    });
    return line;
  });
}

/** Patch a line's label/amount/currency (direction immutable), version-guarded + audited. */
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
      before: { lineId, direction: current.direction, label: current.label, amountMinor: current.amountMinor, currency: current.currency },
      after: { lineId, isActive: false },
    });
    return removed;
  });
}
