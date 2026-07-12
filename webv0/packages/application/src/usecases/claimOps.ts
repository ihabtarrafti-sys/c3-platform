/**
 * claimOps — S9: the expense-claim lifecycle. Retires the Finance
 * Intelligence Hub (MS Form → Excel log → hand-flipped Status cells).
 *
 *   Submitted → InReview → Approved → Paid, or Rejected (reason mandatory).
 *
 * Gates: SUBMIT = any non-read-only role (staff get money back). DECIDE and
 * PAY = finance standing (owner/operations with financial visibility) — and
 * NEVER the submitter (checkSelfReview, the pipeline's separation law).
 * READS are per-actor: everyone sees their OWN claims; finance-standing
 * roles see all.
 *
 * Receipts ride the S4 document path (owner type 'Claim'); the read guard
 * for claim documents lives here (claimReadGuard) because it needs the
 * record: the submitter reads their own receipts, finance reads all.
 */
import {
  type Actor,
  type Claim,
  type DecideClaimInput,
  type PayClaimInput,
  type SubmitClaimInput,
  canClaimTransition,
  ConcurrencyError,
  ConflictError,
  decideClaimInputSchema,
  ForbiddenError,
  formatClaimId,
  NotFoundError,
  payClaimInputSchema,
  submitClaimInputSchema,
} from '@c3web/domain';
import { assertDecideClaim, assertReadClaims, assertSubmitClaim, canViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

/** Submitters see their own claims; finance-standing roles (finance/management) see all (M-12). */
export async function listClaims(p: Persistence, actor: Actor): Promise<Claim[]> {
  assertReadClaims(actor); // read-only NON-finance roles have no claims surface at all
  const reads = p.reads.forActor(actor);
  return canViewFinancials(actor.role) ? reads.listClaims() : reads.listClaimsForSubmitter(actor.identity);
}

export async function getClaim(p: Persistence, actor: Actor, claimId: string): Promise<Claim> {
  assertReadClaims(actor);
  const claim = await p.reads.forActor(actor).getClaimById(claimId);
  if (!claim) throw new NotFoundError('Claim', claimId);
  if (claim.submittedBy !== actor.identity && !canViewFinancials(actor.role)) {
    // Truthful denial without existence-leaking across staff: your role sees
    // its own claims only.
    throw new ForbiddenError('This claim belongs to another submitter.', { claimId });
  }
  return claim;
}

/** The document-read guard for Claim-owned receipts (needs the record). */
export async function claimReadGuard(p: Persistence, actor: Actor, claimId: string): Promise<void> {
  await getClaim(p, actor, claimId);
}

export async function submitClaim(p: Persistence, actor: Actor, input: SubmitClaimInput): Promise<Claim> {
  assertSubmitClaim(actor);
  const parsed = submitClaimInputSchema.parse(input);
  const reads = p.reads.forActor(actor);
  if (parsed.personId && !(await reads.getPersonById(parsed.personId))) throw new NotFoundError('Person', parsed.personId);
  if (parsed.missionId && !(await reads.getMissionById(parsed.missionId))) throw new NotFoundError('Mission', parsed.missionId);

  return p.writes.transaction(actor, async (tx) => {
    const claimId = formatClaimId(await tx.allocateSequence('claim'));
    const claim = await tx.insertClaim({
      claimId,
      submittedBy: actor.identity,
      personId: parsed.personId,
      missionId: parsed.missionId,
      category: parsed.category,
      description: parsed.description,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
      expenseOn: parsed.expenseOn,
    });
    await tx.appendAuditEvent({
      entityType: 'Claim',
      entityId: claimId,
      action: 'ClaimSubmitted',
      actor: actor.identity,
      before: null,
      after: { claimId, category: parsed.category, amountMinor: parsed.amountMinor, currency: parsed.currency, expenseOn: parsed.expenseOn },
    });
    return claim;
  });
}

export async function decideClaim(p: Persistence, actor: Actor, claimId: string, input: DecideClaimInput): Promise<Claim> {
  const parsed = decideClaimInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getClaim(claimId);
    if (!current) throw new NotFoundError('Claim', claimId);
    assertDecideClaim(actor, current.submittedBy);

    const to = parsed.decision === 'beginReview' ? 'InReview' : parsed.decision === 'approve' ? 'Approved' : 'Rejected';
    if (!canClaimTransition(current.status, to)) {
      throw new ConflictError(`A ${current.status} claim cannot move to ${to}.`, { claimId, from: current.status, to });
    }

    const updated = await tx.updateClaim(claimId, parsed.expectedVersion, {
      status: to,
      reviewedBy: actor.identity,
      rejectionReason: to === 'Rejected' ? parsed.reason : null,
    });
    if (!updated) throw new ConcurrencyError('Claim', claimId);

    await tx.appendAuditEvent({
      entityType: 'Claim',
      entityId: claimId,
      action: to === 'InReview' ? 'ClaimReviewStarted' : to === 'Approved' ? 'ClaimApproved' : 'ClaimRejected',
      actor: actor.identity,
      before: { status: current.status },
      after: { status: to, ...(to === 'Rejected' ? { reason: parsed.reason } : {}) },
    });
    return updated;
  });
}

export async function payClaim(p: Persistence, actor: Actor, claimId: string, input: PayClaimInput): Promise<Claim> {
  const parsed = payClaimInputSchema.parse(input);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getClaim(claimId);
    if (!current) throw new NotFoundError('Claim', claimId);
    assertDecideClaim(actor, current.submittedBy);
    if (!canClaimTransition(current.status, 'Paid')) {
      throw new ConflictError(`A ${current.status} claim cannot be paid — approve it first.`, { claimId, from: current.status });
    }

    const paidOn = new Date().toISOString().slice(0, 10);
    const updated = await tx.updateClaim(claimId, parsed.expectedVersion, {
      status: 'Paid',
      paidOn,
      paymentSourceLabel: parsed.paymentSourceLabel,
      refNo: parsed.refNo,
    });
    if (!updated) throw new ConcurrencyError('Claim', claimId);

    await tx.appendAuditEvent({
      entityType: 'Claim',
      entityId: claimId,
      action: 'ClaimPaid',
      actor: actor.identity,
      before: { status: current.status },
      after: { status: 'Paid', paidOn, paymentSourceLabel: parsed.paymentSourceLabel, refNo: parsed.refNo, amountMinor: current.amountMinor, currency: current.currency },
    });
    return updated;
  });
}
