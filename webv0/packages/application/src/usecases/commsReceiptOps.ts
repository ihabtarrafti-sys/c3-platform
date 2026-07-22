/**
 * commsReceiptOps — receipts, the Battle-#1 mechanism: DERIVED from the private
 * cursor + the receipts_enabled_since watermark, never per-read shared rows.
 *
 * SELF-SCOPED writes: a user advances their OWN cursor and flips their OWN
 * prefs — no route or use-case takes a target user; the actor IS the subject.
 *
 * THE PRIVACY CONTRACT: "read by X" is disclosed iff X's receipts are enabled
 * AND X's cursor moved at/after X's receipts_enabled_since. Disabling stops
 * disclosure (the cursor still advances — your own unread keeps working);
 * re-enabling stamps a fresh watermark, so reading done while OFF is never
 * retroactively disclosed. Missing pref row = enabled since forever (the
 * lock-time ruling: ON by default, per-user disable).
 *
 * LAPSE: cursor advance and prefs stay available (reading your own record and
 * controlling your own privacy survive a lapsed license — Temper §246); only
 * never-entitled 404s.
 */
import {
  type Actor,
  type AdvanceCommsCursorInput,
  type CommsCursor,
  type CommsPrefs,
  type CommsReceipt,
  type SetCommsPrefsInput,
  advanceCommsCursorInputSchema,
  COMMS_MODULE_KEY,
  ConcurrencyError,
  NotFoundError,
  setCommsPrefsInputSchema,
  ValidationError,
} from '@c3web/domain';
import { assertReadPeople } from '@c3web/authz';
import type { Persistence } from '../ports';

/** Shared prologue: license present (404 otherwise) + the mission thread gate. */
async function requireMissionThread(p: Persistence, actor: Actor, missionId: string) {
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Mission', missionId);
  assertReadPeople(actor);
  const mission = await reads.getMissionById(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);
  const thread = await reads.getCommsThreadByAnchor('Mission', missionId);
  return { reads, thread };
}

/** Advance the caller's OWN cursor (monotonic; a no-advance call is a no-op). */
export async function advanceMissionCursor(
  p: Persistence,
  actor: Actor,
  missionId: string,
  input: AdvanceCommsCursorInput,
): Promise<CommsCursor> {
  const parsed = advanceCommsCursorInputSchema.parse(input);
  const { thread } = await requireMissionThread(p, actor, missionId);
  if (!thread) throw new NotFoundError('Mission', missionId); // nothing to read yet
  if (parsed.seq > thread.lastSeq) {
    throw new ValidationError('The read position is beyond the thread.', { seq: parsed.seq, lastSeq: thread.lastSeq });
  }
  return p.writes.transaction(actor, (tx) => tx.upsertCommsInboxCursor(thread.threadId, actor.userId, parsed.seq));
}

/** The thread's DISCLOSED receipts (the watermark predicate lives in the store). */
export async function getMissionReceipts(p: Persistence, actor: Actor, missionId: string): Promise<CommsReceipt[]> {
  const { reads, thread } = await requireMissionThread(p, actor, missionId);
  if (!thread) return [];
  return reads.listDisclosedCommsReceipts(thread.threadId);
}

/** The caller's own prefs (missing row = the defaults, version null). */
export async function getCommsPrefs(p: Persistence, actor: Actor): Promise<CommsPrefs> {
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Comms', 'preferences');
  const row = await reads.getCommsUserPreference(actor.userId);
  if (!row) return { receiptsEnabled: true, presenceEnabled: true, version: null };
  return { receiptsEnabled: row.receiptsEnabled, presenceEnabled: row.presenceEnabled, version: row.version };
}

/**
 * Self-only, expected-version prefs write (the 0037 three-way CAS shape).
 * A receipts false→true transition stamps receipts_enabled_since = now().
 */
export async function setCommsPrefs(p: Persistence, actor: Actor, input: SetCommsPrefsInput): Promise<CommsPrefs> {
  const parsed = setCommsPrefsInputSchema.parse(input);
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Comms', 'preferences');

  const current = await reads.getCommsUserPreference(actor.userId);
  const result = await p.writes.transaction(actor, async (tx) => {
    if (!current) {
      if (parsed.expectedVersion !== null) throw new ConcurrencyError('CommsPrefs', actor.userId);
      // First row: the defaults were "enabled since forever" — creating a row
      // that KEEPS receipts on stamps nothing; creating one that turns them off
      // stamps nothing either (the later re-enable stamps the watermark).
      const inserted = await tx.insertCommsUserPreference({
        userId: actor.userId,
        receiptsEnabled: parsed.receiptsEnabled,
        presenceEnabled: parsed.presenceEnabled,
        receiptsEnabledSince: null,
      });
      if (!inserted) throw new ConcurrencyError('CommsPrefs', actor.userId); // a concurrent creator won
      return inserted;
    }
    if (parsed.expectedVersion === null) throw new ConcurrencyError('CommsPrefs', actor.userId);
    const updated = await tx.updateCommsUserPreference(actor.userId, parsed.expectedVersion, {
      receiptsEnabled: parsed.receiptsEnabled,
      presenceEnabled: parsed.presenceEnabled,
      // The watermark stamps ONLY on the false→true transition.
      stampReceiptsSince: !current.receiptsEnabled && parsed.receiptsEnabled,
    });
    if (!updated) throw new ConcurrencyError('CommsPrefs', actor.userId);
    return updated;
  });

  return { receiptsEnabled: parsed.receiptsEnabled, presenceEnabled: parsed.presenceEnabled, version: result.version };
}
