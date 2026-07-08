/**
 * missionOps — the Mission SHELL use-cases (Sprint 39). Pure DIRECT-BUT-AUDITED
 * CRUD in the Sprint-38 equipment mould: create / update (partial patch) /
 * deactivate, role-gated (canManageMissions: owner/operations — the deliberate
 * grant), version-guarded, audit in the SAME transaction, update audit images
 * restricted to exactly the changed fields.
 *
 * Participant membership is NOT here — it is governed (see
 * submitMissionParticipantOps + executeApproval).
 *
 * Date coherence: the boundary schema validates a patch that carries both
 * dates; a one-sided patch is validated here against the STORED row (and the
 * DB CHECK mission_dates_coherent backs everything).
 */
import {
  type Actor,
  type Mission,
  type MissionCreateInput,
  type MissionUpdateInput,
  missionCreateInputSchema,
  missionUpdateInputSchema,
  formatMissionId,
  ConcurrencyError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from '@c3web/domain';
import { assertManageMissions } from '@c3web/authz';
import type { MissionPatch, Persistence } from '../ports';

const EDITABLE = ['name', 'gameTitle', 'startsOn', 'endsOn', 'notes'] as const;

export async function createMission(p: Persistence, actor: Actor, input: MissionCreateInput): Promise<Mission> {
  assertManageMissions(actor);
  const parsed = missionCreateInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('mission');
    const missionId = formatMissionId(seq);
    const mission = await tx.insertMission(missionId, {
      name: parsed.name,
      gameTitle: parsed.gameTitle,
      startsOn: parsed.startsOn,
      endsOn: parsed.endsOn,
      notes: parsed.notes,
    });
    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionCreated',
      actor: actor.identity,
      before: null,
      after: { name: parsed.name, gameTitle: parsed.gameTitle, startsOn: parsed.startsOn, endsOn: parsed.endsOn },
    });
    return mission;
  });
}

export async function updateMission(
  p: Persistence,
  actor: Actor,
  missionId: string,
  input: MissionUpdateInput,
): Promise<Mission> {
  assertManageMissions(actor);
  const parsed = missionUpdateInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getMission(missionId);
    if (!current) throw new NotFoundError('Mission', missionId);

    // Final date coherence against the stored row (the boundary cannot see it).
    const effectiveStart = parsed.startsOn ?? current.startsOn;
    const effectiveEnd = 'endsOn' in parsed && parsed.endsOn !== undefined ? parsed.endsOn : current.endsOn;
    if (effectiveEnd !== null && effectiveEnd < effectiveStart) {
      throw new ValidationError('End date must be on or after the start date.', {
        startsOn: effectiveStart,
        endsOn: effectiveEnd,
      });
    }

    // Build the patch from exactly the provided keys; capture honest
    // before/after images of the fields that actually change.
    const patch: Record<string, unknown> = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (key in parsed && parsed[key] !== undefined) {
        const next = parsed[key] as unknown;
        const prev = (current as unknown as Record<string, unknown>)[key] ?? null;
        if (next !== prev) {
          patch[key] = next;
          before[key] = prev;
          after[key] = next;
        }
      }
    }
    if (Object.keys(patch).length === 0) return current; // no-op patch: nothing changed

    const updated = await tx.updateMission(missionId, parsed.expectedVersion, patch as MissionPatch);
    if (!updated) throw new ConcurrencyError('Mission', missionId);

    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionUpdated',
      actor: actor.identity,
      before,
      after,
    });
    return updated;
  });
}

export async function deactivateMission(
  p: Persistence,
  actor: Actor,
  missionId: string,
  expectedVersion: number,
): Promise<Mission> {
  assertManageMissions(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getMission(missionId);
    if (!current) throw new NotFoundError('Mission', missionId);
    if (!current.isActive) throw new ConflictError('The mission is already inactive.');

    const updated = await tx.deactivateMission(missionId, expectedVersion);
    if (!updated) throw new ConcurrencyError('Mission', missionId);

    // Participant rows are deliberately untouched: they are historical
    // membership facts. Governed removal remains available afterwards.
    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: missionId,
      action: 'MissionDeactivated',
      actor: actor.identity,
      before: { isActive: true },
      after: { isActive: false },
    });
    return updated;
  });
}
