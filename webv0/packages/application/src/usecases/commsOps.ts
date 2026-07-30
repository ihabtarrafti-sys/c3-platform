/**
 * commsOps — the Mission Comms slice (threads + messages + the doc read guard).
 *
 * AUTHZ (the Neural-verified read-guard verdict, 2026-07-21):
 *  - Anchored-mission thread readership = the mission's LIVE gate
 *    (assertReadPeople + mission existence), recomputed per read — mission
 *    content is mission-visible for every role, an owner-accepted posture.
 *  - Write ⊇ read: posting/attaching requires the thread gate (D2). Obligation
 *    minting is operational-only (commit B).
 *  - The module license: never-entitled (no row) = NotFound on BOTH read and
 *    write (module state never leaks); lapsed = reads flow, writes throw
 *    MODULE_READ_ONLY (403).
 *  - commsDocReadGuard is the record-scoped gate for the server-owned document
 *    types — every failure arm throws the IDENTICAL NotFound('Document', id)
 *    (uniform concealment: a denied reader can never learn which mission or
 *    message a document hangs on).
 *
 * PROVENANCE: a Comms attachment's provenance is the comms_document_attachment
 * row + the append-only message spine — deliberately NOT a DocumentAttached
 * audit event (keeps Comms filenames out of the owner/ops audit-CSV surface).
 */
import {
  type Actor,
  type CommsMessageView,
  type CommsRecallReason,
  type CommsRecallView,
  type CommsThread,
  type ModuleEntitlement,
  type PostCommsMessageInput,
  COMMS_MODULE_KEY,
  COMMS_MESSAGES_PAGE_MAX,
  COMMS_AUTHOR_RECALL_WINDOW_MS,
  ConflictError,
  ForbiddenError,
  ValidationError,
  formatDocumentId,
  formatMessageId,
  formatThreadId,
  ModuleReadOnlyError,
  NotFoundError,
  postCommsMessageInputSchema,
} from '@c3web/domain';
import { assertReadPeople, canManageMissions } from '@c3web/authz';
import { resolveTransclusions } from './commsTransclusion';
import type { Persistence, ReadStore } from '../ports';

/** active AND inside the effective window — the write-side license test. */
export function isEntitlementWritable(e: ModuleEntitlement, now = new Date()): boolean {
  if (e.state !== 'active') return false;
  if (new Date(e.effectiveFrom) > now) return false;
  if (e.effectiveUntil !== null && new Date(e.effectiveUntil) <= now) return false;
  return true;
}

/**
 * THE PER-KIND THREAD GATE (Phase B generalization — the activation's design
 * statement): readership composes from each kind's NATIVE authority, never a
 * blanket rule.
 *   anchored → the anchor's OWN gate (Mission today; each future anchor maps
 *              to its owning record's native gate — never a blanket read);
 *   direct   → the seated participants, nothing else — not even owners;
 *   standing → explicit audience = the seated participants (the invite-only
 *              room; v1's ONE private class).
 * Every failure arm is the thread's own 404 — a non-member learns nothing,
 * not even that the room exists (NEO-DOC-01 composed, not re-decided).
 * Standing is DERIVED per read from the live participant rows (removed_at
 * governs) — never a snapshot.
 */
export async function assertViewCommsThread(reads: ReadStore, actor: Actor, thread: CommsThread): Promise<void> {
  const conceal = new NotFoundError('Thread', thread.threadId);
  if (thread.kind === 'anchored' && thread.anchorType === 'Mission' && thread.anchorId) {
    assertReadPeople(actor);
    const mission = await reads.getMissionById(thread.anchorId);
    if (!mission) throw new NotFoundError('Mission', thread.anchorId);
    return;
  }
  if (thread.kind === 'direct' || thread.kind === 'standing') {
    const seated = await reads.listCommsThreadParticipants(thread.threadId);
    if (seated.some((m) => m.userId === actor.userId)) return;
    throw conceal;
  }
  throw conceal;
}

/**
 * Block 6 (disposition item 7): moderator standing for a reasoned removal.
 * A thread member who manages the anchoring domain — mission management is
 * the existing authority for a mission-anchored thread, reused rather than
 * invented (a new moderator role would be product surface this ruling does
 * not authorize).
 */
async function canModerateCommsThread(reads: ReadStore, actor: Actor, thread: CommsThread): Promise<boolean> {
  if (thread.kind === 'anchored' && thread.anchorType === 'Mission' && thread.anchorId) {
    if (!canManageMissions(actor.role)) return false;
    return (await reads.getMissionById(thread.anchorId)) !== null;
  }
  // Phase B: a standing room's moderator is its ADMIN seat — room authority,
  // not org role. A direct thread has NO moderator (two members, no chair):
  // the author-recall window is the only removal path there.
  if (thread.kind === 'standing') {
    const seated = await reads.listCommsThreadParticipants(thread.threadId);
    return seated.some((m) => m.userId === actor.userId && m.role === 'admin');
  }
  return false;
}

/**
 * The record-scoped read gate for server-owned Comms documents — the Claim
 * pattern (assertReadOwner defers; this runs where the ownerId is known).
 * EVERY failure path throws the identical `conceal` NotFound (uniform 404:
 * on the content path that is ('Document', documentId); on the list path,
 * the caller-supplied owner ref) — a denied reader never learns which
 * mission/message/obligation a document hangs on.
 */
export async function commsDocReadGuard(
  p: Persistence,
  actor: Actor,
  ownerType: 'CommsMessage' | 'CommsObligation',
  ownerId: string,
  concealAs: { entityType: string; entityId: string },
): Promise<void> {
  const conceal = new NotFoundError(concealAs.entityType, concealAs.entityId);
  try {
    const reads = p.reads.forActor(actor);
    const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
    if (!ent) throw conceal; // never-entitled: 404, module state never leaks
    const ownerRef =
      ownerType === 'CommsMessage'
        ? await reads.getCommsMessageByMessageId(ownerId)
        : await reads.getCommsObligationByObligationId(ownerId);
    if (!ownerRef) throw conceal;
    // R2-02-C9 (Block 6): the guard CONSULTS TOMBSTONE STATE. Without this a
    // known attachment id stayed authorized forever after recall — the bytes
    // outliving the message is the whole defect. Denial is this document's
    // own 404, per the NEO-DOC-01 ruling already in force (not re-decided).
    if (ownerType === 'CommsMessage' && (await reads.getCommsMessageRecall(ownerId)) !== null) throw conceal;
    const thread = await reads.getCommsThreadByThreadId(ownerRef.threadId);
    if (!thread) throw conceal;
    await assertViewCommsThread(reads, actor, thread);
  } catch (e) {
    // Uniform concealment: any not-found/denied shape collapses to the same 404.
    if (e instanceof NotFoundError) throw conceal;
    throw e;
  }
}

/** The mission-thread read model: the thread (or null when it does not exist yet) + a page. */
export interface MissionThreadView {
  readonly thread: CommsThread | null;
  readonly messages: CommsMessageView[];
  /** The caller's OWN read position (unread = thread.lastSeq − this); null = never read. */
  readonly myLastReadSeq: number | null;
}

/**
 * Read a mission's conversation. Auto-creates the canonical anchored thread on
 * first open ONLY under a writable license (a lapsed tenant still reads what
 * exists; nothing is created read-only).
 */
export async function getMissionThread(
  p: Persistence,
  actor: Actor,
  missionId: string,
  page?: { limit?: number; beforeSeq?: number | null },
): Promise<MissionThreadView> {
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Mission', missionId); // never-entitled: 404 both paths
  assertReadPeople(actor);
  const mission = await reads.getMissionById(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);

  let thread = await reads.getCommsThreadByAnchor('Mission', missionId);
  if (!thread && isEntitlementWritable(ent)) {
    thread = await createMissionThread(p, actor, missionId);
  }
  if (!thread) return { thread: null, messages: [], myLastReadSeq: null };

  const limit = Math.min(Math.max(page?.limit ?? 50, 1), COMMS_MESSAGES_PAGE_MAX);
  const raw = await reads.listCommsMessages(thread.threadId, limit, page?.beforeSeq ?? null);
  // Phase C: transclusion resolves at the READ BOUNDARY, so every consumer of
  // a thread gets it — never one route while another silently doesn't.
  const messages = await resolveTransclusions(reads, actor, raw);
  const myCursor = await reads.getCommsInboxCursor(thread.threadId, actor.userId);
  return { thread, messages, myLastReadSeq: myCursor?.lastReadSeq ?? null };
}

/** Get-or-create convergence on the one-per-anchor partial unique. */
async function createMissionThread(p: Persistence, actor: Actor, missionId: string): Promise<CommsThread> {
  const created = await p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('thread');
    const inserted = await tx.insertCommsThread({
      threadId: formatThreadId(seq),
      kind: 'anchored',
      anchorType: 'Mission',
      anchorId: missionId,
      createdByUserId: actor.userId,
      createdByLabel: actor.displayName,
    });
    if (inserted) {
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
  // A concurrent creator won; its row is committed by conflict resolution.
  const winner = await p.reads.forActor(actor).getCommsThreadByAnchor('Mission', missionId);
  if (!winner) throw new NotFoundError('Mission', missionId);
  return winner;
}

/**
 * Post a message to a mission's thread (D2: write ⊇ read — the poster must pass
 * the thread gate; the composer-side visibility warning is a UI concern).
 * Send-idempotent: a duplicate clientMutationId returns the existing message.
 */
export async function postMissionMessage(
  p: Persistence,
  actor: Actor,
  missionId: string,
  input: PostCommsMessageInput,
): Promise<CommsMessageView> {
  const parsed = postCommsMessageInputSchema.parse(input);
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Mission', missionId);
  assertReadPeople(actor);
  const mission = await reads.getMissionById(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);
  if (!isEntitlementWritable(ent)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);

  // Idempotent replay: the same send returns the same message.
  const replay = await reads.getCommsMessageByMutation(actor.userId, parsed.clientMutationId);
  if (replay) return replay;

  let thread = await reads.getCommsThreadByAnchor('Mission', missionId);
  if (!thread) thread = await createMissionThread(p, actor, missionId);
  await assertSupersessionIsLawful(reads, parsed.supersedesMessageId, thread.threadId);
  const threadId = thread.threadId;

  await p.writes.transaction(actor, async (tx) => {
    const nextSeq = await tx.bumpCommsThreadSeq(threadId);
    if (nextSeq === null) throw new NotFoundError('Thread', threadId);
    const messageId = formatMessageId(await tx.allocateSequence('message'));
    const inserted = await tx.insertCommsMessage({
      messageId,
      threadId,
      seq: nextSeq,
      authorUserId: actor.userId,
      authorLabel: actor.displayName,
      clientMutationId: parsed.clientMutationId,
      // ⚠️ THE BATTLE'S FAIL WAS EXACTLY HERE: the schema accepted the kind and
      // the persist dropped it silently — a defect living BETWEEN two layers
      // that each looked correct alone. The RED for this reads the kind back
      // from the SPINE, never from the response echo.
      messageKind: parsed.messageKind,
      supersedesMessageId: parsed.supersedesMessageId,
    });
    if (!inserted) {
      // A concurrent duplicate send won the idempotency unique — roll this tx
      // back (reverting the seq bump) and let the replay read return the winner.
      throw new ConflictError('Duplicate send.', { clientMutationId: parsed.clientMutationId });
    }
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
    // Phase B-LIVE: publish IN-TX — fires on COMMIT, never on rollback.
    await tx.publishCommsLiveEvent({ threadId, messageId, seq: nextSeq });
  }).catch(async (e) => {
    if (e instanceof ConflictError) {
      const winner = await reads.getCommsMessageByMutation(actor.userId, parsed.clientMutationId);
      if (winner) return; // fall through to the final read below
    }
    throw e;
  });

  const view = await reads.getCommsMessageByMutation(actor.userId, parsed.clientMutationId);
  if (!view) throw new NotFoundError('Message', parsed.clientMutationId);
  return view;
}

/** The attachment metadata the API computes before registration (bytes already PUT). */
export interface CommsAttachmentUpload {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly caption: string | null;
  readonly clientMutationId: string;
}

/**
 * Register an uploaded attachment as ONE message (spine + revision + document +
 * attachment link) in ONE transaction — the tx-aware registration primitive
 * (never attachDocument: no owner/ops gate, no audit event; provenance is the
 * message spine). The tx REPEATS the entitlement + thread gate after the byte
 * PUT (the lapse/revocation race), and resolves the write-ahead compensation
 * intent — commit means all are true; rollback leaves the intent armable.
 */
export async function registerCommsAttachment(
  p: Persistence,
  actor: Actor,
  missionId: string,
  upload: CommsAttachmentUpload,
): Promise<CommsMessageView> {
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Mission', missionId);
  assertReadPeople(actor);
  const mission = await reads.getMissionById(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);
  if (!isEntitlementWritable(ent)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);

  const replay = await reads.getCommsMessageByMutation(actor.userId, upload.clientMutationId);
  if (replay) return replay; // the route arms compensation for the fresh bytes

  let thread = await reads.getCommsThreadByAnchor('Mission', missionId);
  if (!thread) thread = await createMissionThread(p, actor, missionId);
  const threadId = thread.threadId;

  await p.writes.transaction(actor, async (tx) => {
    // Re-check AFTER the byte PUT: the license or the room may have moved.
    const entNow = await tx.getModuleEntitlement(COMMS_MODULE_KEY);
    if (!entNow) throw new NotFoundError('Mission', missionId);
    if (!isEntitlementWritable(entNow)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);
    if (!(await tx.missionExists(missionId))) throw new NotFoundError('Mission', missionId);
    const threadNow = await tx.getCommsThread(threadId);
    if (!threadNow) throw new NotFoundError('Thread', threadId);

    const nextSeq = await tx.bumpCommsThreadSeq(threadId);
    if (nextSeq === null) throw new NotFoundError('Thread', threadId);
    const messageId = formatMessageId(await tx.allocateSequence('message'));
    const inserted = await tx.insertCommsMessage({
      messageId,
      threadId,
      seq: nextSeq,
      authorUserId: actor.userId,
      authorLabel: actor.displayName,
      clientMutationId: upload.clientMutationId,
    });
    if (!inserted) throw new ConflictError('Duplicate send.', { clientMutationId: upload.clientMutationId });
    await tx.insertCommsMessageRevision({
      messageId,
      revisionNo: 1,
      body: upload.caption ?? '',
      editorUserId: actor.userId,
      editorLabel: actor.displayName,
      reason: null,
    });
    const documentId = formatDocumentId(await tx.allocateSequence('document'));
    await tx.insertDocument({
      documentId,
      ownerType: 'CommsMessage',
      ownerId: messageId,
      fileName: upload.fileName,
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
      sha256: upload.sha256,
      label: null,
      storageKey: upload.storageKey,
      uploadedBy: actor.identity,
      recordKind: 'Attachment', // ordinary Comms file — absent from the Documents register
    });
    await tx.insertCommsDocumentAttachment({ messageId, documentId, attachedByUserId: actor.userId });
    // The blob is now referenced by a committed row — resolve the write-ahead intent in-tx.
    await tx.resolveCompensationIntent(upload.storageKey);
    await tx.publishCommsLiveEvent({ threadId, messageId, seq: nextSeq });
  });

  const view = await reads.getCommsMessageByMutation(actor.userId, upload.clientMutationId);
  if (!view) throw new NotFoundError('Message', upload.clientMutationId);
  return view;
}

/**
 * Block 6 (R2-02, Model B): RECALL a message — the body and its attachments
 * become unreachable through every consumer, while the tombstone RENDERS.
 *
 * The two paths, per the disposition:
 *   - AUTHOR RECALL (item 5, ratified): reason-free, the author's own message,
 *     inside the 15-minute window. "I just posted that wrong", not history
 *     revision.
 *   - MODERATOR REMOVAL (item 7): a REASONED act — the note is mandatory —
 *     available to a thread member with mission-management standing, at any
 *     age. The two are distinguished on the wire so the placeholder can say
 *     which happened (item 5's second half).
 *
 * RECALL NEVER CASCADES (exclusion 9 / item 6): where an obligation, approval,
 * Document or financial fact already derives from the message, the recall
 * SUCCEEDS on the message and the caller is told plainly that the downstream
 * facts remain — silence there is the same lie in a smaller font.
 *
 * Idempotent: a second recall of the same message returns the standing
 * tombstone rather than erroring (the writer's UNIQUE makes it a no-op).
 */
export async function recallMissionMessage(
  p: Persistence,
  actor: Actor,
  messageId: string,
  input: { reasonCode: CommsRecallReason; moderationNote?: string | null },
): Promise<{ recall: CommsRecallView; downstreamFactsRemain: boolean }> {
  const conceal = new NotFoundError('CommsMessage', messageId);
  const reads = p.reads.forActor(actor);

  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw conceal; // never-entitled: module state never leaks
  const message = await reads.getCommsMessageByMessageId(messageId);
  if (!message) throw conceal;
  const thread = await reads.getCommsThreadByThreadId(message.threadId);
  if (!thread) throw conceal;
  // Read standing first — a non-member learns nothing, not even existence.
  await assertViewCommsThread(reads, actor, thread);

  // Already recalled → return the standing tombstone (idempotent, no error).
  const standing = await reads.getCommsMessageRecall(messageId);
  if (standing) return { recall: standing, downstreamFactsRemain: await hasDownstreamFacts(reads, messageId) };

  // A lapsed licence reads what exists but writes nothing (R2-C10: recall
  // gains no survives-lapse superpower).
  if (!isEntitlementWritable(ent)) {
    throw new ForbiddenError('This tenant’s Comms licence is read-only.', { module: COMMS_MODULE_KEY });
  }

  const full = await reads.getCommsMessageForRecall(messageId);
  if (!full) throw conceal;
  const isAuthor = full.authorUserId === actor.userId;
  const ageMs = Date.now() - new Date(full.createdAt).getTime();

  if (input.reasonCode === 'AuthorRecall') {
    if (!isAuthor) throw new ForbiddenError('Only the author may recall their own message.', { messageId });
    if (ageMs > COMMS_AUTHOR_RECALL_WINDOW_MS) {
      throw new ForbiddenError('The author recall window has closed; a moderator removal is the remaining path.', { messageId });
    }
  } else {
    // ModeratorRemoval — reasoned by construction.
    if (!(await canModerateCommsThread(reads, actor, thread))) {
      throw new ForbiddenError('Your role may not remove another member’s message.', { messageId });
    }
    if (!input.moderationNote || input.moderationNote.trim() === '') {
      throw new ValidationError('A moderator removal requires a note — a reasoned act, never a silent one.');
    }
  }

  await p.writes.transaction(actor, async (tx) => {
    await tx.insertCommsMessageTombstone({
      messageId,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      reasonCode: input.reasonCode,
      moderationNote: input.moderationNote?.trim() ?? null,
    });
    await tx.appendAuditEvent({
      entityType: 'CommsMessage',
      entityId: messageId,
      action: 'CommsMessageRecalled',
      actor: actor.identity,
      // N-2 (already in force): audit is a META-channel — the field NAMES of
      // what became unreachable, never the recalled body.
      before: { body: null, links: null, attachments: null },
      after: { recalled: null },
    });
  });

  const recall = await reads.getCommsMessageRecall(messageId);
  if (!recall) throw new Error('tombstone written but not readable');
  return { recall, downstreamFactsRemain: await hasDownstreamFacts(reads, messageId) };
}

/**
 * Phase C: a supersession must point at a LIVE decision in the SAME thread.
 * Two refusals, both because a ruling may not stand on an absence:
 *  · a message in another thread is not this conversation's history;
 *  · a RECALLED decision cannot be superseded — superseding it would dress its
 *    absence as history, which is the recall lane's lie in the other direction.
 */
export async function assertSupersessionIsLawful(reads: ReadStore, supersedesMessageId: string | null, threadId: string): Promise<void> {
  if (supersedesMessageId === null) return;
  const target = await reads.getCommsMessageByMessageId(supersedesMessageId);
  if (!target || target.threadId !== threadId) {
    throw new ValidationError('A decision may only supersede a message in the same thread.');
  }
  if ((await reads.getCommsMessageRecall(supersedesMessageId)) !== null) {
    throw new ValidationError('That decision was recalled — superseding it would dress an absence as history.');
  }
}

/** Item 6: recall never cascades — this reports, it does not remove. */
async function hasDownstreamFacts(reads: ReadStore, messageId: string): Promise<boolean> {
  return (await reads.countCommsMessageDownstreamFacts(messageId)) > 0;
}
