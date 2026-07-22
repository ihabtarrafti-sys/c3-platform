/**
 * commsObligationOps — the Obligation lifecycle (the scar-killer).
 *
 * delivered ≠ accepted ≠ done, enforced as a transition GATEWAY (Temper §4.3):
 *  - Open → Delivered only through a committed evidence delivery (a
 *    CommsObligation-owned, register-visible document);
 *  - only the named acceptance uuid accepts/rejects — an EXTERNAL authority's
 *    word is recorded by its internal proxy WITH a mandatory attestation;
 *  - Done is legal only from Accepted (accountable/requester close the loop);
 *  - cancel (requester, Open/Delivered/Accepted) and reopen (requester,
 *    Accepted/Done) REQUIRE a reason. No state row is ever deleted.
 *
 * MINTING is operational-only (the D2 ruling): canManageMissions. Read-only
 * roles read obligations and act only where NAMED (acceptance). Every
 * transition is optimistic-versioned (CAS; stale = ConcurrencyError) and lands
 * an append-only event — the story is the record.
 */
import {
  type Actor,
  type CommsObligationTransitionInput,
  type CommsObligationView,
  type CreateCommsObligationInput,
  COMMS_MODULE_KEY,
  commsObligationTransitionInputSchema,
  ConcurrencyError,
  createCommsObligationInputSchema,
  formatDocumentId,
  formatObligationId,
  ForbiddenError,
  InvalidTransitionError,
  ModuleReadOnlyError,
  NotFoundError,
  ValidationError,
} from '@c3web/domain';
import { assertManageMissions, assertReadPeople } from '@c3web/authz';
import type { CommsObligationRow, Persistence } from '../ports';
import { isEntitlementWritable } from './commsOps';
import { getMissionThread } from './commsOps';

/** Shared read-side prologue: license (404 when never-entitled) + mission gate. */
async function requireMissionContext(p: Persistence, actor: Actor, missionId: string) {
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw new NotFoundError('Mission', missionId);
  assertReadPeople(actor);
  const mission = await reads.getMissionById(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);
  return { reads, ent };
}

/** Mint an obligation on a mission's thread (operational roles only — D2). */
export async function createMissionObligation(
  p: Persistence,
  actor: Actor,
  missionId: string,
  input: CreateCommsObligationInput,
): Promise<CommsObligationView> {
  const parsed = createCommsObligationInputSchema.parse(input);
  const { reads, ent } = await requireMissionContext(p, actor, missionId);
  assertManageMissions(actor);
  if (!isEntitlementWritable(ent)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);

  const replay = await reads.getCommsObligationByMutation(actor.userId, parsed.clientMutationId);
  if (replay) return replay;

  // The mission's canonical thread (auto-creates under the writable license).
  const { thread } = await getMissionThread(p, actor, missionId, { limit: 1 });
  if (!thread) throw new NotFoundError('Mission', missionId);

  await p.writes.transaction(actor, async (tx) => {
    const obligationId = formatObligationId(await tx.allocateSequence('obligation'));
    await tx.insertCommsObligation({
      obligationId,
      threadId: thread.threadId,
      sourceMessageId: null,
      description: parsed.description,
      accountableUserId: parsed.accountableUserId,
      requesterUserId: actor.userId,
      beneficiaryKind: parsed.beneficiary.kind,
      beneficiaryUserId: parsed.beneficiary.kind === 'account' ? parsed.beneficiary.userId : null,
      beneficiaryLabel: parsed.beneficiary.kind === 'external' ? parsed.beneficiary.label : null,
      dueAt: parsed.dueAt,
      evidenceRequirement: parsed.evidenceRequirement,
      acceptanceKind: parsed.acceptance.kind,
      acceptanceUserId: parsed.acceptance.kind === 'account' ? parsed.acceptance.userId : parsed.acceptance.proxyUserId,
      acceptanceLabel: parsed.acceptance.kind === 'external' ? parsed.acceptance.label : null,
      createdByUserId: actor.userId,
    });
    await tx.insertCommsObligationEvent({
      obligationId,
      eventType: 'Created',
      fromState: null,
      toState: 'Open',
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      reason: null,
      attestation: null,
      deliveryId: null,
      clientMutationId: parsed.clientMutationId,
    });
  });

  const view = await reads.getCommsObligationByMutation(actor.userId, parsed.clientMutationId);
  if (!view) throw new NotFoundError('Obligation', parsed.clientMutationId);
  return view;
}

/** A mission's obligations (due soonest first) — mission-visible, like the thread. */
export async function listMissionObligations(p: Persistence, actor: Actor, missionId: string): Promise<CommsObligationView[]> {
  const { reads } = await requireMissionContext(p, actor, missionId);
  const thread = await reads.getCommsThreadByAnchor('Mission', missionId);
  if (!thread) return [];
  return reads.listCommsObligationsByThread(thread.threadId);
}

/** One obligation, gated by its thread (the mission's live gate). */
export async function getCommsObligation(p: Persistence, actor: Actor, obligationId: string): Promise<CommsObligationView> {
  const reads = p.reads.forActor(actor);
  const conceal = new NotFoundError('Obligation', obligationId);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent) throw conceal;
  const view = await reads.getCommsObligationView(obligationId);
  if (!view) throw conceal;
  const thread = await reads.getCommsThreadByThreadId(view.threadId);
  if (!thread || thread.kind !== 'anchored' || thread.anchorType !== 'Mission' || !thread.anchorId) throw conceal;
  assertReadPeople(actor);
  const mission = await reads.getMissionById(thread.anchorId);
  if (!mission) throw conceal;
  return view;
}

/** The transition table: who may act, from which states, with which words. */
interface TransitionSpec {
  readonly eventType: string;
  readonly toState: 'Open' | 'Delivered' | 'Accepted' | 'Done' | 'Cancelled';
  readonly allowedFrom: string[];
  readonly mayAct: (row: CommsObligationRow, actor: Actor) => boolean;
  /** 'attestation-if-external' = the proxy's mandatory note; 'reason' = always required. */
  readonly words: 'none' | 'attestation-if-external' | 'reason';
}

const TRANSITIONS: Record<'accept' | 'reject' | 'complete' | 'cancel' | 'reopen', TransitionSpec> = {
  accept: {
    eventType: 'Accepted',
    toState: 'Accepted',
    allowedFrom: ['Delivered'],
    mayAct: (row, actor) => actor.userId === row.acceptanceUserId,
    words: 'attestation-if-external',
  },
  reject: {
    eventType: 'Rejected',
    toState: 'Open',
    allowedFrom: ['Delivered'],
    mayAct: (row, actor) => actor.userId === row.acceptanceUserId,
    words: 'attestation-if-external',
  },
  complete: {
    eventType: 'Done',
    toState: 'Done',
    allowedFrom: ['Accepted'],
    mayAct: (row, actor) => actor.userId === row.accountableUserId || actor.userId === row.requesterUserId,
    words: 'none',
  },
  cancel: {
    eventType: 'Cancelled',
    toState: 'Cancelled',
    allowedFrom: ['Open', 'Delivered', 'Accepted'],
    mayAct: (row, actor) => actor.userId === row.requesterUserId,
    words: 'reason',
  },
  reopen: {
    eventType: 'Reopened',
    toState: 'Open',
    allowedFrom: ['Accepted', 'Done'],
    mayAct: (row, actor) => actor.userId === row.requesterUserId,
    words: 'reason',
  },
};

export async function transitionCommsObligation(
  p: Persistence,
  actor: Actor,
  obligationId: string,
  action: keyof typeof TRANSITIONS,
  input: CommsObligationTransitionInput,
): Promise<CommsObligationView> {
  const parsed = commsObligationTransitionInputSchema.parse(input);
  const spec = TRANSITIONS[action];

  // Read-side gate first (thread readership; conceals like every obligation read).
  await getCommsObligation(p, actor, obligationId);
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent || !isEntitlementWritable(ent)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);

  await p.writes.transaction(actor, async (tx) => {
    const row = await tx.getCommsObligationRow(obligationId);
    if (!row) throw new NotFoundError('Obligation', obligationId);
    if (!spec.mayAct(row, actor)) {
      throw new ForbiddenError(`Only the named party may ${action} this obligation.`);
    }
    if (!spec.allowedFrom.includes(row.state)) {
      throw new InvalidTransitionError(row.state, action);
    }
    if (spec.words === 'reason' && !parsed.note) {
      throw new ValidationError(`A reason is required to ${action}.`);
    }
    const attestation = spec.words === 'attestation-if-external' && row.acceptanceKind === 'external' ? (parsed.note ?? null) : null;
    if (spec.words === 'attestation-if-external' && row.acceptanceKind === 'external' && !parsed.note) {
      // The external authority's word is recorded by its proxy — WITH the attestation.
      throw new ValidationError(`An attestation note is required: the ${action} records an external authority's decision.`);
    }
    const moved = await tx.updateCommsObligationState(obligationId, parsed.expectedVersion, spec.toState);
    if (!moved) throw new ConcurrencyError('Obligation', obligationId);
    await tx.insertCommsObligationEvent({
      obligationId,
      eventType: spec.eventType,
      fromState: row.state,
      toState: spec.toState,
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      reason: spec.words === 'reason' ? (parsed.note ?? null) : null,
      attestation,
      deliveryId: null,
      clientMutationId: parsed.clientMutationId,
    });
  });

  return getCommsObligation(p, actor, obligationId);
}

/** Evidence metadata the API computes before registration (bytes already PUT). */
export interface CommsEvidenceUpload {
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storageKey: string;
  readonly note: string | null;
  readonly clientMutationId: string;
}

/**
 * Deliver evidence: ONE tx = document (owner CommsObligation, REGISTERED
 * evidence) + the delivery row + the EvidenceDelivered event + Open→Delivered
 * (a later delivery while already Delivered appends without a state move).
 * Deliverer = the accountable, or an operational role acting for them. Repeats
 * the license + record checks after the byte PUT; resolves the compensation
 * intent in-tx.
 */
export async function deliverCommsEvidence(
  p: Persistence,
  actor: Actor,
  obligationId: string,
  upload: CommsEvidenceUpload,
): Promise<CommsObligationView> {
  // Read-side gate + existence (concealing), then the writable license.
  const before = await getCommsObligation(p, actor, obligationId);
  const reads = p.reads.forActor(actor);
  const ent = await reads.getModuleEntitlement(COMMS_MODULE_KEY);
  if (!ent || !isEntitlementWritable(ent)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);

  await p.writes.transaction(actor, async (tx) => {
    const entNow = await tx.getModuleEntitlement(COMMS_MODULE_KEY);
    if (!entNow || !isEntitlementWritable(entNow)) throw new ModuleReadOnlyError(COMMS_MODULE_KEY);
    const row = await tx.getCommsObligationRow(obligationId);
    if (!row) throw new NotFoundError('Obligation', obligationId);
    const operational = actor.role === 'owner' || actor.role === 'operations';
    if (actor.userId !== row.accountableUserId && !operational) {
      throw new ForbiddenError('Only the accountable owner (or operations) may deliver evidence.');
    }
    if (row.state !== 'Open' && row.state !== 'Delivered') {
      throw new InvalidTransitionError(row.state, 'deliver');
    }
    const documentId = formatDocumentId(await tx.allocateSequence('document'));
    await tx.insertDocument({
      documentId,
      ownerType: 'CommsObligation',
      ownerId: obligationId,
      fileName: upload.fileName,
      contentType: upload.contentType,
      sizeBytes: upload.sizeBytes,
      sha256: upload.sha256,
      label: null,
      storageKey: upload.storageKey,
      uploadedBy: actor.identity,
      recordKind: 'RegisteredEvidence', // evidence IS register-visible, with provenance
    });
    const deliveryId = await tx.insertCommsEvidenceDelivery({
      obligationId,
      documentId,
      deliveredByUserId: actor.userId,
      delivererLabel: actor.displayName,
      note: upload.note,
    });
    if (row.state === 'Open') {
      const moved = await tx.updateCommsObligationState(obligationId, row.version, 'Delivered');
      if (!moved) throw new ConcurrencyError('Obligation', obligationId);
    }
    await tx.insertCommsObligationEvent({
      obligationId,
      eventType: 'EvidenceDelivered',
      fromState: row.state,
      toState: 'Delivered',
      actorUserId: actor.userId,
      actorLabel: actor.displayName,
      reason: null,
      attestation: null,
      deliveryId,
      clientMutationId: upload.clientMutationId,
    });
    await tx.resolveCompensationIntent(upload.storageKey);
  });

  void before;
  return getCommsObligation(p, actor, obligationId);
}
