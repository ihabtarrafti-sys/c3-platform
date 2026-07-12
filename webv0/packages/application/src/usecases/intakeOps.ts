/**
 * intakeOps — Track B6: guest intake (tokenized sandbox → governed promotion).
 *
 * TWO audiences, ONE record:
 *   - the GUEST (public, unauthenticated) submits into the sandbox. The only
 *     surface is `submitGuestIntake`, which validates the payload and hands off
 *     to the tenant-unbound guest port (token-resolved, atomic claim + insert).
 *   - STAFF (owner/operations, `canManageIntake`) mint/revoke links, review the
 *     sandbox, and PROMOTE (→ the AddPerson governed pipeline, under the
 *     reviewer's own identity) or REJECT (→ scrub the payload; the API wipes the
 *     quarantined blobs).
 *
 * Promotion is ONE transaction: it mints the AddPerson approval (exactly as
 * submitAddPerson does) AND stamps the submission Promoted together — so a
 * failure never leaves a half-promoted row that would mint a duplicate approval
 * on retry. Nothing a guest typed ever reaches live data without this
 * staff-initiated, governed, audited step.
 */
import {
  type Actor,
  type Approval,
  type IntakeKind,
  type IntakeLink,
  type IntakeSubmission,
  type IntakeUpload,
  type CreateIntakeLinkInput,
  createIntakeLinkInputSchema,
  formatApprovalId,
  onboardingToAddPerson,
  parseIntakePayload,
  ConflictError,
  NotFoundError,
  PENDING_ADD_PERSON_TARGET,
} from '@c3web/domain';
import { assertManageIntake, assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

// ── staff: mint / list / revoke links ────────────────────────────────────────

export interface CreateIntakeLinkCommand {
  readonly input: CreateIntakeLinkInput;
  /** The SHA-256 of the raw token (minted + hashed at the API edge; never here). */
  readonly tokenHash: string;
}

/** Mint a capability link. The raw token is returned to the caller ONCE by the
 *  API edge that minted it; persistence only ever sees the hash. */
export async function createIntakeLink(p: Persistence, actor: Actor, command: CreateIntakeLinkCommand): Promise<IntakeLink> {
  assertManageIntake(actor);
  const input = createIntakeLinkInputSchema.parse(command.input);
  const expiresAt = new Date(Date.now() + input.expiresInHours * 3600 * 1000).toISOString();

  return p.writes.transaction(actor, async (tx) => {
    const link = await tx.insertIntakeLink({
      tokenHash: command.tokenHash,
      kind: input.kind,
      label: input.label?.trim() ? input.label.trim() : null,
      createdBy: actor.identity,
      expiresAt,
      maxUses: 1, // V1: onboarding links are single-use (one link = one joiner).
    });
    await tx.appendAuditEvent({
      entityType: 'Intake',
      entityId: link.id,
      action: 'IntakeLinkCreated',
      actor: actor.identity,
      before: null,
      after: { kind: link.kind, label: link.label, expiresAt: link.expiresAt },
    });
    return link;
  });
}

export async function listIntakeLinks(p: Persistence, actor: Actor): Promise<IntakeLink[]> {
  assertManageIntake(actor);
  return p.reads.forActor(actor).listIntakeLinks();
}

export async function revokeIntakeLink(p: Persistence, actor: Actor, linkId: string): Promise<IntakeLink> {
  assertManageIntake(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getIntakeLink(linkId);
    if (!current) throw new NotFoundError('IntakeLink', linkId);
    const revoked = await tx.revokeIntakeLink(linkId);
    if (!revoked) throw new ConflictError('The link is no longer active.', { linkId, status: current.status });
    await tx.appendAuditEvent({
      entityType: 'Intake',
      entityId: linkId,
      action: 'IntakeLinkRevoked',
      actor: actor.identity,
      before: { status: current.status },
      after: { status: 'Revoked' },
    });
    return revoked;
  });
}

// ── staff: review the sandbox ────────────────────────────────────────────────

export async function listSandbox(p: Persistence, actor: Actor): Promise<IntakeSubmission[]> {
  assertManageIntake(actor);
  return p.reads.forActor(actor).listIntakeSubmissions();
}

export async function getSubmissionForReview(p: Persistence, actor: Actor, submissionId: string): Promise<IntakeSubmission> {
  assertManageIntake(actor);
  const found = await p.reads.forActor(actor).getIntakeSubmissionById(submissionId);
  if (!found) throw new NotFoundError('IntakeSubmission', submissionId);
  return found;
}

// ── staff: promote → the AddPerson governed pipeline ─────────────────────────

export interface PromoteResult {
  readonly approval: Approval;
  readonly submission: IntakeSubmission;
}

export async function promoteSubmission(p: Persistence, actor: Actor, submissionId: string, decisionNote: string | null): Promise<PromoteResult> {
  // Promotion mints a governed AddPerson request under the reviewer's identity —
  // it needs BOTH the intake standing and the submit standing.
  assertManageIntake(actor);
  assertSubmitApproval(actor);

  return p.writes.transaction(actor, async (tx) => {
    const submission = await tx.getIntakeSubmission(submissionId);
    if (!submission) throw new NotFoundError('IntakeSubmission', submissionId);
    if (submission.status !== 'Pending') {
      throw new ConflictError('This submission has already been reviewed.', { submissionId, status: submission.status });
    }
    if (submission.payload === null) {
      throw new ConflictError('This submission has no payload to promote.', { submissionId });
    }

    // Only the onboarding door promotes to AddPerson today; the parse is
    // authoritative (a malformed sandbox payload fails here, never a bad person).
    const payload = parseIntakePayload(submission.kind, submission.payload);
    const input = onboardingToAddPerson(payload);
    const reason = decisionNote?.trim() ? decisionNote.trim() : `Promoted from guest intake ${submissionId}`;

    // Mint the approval EXACTLY as submitAddPerson does — same target, payload
    // shape, and events — but in the SAME transaction as the sandbox stamp.
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: 'AddPerson',
      targetPersonId: PENDING_ADD_PERSON_TARGET,
      targetId: null,
      reason,
      payload: { operationType: 'AddPerson', input },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({
      approvalId,
      fromStatus: null,
      toStatus: 'Submitted',
      actor: actor.identity,
      note: `AddPerson request submitted (guest-intake promotion of ${submissionId})`,
    });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: 'AddPerson', fullName: input.fullName },
    });

    const promoted = await tx.markIntakeSubmissionPromoted(submissionId, actor.identity, approvalId, reason);
    if (!promoted) throw new ConflictError('This submission has already been reviewed.', { submissionId });
    await tx.appendAuditEvent({
      entityType: 'Intake',
      entityId: submissionId,
      action: 'IntakePromoted',
      actor: actor.identity,
      before: { status: 'Pending' },
      after: { status: 'Promoted', approvalId },
    });

    return { approval, submission: promoted };
  });
}

// ── staff: reject → scrub (the API wipes the quarantined blobs) ───────────────

export interface RejectResult {
  readonly submission: IntakeSubmission;
  /** The quarantine storage keys the API must delete (wipe-on-reject). */
  readonly wipedStorageKeys: readonly string[];
}

export async function rejectSubmission(p: Persistence, actor: Actor, submissionId: string, decisionNote: string | null): Promise<RejectResult> {
  assertManageIntake(actor);
  return p.writes.transaction(actor, async (tx) => {
    const submission = await tx.getIntakeSubmission(submissionId);
    if (!submission) throw new NotFoundError('IntakeSubmission', submissionId);
    if (submission.status !== 'Pending') {
      throw new ConflictError('This submission has already been reviewed.', { submissionId, status: submission.status });
    }
    const wipedStorageKeys = submission.uploads.map((u) => u.storageKey);
    const note = decisionNote?.trim() ? decisionNote.trim() : null;
    const rejected = await tx.markIntakeSubmissionRejected(submissionId, actor.identity, note);
    if (!rejected) throw new ConflictError('This submission has already been reviewed.', { submissionId });
    // M-02: record the quarantine keys as durable wipe tombstones IN THIS TX, so a
    // failed object delete afterward leaves a retryable record — not a silent orphan
    // (the metadata scrub above has already erased the keys from the submission row).
    for (const storageKey of wipedStorageKeys) {
      await tx.insertBlobTombstone({ storageKey, blobClass: 'intake', reason: 'intake_reject' });
    }
    await tx.appendAuditEvent({
      entityType: 'Intake',
      entityId: submissionId,
      action: 'IntakeRejected',
      actor: actor.identity,
      before: { status: 'Pending', uploadCount: wipedStorageKeys.length },
      after: { status: 'Rejected' },
    });
    return { submission: rejected, wipedStorageKeys };
  });
}

/** The minimal object-store surface the wipe drain needs (DocumentStorage satisfies it). */
export interface BlobWipePort {
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export interface WipeResult {
  readonly attempted: number;
  readonly wiped: number;
  readonly stillPending: number;
}

/**
 * M-02: drain the rejected-intake blob-wipe outbox for the tenant. For every
 * pending tombstone it deletes the object, VERIFIES it is gone, and resolves the
 * tombstone; a failure leaves the tombstone pending (retryable) with the error
 * recorded, instead of orphaning the bytes. Called after `rejectSubmission`
 * commits — and because it drains ALL pending tombstones (not just the ones this
 * reject added) it also retries any a prior reject left behind, so the outbox
 * needs no separate cron.
 */
export async function wipeRejectedIntakeBlobs(p: Persistence, storage: BlobWipePort, actor: Actor): Promise<WipeResult> {
  const pending = await p.reads.forActor(actor).listPendingIntakeRejectTombstones();
  if (pending.length === 0) return { attempted: 0, wiped: 0, stillPending: 0 };

  const outcomes: Array<{ id: string; deleted: boolean; error?: string }> = [];
  for (const t of pending) {
    try {
      await storage.delete(t.storageKey);
      const still = await storage.get(t.storageKey);
      outcomes.push(still === null ? { id: t.id, deleted: true } : { id: t.id, deleted: false, error: 'object still present after delete' });
    } catch (err) {
      outcomes.push({ id: t.id, deleted: false, error: err instanceof Error ? err.message : 'delete failed' });
    }
  }

  await p.writes.transaction(actor, async (tx) => {
    for (const o of outcomes) await tx.resolveBlobTombstone(o.id, o);
  });

  const wiped = outcomes.filter((o) => o.deleted).length;
  return { attempted: pending.length, wiped, stillPending: pending.length - wiped };
}

// ── guest: the ONLY public write surface ─────────────────────────────────────

export interface SubmitGuestIntakeCommand {
  readonly tokenHash: string;
  readonly submissionId: string;
  readonly kind: IntakeKind;
  readonly payload: unknown;
  readonly uploads: readonly IntakeUpload[];
  readonly submitterFingerprint: string | null;
}

/**
 * Validate the guest's payload against its kind and hand off to the guest port,
 * which atomically claims the (unguessable) token and inserts the sandbox row
 * under the resolved tenant. Throws IntakeLinkUnavailableError when the token is
 * no longer claimable — the API compensates by deleting any quarantined blobs.
 */
export async function submitGuestIntake(p: Persistence, command: SubmitGuestIntakeCommand): Promise<IntakeSubmission> {
  const payload = parseIntakePayload(command.kind, command.payload);
  const result = await p.guest.claimAndInsert(command.tokenHash, {
    submissionId: command.submissionId,
    payload,
    uploads: command.uploads,
    submitterFingerprint: command.submitterFingerprint,
  });
  // Defensive: the claimed kind must match what the payload was validated as.
  if (result.kind !== command.kind) {
    throw new ConflictError('The intake link kind does not match the submission.', { expected: command.kind, actual: result.kind });
  }
  return result.submission;
}

// ── staff: attach a promoted submission's files to the created person ─────────
// The person exists only AFTER the AddPerson approval executes; this resolves
// the created person from the promoted approval so the API can copy the
// quarantined blobs into the S4 document store on that person.

export interface ResolvedPromotedPerson {
  readonly submission: IntakeSubmission;
  readonly personId: string;
}

/** Resolve the person a promoted submission produced (once its approval has
 *  executed), for the post-execute file attach. */
export async function resolvePromotedPerson(p: Persistence, actor: Actor, submissionId: string): Promise<ResolvedPromotedPerson> {
  assertManageIntake(actor);
  return p.writes.transaction(actor, async (tx) => {
    const submission = await tx.getIntakeSubmission(submissionId);
    if (!submission) throw new NotFoundError('IntakeSubmission', submissionId);
    if (submission.status !== 'Promoted' || !submission.promotedApprovalId) {
      throw new ConflictError('Only a promoted submission has a person to attach to.', { submissionId, status: submission.status });
    }
    if (submission.promotedPersonId) {
      return { submission, personId: submission.promotedPersonId };
    }
    const person = await tx.getPersonByCreatingApproval(submission.promotedApprovalId);
    if (!person) {
      throw new ConflictError('The promoted request has not been approved and executed yet.', { submissionId, approvalId: submission.promotedApprovalId });
    }
    const updated = await tx.setIntakeSubmissionPromotedPerson(submissionId, person.personId);
    return { submission: updated ?? submission, personId: person.personId };
  });
}
