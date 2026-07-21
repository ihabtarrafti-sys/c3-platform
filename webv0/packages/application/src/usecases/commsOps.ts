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
  type CommsThread,
  type ModuleEntitlement,
  type PostCommsMessageInput,
  COMMS_MODULE_KEY,
  COMMS_MESSAGES_PAGE_MAX,
  ConflictError,
  formatDocumentId,
  formatMessageId,
  formatThreadId,
  ModuleReadOnlyError,
  NotFoundError,
  postCommsMessageInputSchema,
} from '@c3web/domain';
import { assertReadPeople } from '@c3web/authz';
import type { Persistence, ReadStore } from '../ports';

/** active AND inside the effective window — the write-side license test. */
export function isEntitlementWritable(e: ModuleEntitlement, now = new Date()): boolean {
  if (e.state !== 'active') return false;
  if (new Date(e.effectiveFrom) > now) return false;
  if (e.effectiveUntil !== null && new Date(e.effectiveUntil) <= now) return false;
  return true;
}

/**
 * The slice's thread gate: anchored-Mission only. Every other kind/anchor arm
 * fails CLOSED until the full module opens it (each future anchor maps to its
 * OWNING record's native gate — never a blanket people-read).
 */
async function assertViewCommsThread(reads: ReadStore, actor: Actor, thread: CommsThread): Promise<void> {
  if (thread.kind === 'anchored' && thread.anchorType === 'Mission' && thread.anchorId) {
    assertReadPeople(actor);
    const mission = await reads.getMissionById(thread.anchorId);
    if (!mission) throw new NotFoundError('Mission', thread.anchorId);
    return;
  }
  throw new NotFoundError('Thread', thread.threadId);
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
  if (!thread) return { thread: null, messages: [] };

  const limit = Math.min(Math.max(page?.limit ?? 50, 1), COMMS_MESSAGES_PAGE_MAX);
  const messages = await reads.listCommsMessages(thread.threadId, limit, page?.beforeSeq ?? null);
  return { thread, messages };
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
  });

  const view = await reads.getCommsMessageByMutation(actor.userId, upload.clientMutationId);
  if (!view) throw new NotFoundError('Message', upload.clientMutationId);
  return view;
}
