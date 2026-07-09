/**
 * agreementTermOps — the DIRECT-BUT-AUDITED financial terms of an agreement
 * (Finance Sprint 3). Terms are money detail hung on a governed parent (the
 * per-diem posture): owner/operations write; the read is gated to
 * canViewFinancials. The agreement's MATERIAL lifecycle stays governed.
 *
 * Every write is version-guarded and audited in the SAME transaction as the
 * mutation. `assertTermShape` (one domain rule, shared by add + update) plus
 * the DB CHECK in migration 0019 guarantee the per-kind shape. Kind is
 * immutable — to change it, remove the term and add another.
 *
 * Writes require the parent agreement to exist AND be Active: a terminated
 * agreement's terms are frozen historical record.
 */
import {
  type Actor,
  type AgreementTerm,
  type AgreementTermCreateInput,
  type AgreementTermUpdateInput,
  type TermValues,
  agreementTermCreateInputSchema,
  agreementTermUpdateInputSchema,
  assertTermShape,
  ConcurrencyError,
  ConflictError,
  formatAgreementTermId,
  NotFoundError,
} from '@c3web/domain';
import { assertReadAgreements, assertSubmitApproval, assertViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

/** The financial terms of an agreement (read; canViewFinancials only). */
export async function listAgreementTerms(p: Persistence, actor: Actor, agreementId: string): Promise<AgreementTerm[]> {
  assertReadAgreements(actor);
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);
  const agreement = await reads.getAgreementById(agreementId);
  if (!agreement) throw new NotFoundError('Agreement', agreementId);
  return reads.listAgreementTerms(agreementId);
}

/** Add a financial term to an agreement (owner/operations, direct-audited). */
export async function addAgreementTerm(
  p: Persistence,
  actor: Actor,
  agreementId: string,
  input: AgreementTermCreateInput,
): Promise<AgreementTerm> {
  assertSubmitApproval(actor);
  const parsed = agreementTermCreateInputSchema.parse(input);
  const values: TermValues = {
    amountMinor: parsed.amountMinor,
    currency: parsed.currency,
    percentBps: parsed.percentBps,
    label: parsed.label,
  };
  assertTermShape(parsed.kind, values); // throws ValidationError on a bad shape

  return p.writes.transaction(actor, async (tx) => {
    const agreement = await tx.getAgreement(agreementId);
    if (!agreement) throw new NotFoundError('Agreement', agreementId);
    if (agreement.status !== 'Active') {
      throw new ConflictError('Financial terms may only be changed on an active agreement.', {
        agreementId,
        status: agreement.status,
      });
    }

    const seq = await tx.allocateSequence('agreementTerm');
    const termId = formatAgreementTermId(seq);
    const term = await tx.insertAgreementTerm({ termId, agreementId, kind: parsed.kind, ...values });

    await tx.appendAuditEvent({
      entityType: 'Agreement',
      entityId: agreementId,
      action: 'AgreementTermAdded',
      actor: actor.identity,
      before: null,
      after: { termId, kind: parsed.kind, ...values },
    });
    return term;
  });
}

/** Replace a term's value set (kind is immutable), version-guarded + audited. */
export async function updateAgreementTerm(
  p: Persistence,
  actor: Actor,
  agreementId: string,
  termId: string,
  input: AgreementTermUpdateInput,
): Promise<AgreementTerm> {
  assertSubmitApproval(actor);
  const parsed = agreementTermUpdateInputSchema.parse(input);
  const next: TermValues = {
    amountMinor: parsed.amountMinor,
    currency: parsed.currency,
    percentBps: parsed.percentBps,
    label: parsed.label,
  };

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getAgreementTerm(termId);
    if (!current || current.agreementId !== agreementId) throw new NotFoundError('Agreement term', termId);
    const agreement = await tx.getAgreement(agreementId);
    if (!agreement) throw new NotFoundError('Agreement', agreementId);
    if (agreement.status !== 'Active') {
      throw new ConflictError('Financial terms may only be changed on an active agreement.', {
        agreementId,
        status: agreement.status,
      });
    }

    assertTermShape(current.kind, next); // shape validated against the STORED kind

    const updated = await tx.updateAgreementTerm(termId, parsed.expectedVersion, next);
    if (!updated) throw new ConcurrencyError('Agreement term', termId);

    await tx.appendAuditEvent({
      entityType: 'Agreement',
      entityId: agreementId,
      action: 'AgreementTermUpdated',
      actor: actor.identity,
      before: { termId, amountMinor: current.amountMinor, currency: current.currency, percentBps: current.percentBps, label: current.label },
      after: { termId, ...next },
    });
    return updated;
  });
}

/** Soft-remove a term (owner/operations), version-guarded + audited. */
export async function removeAgreementTerm(
  p: Persistence,
  actor: Actor,
  agreementId: string,
  termId: string,
  expectedVersion: number,
): Promise<AgreementTerm> {
  assertSubmitApproval(actor);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getAgreementTerm(termId);
    if (!current || current.agreementId !== agreementId) throw new NotFoundError('Agreement term', termId);
    const agreement = await tx.getAgreement(agreementId);
    if (!agreement) throw new NotFoundError('Agreement', agreementId);
    if (agreement.status !== 'Active') {
      throw new ConflictError('Financial terms may only be changed on an active agreement.', {
        agreementId,
        status: agreement.status,
      });
    }

    const removed = await tx.deactivateAgreementTerm(termId, expectedVersion);
    if (!removed) throw new ConcurrencyError('Agreement term', termId);

    await tx.appendAuditEvent({
      entityType: 'Agreement',
      entityId: agreementId,
      action: 'AgreementTermRemoved',
      actor: actor.identity,
      before: { termId, kind: current.kind, amountMinor: current.amountMinor, currency: current.currency, percentBps: current.percentBps, label: current.label },
      after: { termId, isActive: false },
    });
    return removed;
  });
}
