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
} from '@c3web/domain';
import { assertReadAgreements, assertReadPeople, assertSubmitApproval, assertViewFinancials } from '@c3web/authz';
import { claimReadGuard } from './claimOps';
import type { Persistence } from '../ports';

/** The read gate follows the OWNING record (an agreement's PDF is agreement
 *  data; an invoice's PDF carries money — the finance gate applies). */
function assertReadOwner(actor: Actor, ownerType: DocumentOwnerType): void {
  if (ownerType === 'Agreement') assertReadAgreements(actor);
  else if (ownerType === 'Invoice') assertViewFinancials(actor);
  else if (ownerType === 'Claim') return; // record-scoped: claimReadGuard runs where the ownerId is known
  else assertReadPeople(actor);
}

/** The owner record must exist (tenant-scoped read = RLS enforced). */
async function requireOwner(p: Persistence, actor: Actor, ownerType: DocumentOwnerType, ownerId: string): Promise<void> {
  const reads = p.reads.forActor(actor);
  const found =
    ownerType === 'Agreement'
      ? await reads.getAgreementById(ownerId)
      : ownerType === 'Mission'
        ? await reads.getMissionById(ownerId)
        : ownerType === 'Person'
          ? await reads.getPersonById(ownerId)
          : ownerType === 'Credential'
            ? await reads.getCredentialById(ownerId)
            : ownerType === 'Invoice'
              ? await reads.getInvoiceById(ownerId)
              : ownerType === 'Claim'
                ? await reads.getClaimById(ownerId)
                : await reads.getEntityById(ownerId);
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
  assertReadPeople(actor); // baseline; the owner-type gate follows the lookup
  const doc = await p.writes.transaction(actor, (tx) => tx.getDocument(documentId));
  if (!doc) throw new NotFoundError('Document', documentId);
  assertReadOwner(actor, doc.ownerType);
  if (doc.ownerType === 'Claim') await claimReadGuard(p, actor, doc.ownerId);
  return doc;
}

/** Register the metadata AFTER the bytes landed in storage (owner/operations). */
export async function attachDocument(p: Persistence, actor: Actor, input: DocumentAttachInput): Promise<C3Document> {
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
    // R5-N04: the blob is now referenced by this committed document row — resolve its
    // write-ahead compensation intent IN THIS TX (a no-op for callers that didn't pre-register).
    await tx.resolveCompensationIntent(parsed.storageKey);
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
