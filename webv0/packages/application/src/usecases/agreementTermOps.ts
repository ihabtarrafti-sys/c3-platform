/**
 * agreementTermOps — the READ side of agreement financial terms (Finance S3).
 *
 * Reads are gated to canViewFinancials: legal reads the agreement but the whole
 * terms endpoint is a section-level denial (assertViewFinancials, fail-closed).
 *
 * WRITES are GOVERNED (Finance S3.5): term money is material, so add / edit /
 * remove ride the approval pipeline — see submitAgreementTermOps (submit) and
 * executeApproval (execute). There is no direct term-write use-case.
 */
import { type Actor, type AgreementTerm, NotFoundError } from '@c3web/domain';
import { assertReadAgreements, assertViewFinancials } from '@c3web/authz';
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
