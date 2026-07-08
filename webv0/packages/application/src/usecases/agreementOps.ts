/**
 * agreementOps — the direct-but-audited NON-MATERIAL agreement update
 * (Sprint 41). Code, type, linkage, and notes are operational record-keeping:
 * version-guarded, changed-fields-only audit images, same-transaction audit.
 * Dates and value are MATERIAL terms — they are not even representable here
 * (the schema is strict) and move only through the governed operations.
 *
 * Gate: owner/operations (deliberately the same roles that may request
 * material changes — assertSubmitApproval is the shared owner/ops gate).
 */
import {
  type Actor,
  type Agreement,
  type AgreementUpdateInput,
  agreementUpdateInputSchema,
  ConcurrencyError,
  NotFoundError,
  ValidationError,
} from '@c3web/domain';
import { assertSubmitApproval } from '@c3web/authz';
import type { AgreementPatch, Persistence } from '../ports';

const EDITABLE = ['agreementCode', 'agreementType', 'linkedAgreementId', 'notes'] as const;

export async function updateAgreement(
  p: Persistence,
  actor: Actor,
  agreementId: string,
  input: AgreementUpdateInput,
): Promise<Agreement> {
  assertSubmitApproval(actor);
  const parsed = agreementUpdateInputSchema.parse(input);

  // Linkage integrity, friendly (the composite FK is authoritative):
  // the parent must exist and an agreement may never link to itself.
  if (parsed.linkedAgreementId) {
    if (parsed.linkedAgreementId === agreementId) {
      throw new ValidationError('An agreement cannot be linked to itself.', { agreementId });
    }
    const parent = await p.reads.forActor(actor).getAgreementById(parsed.linkedAgreementId);
    if (!parent) throw new NotFoundError('Linked agreement', parsed.linkedAgreementId);
  }

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getAgreement(agreementId);
    if (!current) throw new NotFoundError('Agreement', agreementId);

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

    const updated = await tx.updateAgreement(agreementId, parsed.expectedVersion, patch as AgreementPatch);
    if (!updated) throw new ConcurrencyError('Agreement', agreementId);

    await tx.appendAuditEvent({
      entityType: 'Agreement',
      entityId: agreementId,
      action: 'AgreementUpdated',
      actor: actor.identity,
      before,
      after,
    });
    return updated;
  });
}
