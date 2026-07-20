/**
 * documentOps — registered evidence (S4). The API layer receives the bytes,
 * enforces size/type, computes the SHA-256, stores the blob under a
 * tenant-scoped server-generated key, and THEN registers the metadata here.
 *
 * AUTHZ IS THE OWNING RECORD'S: reading an agreement's documents requires
 * canReadAgreements (legal reads contracts AND their paper); every other owner
 * type rides the baseline read. Attach/remove are owner/operations
 * (direct-audited — evidence RECORDS facts), version-guarded, with the audit
 * on the OWNER record's trail so an agreement's history shows its paper.
 * Removal is a soft flip: bytes retained, unreachable through the API.
 */
import {
  type Actor,
  type C3Document,
  type DocumentAttachInput,
  type DocumentOwnerType,
  documentAttachInputSchema,
  ConcurrencyError,
  formatDocumentId,
  NotFoundError,
  ValidationError,
} from '@c3web/domain';
import { assertReadAgreements, assertReadPeople, assertSubmitApproval, assertViewFinancials } from '@c3web/authz';
import { claimReadGuard } from './claimOps';
import type { Persistence } from '../ports';

/** The read gate follows the OWNING record (an agreement's PDF is agreement
 *  data; an invoice's PDF carries money — the finance gate applies).
 *
 *  EXHAUSTIVE by owner type. The prior `else` failed OPEN for any unknown value
 *  (gated it with people-read); this switch fails CLOSED via the `default`, and
 *  the two server-owned Comms types NEVER ride the people-read baseline — their
 *  read-authz is record-scoped (thread participation + module entitlement), wired
 *  by the Comms module's own use-cases. Until then they throw. */
function assertReadOwner(actor: Actor, ownerType: DocumentOwnerType): void {
  switch (ownerType) {
    case 'Agreement':
      return assertReadAgreements(actor);
    case 'Invoice':
      return assertViewFinancials(actor);
    case 'Claim':
      return; // record-scoped: claimReadGuard runs where the ownerId is known
    case 'Mission':
    case 'Person':
    case 'Credential':
    case 'Entity':
      return assertReadPeople(actor);
    case 'CommsMessage':
    case 'CommsObligation':
      // Server-owned: Comms documents flow only through the Comms module's own
      // endpoints (the generic /documents surface refuses them). Fail closed.
      throw new ValidationError('Comms documents are managed by the Comms module.');
    default:
      // A forgotten future owner type must never silently inherit a read gate.
      throw new ValidationError(`Unhandled document owner type: ${ownerType as string}`);
  }
}

/** The owner record must exist (tenant-scoped read = RLS enforced). */
async function requireOwner(p: Persistence, actor: Actor, ownerType: DocumentOwnerType, ownerId: string): Promise<void> {
  const reads = p.reads.forActor(actor);
  let found: unknown;
  switch (ownerType) {
    case 'Agreement': found = await reads.getAgreementById(ownerId); break;
    case 'Mission': found = await reads.getMissionById(ownerId); break;
    case 'Person': found = await reads.getPersonById(ownerId); break;
    case 'Credential': found = await reads.getCredentialById(ownerId); break;
    case 'Invoice': found = await reads.getInvoiceById(ownerId); break;
    case 'Claim': found = await reads.getClaimById(ownerId); break;
    case 'Entity': found = await reads.getEntityById(ownerId); break;
    // Server-owned Comms ids are NEVER looked up in the entity table (the old
    // `else`); the generic attach path never reaches here (endpoint refuses +
    // assertReadOwner throws). Explicit fail-closed arm.
    case 'CommsMessage':
    case 'CommsObligation':
      found = null; break;
    default:
      found = null;
  }
  if (!found) throw new NotFoundError(ownerType, ownerId);
}

/** List an owner record's ACTIVE documents (newest first). */
export async function listDocuments(p: Persistence, actor: Actor, ownerType: DocumentOwnerType, ownerId: string): Promise<C3Document[]> {
  assertReadOwner(actor, ownerType);
  // Claim receipts are RECORD-scoped: the submitter or finance standing —
  // the guard both 404s missing claims and forbids other submitters' claims.
  if (ownerType === 'Claim') await claimReadGuard(p, actor, ownerId);
  else await requireOwner(p, actor, ownerType, ownerId);
  return p.reads.forActor(actor).listDocuments(ownerType, ownerId);
}

/** Resolve one ACTIVE document for download — the owner's read gate applies. */
export async function getDocumentForDownload(p: Persistence, actor: Actor, documentId: string): Promise<C3Document> {
  // Resolve first (tenant-RLS-safe), THEN dispatch on the resolved owner type.
  // The former standalone assertReadPeople baseline was a universal no-op
  // (canReadPeople is true for every role), so removing it is behavior-neutral
  // for the 7 existing types — and it ensures a Comms attachment can NEVER ride
  // the people-read baseline: assertReadOwner throws for the Comms types.
  const doc = await p.writes.transaction(actor, (tx) => tx.getDocument(documentId));
  if (!doc) throw new NotFoundError('Document', documentId);
  assertReadOwner(actor, doc.ownerType);
  if (doc.ownerType === 'Claim') await claimReadGuard(p, actor, doc.ownerId);
  return doc;
}

/** Register the metadata AFTER the bytes landed in storage (owner/operations). */
export async function attachDocument(
  p: Persistence,
  actor: Actor,
  input: DocumentAttachInput,
  opts?: {
    /**
     * HARDEN-3.5 B (site 4): a byte that becomes a KNOWN orphan the instant this attach commits
     * (the redundant intake-quarantine copy) is armed IN THE SAME TX — attach commits ⟺ its
     * cleanup is durable; a rollback leaves neither the doc row nor a stray armed record.
     */
    armOrphanInTx?: { storageKey: string; blobClass: 'intake' };
  },
): Promise<C3Document> {
  assertSubmitApproval(actor);
  const parsed = documentAttachInputSchema.parse(input);
  await requireOwner(p, actor, parsed.ownerType, parsed.ownerId);

  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('document');
    const documentId = formatDocumentId(seq);
    const doc = await tx.insertDocument({
      documentId,
      ownerType: parsed.ownerType,
      ownerId: parsed.ownerId,
      fileName: parsed.fileName,
      contentType: parsed.contentType,
      sizeBytes: parsed.sizeBytes,
      sha256: parsed.sha256,
      label: parsed.label,
      storageKey: parsed.storageKey,
      uploadedBy: actor.identity,
    });
    // B: the blob is now referenced by this committed document row — resolve its PREPARED
    // compensation intent IN THIS TX. rowCount===1 enforced in persistence: every caller
    // pre-registers, and a zombie registration (intent already armed/swept) ABORTS here.
    await tx.resolveCompensationIntent(parsed.storageKey);
    if (opts?.armOrphanInTx) {
      // 'quarantine_cleanup': the key's upload episode already RESOLVED at the claim — this is
      // its second, independent episode (armed-at-birth; unique per (tenant, key, reason)).
      await tx.insertBlobTombstone({ ...opts.armOrphanInTx, reason: 'quarantine_cleanup' });
    }
    await tx.appendAuditEvent({
      entityType: parsed.ownerType,
      entityId: parsed.ownerId,
      action: 'DocumentAttached',
      actor: actor.identity,
      before: null,
      after: { documentId, fileName: parsed.fileName, contentType: parsed.contentType, sizeBytes: parsed.sizeBytes, sha256: parsed.sha256, label: parsed.label },
    });
    return doc;
  });
}

/** Soft-remove (owner/operations), version-guarded; bytes retained, unreachable. */
export async function removeDocument(p: Persistence, actor: Actor, documentId: string, expectedVersion: number): Promise<C3Document> {
  assertSubmitApproval(actor);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getDocument(documentId);
    if (!current) throw new NotFoundError('Document', documentId);

    const removed = await tx.deactivateDocument(documentId, expectedVersion);
    if (!removed) throw new ConcurrencyError('Document', documentId);

    await tx.appendAuditEvent({
      entityType: current.ownerType,
      entityId: current.ownerId,
      action: 'DocumentRemoved',
      actor: actor.identity,
      before: { documentId, fileName: current.fileName, sha256: current.sha256 },
      after: { documentId, isActive: false },
    });
    return removed;
  });
}
