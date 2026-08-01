/**
 * commsSpaceOps — Phase B: ACTIVATION. The dormant 0090 spine (direct +
 * standing kinds, participants, the event vocabulary) gets its first lawful
 * writers and readers, under the SAME laws the mission slice practices.
 *
 * Boundaries held by construction:
 *  - The Heads' Table is v1's ONE private class: owner/ops CREATE it; its
 *    ADMIN seats manage membership using the EXISTING owner/ops members
 *    surface (room membership never drew on a new projection).
 *  - B8 (owner-ruled 2026-07-30): the comms ADDRESSABLE directory is its own
 *    narrower read — {userId, displayName, roleClass}, email dropped in SQL —
 *    and it grants ADDRESSABILITY only. Visibility is unchanged: the per-kind
 *    gate below still denies an acquired link.
 *  - Membership changes append 0090's OWN event vocabulary in the SAME tx
 *    (ParticipantAdded/Removed) — the room log is the room's history.
 *    Audit-CHANNEL rows deliberately do NOT ship here: N-2's comms scope is
 *    Neural's open ruling; the append-only thread events are the record.
 *  - DMs: one per member set (0090's hash unique resolves races); retention
 *    is MANDATORY and stamped on every message insert (a DM is a
 *    conversation, not an archive).
 *  - The attention ledger reads are me-predicated at the SQL layer: no
 *    org-wide variant exists (Guardrail Zero as storage/read design).
 *  - The recall lane is untouched: every read here goes through the same
 *    tombstone-joined spine.
 */
import { createHash } from 'node:crypto';
import {
  type Actor,
  type CommsMessageView,
  type CommsThread,
  type PostCommsMessageInput,
  COMMS_MODULE_KEY,
  COMMS_MESSAGES_PAGE_MAX,
  formatMessageId,
  formatThreadId,
  ForbiddenError,
  ModuleReadOnlyError,
  NotFoundError,
  ValidationError,
  postCommsMessageInputSchema,
} from '@c3web/domain';
import { canManageMissions } from '@c3web/authz';
import type {
  CommsThreadEventView,
  CommsThreadParticipantView,
  MyCommsThreadRow,
  MyObligationPartyRow,
  Persistence,
} from '../ports';
import { assertSupersessionIsLawful, assertViewCommsThread, isEntitlementWritable } from './commsOps';
import { resolveTransclusions } from './commsTransclusion';

/** 0090's CHECK allows 30–365; the ruled v1 default. Owner-tunable later. */
export const DIRECT_RETENTION_DAYS = 90;

export interface ThreadRoomView {
  readonly thread: CommsThread;
  readonly messages: CommsMessageView[];
  readonly myLastReadSeq: number | null;
  readonly participants: CommsThreadParticipantView[];
  readonly events: CommsThreadEventView[];
  readonly retentionDays: number | null;
}

/** The generalized room read: DMs and standing rooms through the ONE gate. */
export async function getThreadRoom(
  p: Persistence,
  actor: Actor,
  threadId: string,
  page?: { limit?: number; beforeSeq?: number | null },
): Promise<ThreadRoomView> {
  const reads = p.reads.forActor(actor);
  const conceal = new NotFoundError('Thread', threadId);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw conceal;
  const thread = await reads.getCommsThreadByThreadId(threadId);
  if (!thread) throw conceal;
  await assertViewCommsThread(reads, actor, thread);

  const limit = Math.min(Math.max(page?.limit ?? 50, 1), COMMS_MESSAGES_PAGE_MAX);
  const raw = await reads.listCommsMessages(thread.threadId, limit, page?.beforeSeq ?? null);
  const messages = await resolveTransclusions(reads, actor, raw);
  const myCursor = await reads.getCommsInboxCursor(thread.threadId, actor.userId);
  const participants = thread.kind === 'anchored' ? [] : await reads.listCommsThreadParticipants(thread.threadId);
  const events = thread.kind === 'anchored' ? [] : await reads.listCommsThreadEvents(thread.threadId);
  return {
    thread,
    messages,
    myLastReadSeq: myCursor?.lastReadSeq ?? null,
    participants,
    events,
    retentionDays: thread.kind === 'direct' ? DIRECT_RETENTION_DAYS : null,
  };
}

/**
 * Post to a room or DM — the mission slice's write discipline (idempotent
 * replay, seq bump under row lock, revision-1 body) carried to the activated
 * kinds; direct messages get retention stamped ON the insert (the spine is
 * INSERT-only by grants — retention rides the insert or not at all).
 */
export async function postThreadMessage(
  p: Persistence,
  actor: Actor,
  threadId: string,
  input: PostCommsMessageInput,
): Promise<CommsMessageView> {
  const parsed = postCommsMessageInputSchema.parse(input);
  const reads = p.reads.forActor(actor);
  const conceal = new NotFoundError('Thread', threadId);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw conceal;
  const thread = await reads.getCommsThreadByThreadId(threadId);
  if (!thread) throw conceal;
  await assertViewCommsThread(reads, actor, thread); // write ⊇ read (D2)
  if (!isEntitlementWritable(ent)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);

  await assertSupersessionIsLawful(reads, parsed.supersedesMessageId, threadId);

  const replay = await reads.getCommsMessageByMutation(actor.userId, parsed.clientMutationId);
  if (replay) return replay;

  await p.writes.transaction(actor, async (tx) => {
    const nextSeq = await tx.bumpCommsThreadSeq(threadId);
    if (nextSeq === null) throw conceal;
    const messageId = formatMessageId(await tx.allocateSequence('message'));
    const inserted = await tx.insertCommsMessage({
      messageId,
      threadId,
      seq: nextSeq,
      authorUserId: actor.userId,
      authorLabel: actor.displayName,
      clientMutationId: parsed.clientMutationId,
      retentionDays: thread.kind === 'direct' ? DIRECT_RETENTION_DAYS : null,
      // Phase C: decision records live in rooms and DMs too — one law for every
      // thread kind (the kind is fixed at post time; the spine is INSERT-only).
      messageKind: parsed.messageKind,
      supersedesMessageId: parsed.supersedesMessageId,
    });
    if (!inserted) return; // duplicate send: the replay read below returns the winner
    const revisionId = await tx.insertCommsMessageRevision({
      messageId,
      revisionNo: 1,
      body: parsed.body,
      editorUserId: actor.userId,
      editorLabel: actor.displayName,
      reason: null,
    });
    for (const link of parsed.links) {
      await tx.insertCommsObjectLink({ revisionId, targetType: link.targetType, targetId: link.targetId });
    }
    // Phase B-LIVE: publish IN-TX (see commsOps) — rooms and DMs alike.
    await tx.publishCommsLiveEvent({ threadId, messageId, seq: nextSeq });
  });

  const view = await reads.getCommsMessageByMutation(actor.userId, parsed.clientMutationId);
  if (!view) throw new NotFoundError('Message', parsed.clientMutationId);
  return view;
}

/**
 * Find-or-create the ONE direct thread for {me, other} — 0090's
 * direct_set_hash partial unique made load-bearing (concurrent creators
 * converge: the loser's insert no-ops and re-reads the winner).
 */
export async function openDirectThread(p: Persistence, actor: Actor, otherUserId: string): Promise<CommsThread> {
  const reads = p.reads.forActor(actor);
  const conceal = new NotFoundError('Thread', 'direct');
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw conceal;
  if (otherUserId === actor.userId) throw new ValidationError('A direct thread needs a second member.');
  // Class-B guard: the target must be someone this tenant may address. Checked
  // BEFORE the direct_set_hash is computed, so a foreign id cannot even mint the
  // identity of a thread. See assertAddressableInTenant.
  await assertAddressableInTenant(p, actor, otherUserId);
  const pair = [actor.userId, otherUserId].sort();
  const hash = createHash('sha256').update(pair.join('|')).digest('hex');

  const existing = await reads.getCommsThreadByDirectHash(hash);
  if (existing) return existing;
  if (!isEntitlementWritable(ent)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);

  const created = await p.writes.transaction(actor, async (tx) => {
    const inserted = await tx.insertCommsThreadDormantKind({
      threadId: formatThreadId(await tx.allocateSequence('thread')),
      kind: 'direct',
      directSetHash: hash,
      directRetentionDays: DIRECT_RETENTION_DAYS,
      createdByUserId: actor.userId,
      createdByLabel: actor.displayName,
    });
    if (inserted) {
      for (const userId of pair) {
        await tx.upsertCommsThreadParticipant({ threadId: inserted.threadId, userId, role: 'member' });
      }
      await tx.insertCommsThreadEvent({
        threadId: inserted.threadId,
        eventType: 'Created',
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
      });
    }
    return inserted;
  });
  if (created) return created;
  const winner = await reads.getCommsThreadByDirectHash(hash);
  if (!winner) throw conceal;
  return winner;
}

/**
 * Create the Heads' Table — v1's ONE private class. Owner/operations create
 * (org-significant standing reuses the existing mission-management authority,
 * never a new role); the creator takes the ADMIN seat.
 */
export async function createStandingRoom(p: Persistence, actor: Actor, title: string): Promise<CommsThread> {
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Thread', 'room');
  if (!canManageMissions(actor.role)) {
    throw new ForbiddenError('Standing rooms are created by operational roles.', {});
  }
  if (!isEntitlementWritable(ent)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);
  const trimmed = title.trim();
  if (trimmed.length === 0 || trimmed.length > 120) throw new ValidationError('A room needs a name (≤120 chars).');

  const created = await p.writes.transaction(actor, async (tx) => {
    const inserted = await tx.insertCommsThreadDormantKind({
      threadId: formatThreadId(await tx.allocateSequence('thread')),
      kind: 'standing',
      title: trimmed,
      audienceMode: 'explicit',
      createdByUserId: actor.userId,
      createdByLabel: actor.displayName,
    });
    if (!inserted) throw new ValidationError('The room was not created.');
    await tx.upsertCommsThreadParticipant({ threadId: inserted.threadId, userId: actor.userId, role: 'admin' });
    await tx.insertCommsThreadEvent({
      threadId: inserted.threadId,
      eventType: 'Created',
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
    });
    return inserted;
  });
  if (!created) throw new ValidationError('The room was not created.');
  return created;
}

/** Admin-seat membership management; the event appends in the SAME tx. */
async function requireRoomAdmin(p: Persistence, actor: Actor, threadId: string): Promise<CommsThread> {
  const reads = p.reads.forActor(actor);
  const conceal = new NotFoundError('Thread', threadId);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw conceal;
  const thread = await reads.getCommsThreadByThreadId(threadId);
  if (!thread || thread.kind !== 'standing') throw conceal;
  // Non-members (admin or not) get the room's own 404 FIRST — existence is
  // never confirmed to someone without a seat.
  await assertViewCommsThread(reads, actor, thread);
  const seated = await reads.listCommsThreadParticipants(threadId);
  if (!seated.some((m) => m.userId === actor.userId && m.role === 'admin')) {
    throw new ForbiddenError('Only the room’s admin seat manages membership.', { threadId });
  }
  if (!isEntitlementWritable(ent)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);
  return thread;
}

/**
 * ⛔ A SEAT MAY ONLY BE GIVEN TO SOMEONE THIS TENANT MAY ADDRESS (D-008 class-B).
 *
 * Both seating paths take a userId straight from the caller. Under a single
 * tenant that was safe **by accident** — every userId in existence was a
 * co-tenant, so "any user" and "a user of mine" were the same set. With a second
 * tenant they are different sets, and nothing else in the call notices: RLS
 * writes the participant row into the CALLER's tenant, so the row looks
 * perfectly legitimate while referencing a person from somewhere else.
 *
 * The guard is B8's addressable directory rather than a new notion of
 * membership: **a user you may seat is a user you may address**, tenant-scoped
 * and active-only by construction. Reusing it means the two answers cannot drift.
 *
 * It raises NotFound, not Forbidden — the same concealment the rest of comms
 * uses. *Whether a given userId exists in another tenant is not something this
 * tenant is entitled to learn from an error code.*
 */
async function assertAddressableInTenant(p: Persistence, actor: Actor, userId: string): Promise<void> {
  const addressable = await p.reads.forActor(actor).listCommsAddressable();
  if (!addressable.some((person) => person.userId === userId)) {
    throw new NotFoundError('Person', userId);
  }
}

export async function inviteToRoom(
  p: Persistence,
  actor: Actor,
  threadId: string,
  userId: string,
  role: 'member' | 'admin' = 'member',
): Promise<void> {
  await requireRoomAdmin(p, actor, threadId);
  await assertAddressableInTenant(p, actor, userId);
  await p.writes.transaction(actor, async (tx) => {
    await tx.upsertCommsThreadParticipant({ threadId, userId, role });
    await tx.insertCommsThreadEvent({
      threadId,
      eventType: 'ParticipantAdded',
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
    });
  });
}

export async function removeFromRoom(p: Persistence, actor: Actor, threadId: string, userId: string): Promise<void> {
  await requireRoomAdmin(p, actor, threadId);
  const seated = await p.reads.forActor(actor).listCommsThreadParticipants(threadId);
  const admins = seated.filter((m) => m.role === 'admin');
  if (admins.length === 1 && admins[0]?.userId === userId) {
    throw new ValidationError('A room cannot lose its last admin seat — hand the seat over first.');
  }
  await p.writes.transaction(actor, async (tx) => {
    const removed = await tx.removeCommsThreadParticipant(threadId, userId);
    if (removed) {
      await tx.insertCommsThreadEvent({
        threadId,
        eventType: 'ParticipantRemoved',
        actorUserId: actor.userId,
        actorLabel: actor.displayName,
      });
    }
  });
}

/**
 * B8 — THE ADDRESSABLE DIRECTORY (owner-ruled: "all can talk to all").
 *
 * The owner's ruling drew the line this read depends on: **ADDRESSABILITY ≠
 * VISIBILITY.** Being listed here means you can be WRITTEN TO; it says nothing
 * about what you can SEE. Records scoped to named people stay gated, and an
 * acquired link is still denied — that is the uniform-404 posture the
 * disclosure chapter already shipped and Phase B's per-kind gate already
 * enforces. **This function therefore adds no visibility mechanism whatever;
 * the accompanying test pins that inheritance rather than trusting it.**
 *
 * The gate is the module itself: any comms-entitled member reads it (a
 * directory the whole tenant may address must be readable by the whole
 * tenant), and never-entitled is the module's uniform 404. The accepted cost
 * is stated on the record: this DOES disclose the roster (names + role class)
 * — a real widening of the owner/ops Members boundary, ruled and accepted.
 * Only the address book widened; record access did not.
 */
export async function listCommsDirectory(
  p: Persistence,
  actor: Actor,
): Promise<Array<{ userId: string; displayName: string; roleClass: string }>> {
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Comms', 'directory'); // module state never leaks
  // Deliberately NO role gate beyond entitlement: "all can talk to all" is the
  // ruling, and a narrower read here would silently re-fuse the two concepts
  // the owner separated. A lapsed licence still reads (it is a read).
  return reads.listCommsAddressable();
}

export interface AttentionLedgerView {
  readonly awaitingMyAcceptance: MyObligationPartyRow[];
  readonly awaitingMyDelivery: MyObligationPartyRow[];
  readonly awaitingMySettle: MyObligationPartyRow[];
  readonly watching: MyObligationPartyRow[];
  readonly threads: MyCommsThreadRow[];
}

/**
 * THE ATTENTION LEDGER — one honest answer to "what awaits my act". Guardrail
 * Zero by construction: every predicate is `me`; there is no org-wide variant
 * at any layer. Unread is re-derived per read (instance 8).
 */
export async function getAttentionLedger(p: Persistence, actor: Actor): Promise<AttentionLedgerView> {
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Comms', 'ledger');

  const parties = await reads.listMyObligationParties(actor.userId);
  const me = actor.userId;
  return {
    awaitingMyAcceptance: parties.filter((r) => r.obligation.state === 'Delivered' && r.obligation.acceptanceUserId === me),
    awaitingMyDelivery: parties.filter(
      (r) => (r.obligation.state === 'Open' || r.obligation.state === 'Accepted') && r.obligation.accountableUserId === me,
    ),
    awaitingMySettle: parties.filter((r) => r.obligation.state === 'Done' && r.obligation.acceptanceUserId === me),
    watching: parties.filter(
      (r) => r.obligation.requesterUserId === me && r.obligation.acceptanceUserId !== me && r.obligation.accountableUserId !== me,
    ),
    threads: (await reads.listMyCommsThreads(me)).filter((t) => t.unread > 0),
  };
}
