/**
 * commsTransclusion.ts — Phase C: the message stores a REFERENCE, never a copy.
 *
 * THE ARGUMENT: a pasted roster or per-diem table is two lies waiting to
 * happen. It outlives the reader's standing (anyone who can read the thread
 * now reads a table they were never entitled to) and it stops being true the
 * moment the record moves. A transcluded block is neither: it resolves for
 * THIS viewer, at THIS render, under THEIR capabilities.
 *
 * ⛔ DENIAL RENDERS AS DENIAL (instance 21 / the six-state contract): when the
 * viewer lacks the capability the block says so, with its reason class. It is
 * never an empty table and never the numbers.
 *
 * ⛔ THE VOCABULARY IS CLOSED — `roster`, `perdiem`. No generic query language:
 * that would be a disclosure surface wearing a feature's clothes. Each new
 * kind must arrive with its own capability mapping, deliberately.
 *
 * ⚠️ RESOLUTION LIVES AT THE READ BOUNDARY, not inside one route. The battle
 * demo resolved blocks in a single reader and the mission route shipped none —
 * a feature that existed on one screen and silently didn't on another.
 */
import { type Actor, type CommsMessageView, type TransclusionBlockView, formatMoney, type CurrencyCode } from '@c3web/domain';
import { canViewPerDiem } from '@c3web/authz';
import type { ReadStore } from '../ports';

/** `{{kind:MSN-xxxx}}` — the closed vocabulary, anchored to a mission. */
const TRANSCLUSION_RE = /\{\{(perdiem|roster):(MSN-\d{4,})\}\}/g;

/**
 * Resolve every message's blocks for ONE viewer. Called from the read boundary
 * so every consumer of a thread gets the same treatment — the mission thread,
 * rooms, DMs, and anything later.
 */
export async function resolveTransclusions(
  reads: ReadStore,
  actor: Actor,
  messages: CommsMessageView[],
): Promise<CommsMessageView[]> {
  const out: CommsMessageView[] = [];
  for (const m of messages) {
    // A recalled message has no body to scan — and must never regain one.
    if (m.recalled !== undefined) {
      out.push(m);
      continue;
    }
    const blocks: TransclusionBlockView[] = [];
    for (const match of m.body.matchAll(TRANSCLUSION_RE)) {
      const [, rawKind, anchorId] = match;
      if (!rawKind || !anchorId) continue;
      blocks.push(await resolveOne(reads, actor, rawKind as 'perdiem' | 'roster', anchorId));
    }
    out.push(blocks.length > 0 ? { ...m, blocks } : m);
  }
  return out;
}

async function resolveOne(
  reads: ReadStore,
  actor: Actor,
  kind: 'perdiem' | 'roster',
  anchorId: string,
): Promise<TransclusionBlockView> {
  const mission = await reads.getMissionById(anchorId);
  if (!mission) {
    // Absence of standing and absence of the record are the SAME answer here —
    // the block must not become an existence oracle for missions.
    return {
      kind,
      anchorId,
      state: 'denied',
      title: anchorId,
      deniedReason: 'That record is not visible to you.',
    };
  }
  const roster = await reads.listMissionParticipants(anchorId);

  if (kind === 'roster') {
    return {
      kind,
      anchorId,
      state: 'rendered',
      title: `${mission.name} — roster, as of now`,
      rows: roster.filter((r) => r.isActive).map((r) => ({ label: r.personName ?? r.personId, value: r.role })),
    };
  }

  // per-diem is capability-gated (F18's own contract), and the denial is NAMED.
  if (!canViewPerDiem(actor.role)) {
    return {
      kind,
      anchorId,
      state: 'denied',
      title: `${mission.name} — per-diem`,
      deniedReason: `Per-diem amounts are not visible to the ${actor.role} role. This is a denial, not an empty table.`,
    };
  }
  return {
    kind,
    anchorId,
    state: 'rendered',
    title: `${mission.name} — per-diem, live`,
    rows: roster
      .filter((r) => r.isActive && r.perDiemAmountMinor !== null)
      .map((r) => ({
        label: r.personName ?? r.personId,
        value: formatMoney(r.perDiemAmountMinor as number, (r.perDiemCurrency ?? 'USD') as CurrencyCode),
      })),
  };
}
