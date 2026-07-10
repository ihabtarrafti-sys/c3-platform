/**
 * distributionOps — S8: allocate a Received income line into the payout list.
 *
 * Posture: DIRECT-BUT-AUDITED (the S6/S2 finance standing). Gates: writes
 * assertManageMissions + assertViewFinancials; reads assertViewFinancials
 * (payout lists are money).
 *
 * CREATE runs the domain allocator (org cut + shares == pool EXACTLY) inside
 * one transaction: head + share rows + audit. The line must be a Received
 * ACTIVE income line of the named mission; the pool is what actually landed
 * (receivedAmountMinor ?? amountMinor); one LIVE distribution per line (the
 * partial-unique index backstops the friendly check).
 *
 * SEEDS come from the mission's team roster joined with each member's ACTIVE
 * agreements' PrizeSharePersonal terms — suggestions only; the human edits.
 *
 * REVOKE (reason mandatory) is legal only while every payout is Pending —
 * once money moved, corrections happen per payout row (Paid → Pending is an
 * audited correction), never by erasing the allocation.
 */
import {
  type Actor,
  type CreateDistributionInput,
  type Distribution,
  type DistributionSeedRow,
  type DistributionShare,
  type MarkPayoutInput,
  allocateDistribution,
  ConcurrencyError,
  ConflictError,
  createDistributionInputSchema,
  formatDistributionId,
  markPayoutInputSchema,
  NotFoundError,
  ValidationError,
} from '@c3web/domain';
import { assertManageMissions, assertReadPeople, assertViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

export interface DistributionView {
  readonly distribution: Distribution;
  readonly shares: readonly DistributionShare[];
}

export async function listMissionDistributions(p: Persistence, actor: Actor, missionId: string): Promise<DistributionView[]> {
  assertReadPeople(actor);
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);
  const heads = await reads.listDistributionsForMission(missionId);
  return Promise.all(heads.map(async (d) => ({ distribution: d, shares: await reads.listDistributionShares(d.distributionId) })));
}

export async function getDistribution(p: Persistence, actor: Actor, distributionId: string): Promise<DistributionView> {
  assertReadPeople(actor);
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);
  const distribution = await reads.getDistributionById(distributionId);
  if (!distribution) throw new NotFoundError('Distribution', distributionId);
  return { distribution, shares: await reads.listDistributionShares(distributionId) };
}

/** Seed rows: the mission's team roster + PrizeSharePersonal term suggestions. */
export async function getDistributionSeed(p: Persistence, actor: Actor, missionId: string): Promise<DistributionSeedRow[]> {
  assertReadPeople(actor);
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);
  const mission = await reads.getMissionById(missionId);
  if (!mission) throw new NotFoundError('Mission', missionId);
  if (!mission.teamId) return [];

  const members = (await reads.listTeamMembers(mission.teamId)).filter((m) => m.isActive);
  return Promise.all(
    members.map(async (m) => {
      const agreements = (await reads.listAgreementsForPerson(m.personId)).filter((a) => a.status === 'Active');
      for (const a of agreements) {
        const term = (await reads.listAgreementTerms(a.agreementId)).find((t) => t.kind === 'PrizeSharePersonal' && t.percentBps !== null);
        if (term) return { personId: m.personId, personName: m.personName, suggestedBps: term.percentBps, sourceTermId: term.termId };
      }
      return { personId: m.personId, personName: m.personName, suggestedBps: null, sourceTermId: null };
    }),
  );
}

export async function createDistribution(p: Persistence, actor: Actor, input: CreateDistributionInput): Promise<DistributionView> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const parsed = createDistributionInputSchema.parse(input);

  // Every share row must name a real person (RLS-scoped read, friendly 404).
  const reads = p.reads.forActor(actor);
  for (const s of parsed.shares) {
    if (!(await reads.getPersonById(s.personId))) throw new NotFoundError('Person', s.personId);
  }
  // Friendly one-live-per-line check (the partial-unique index is the backstop).
  const existing = (await reads.listDistributionsForMission(parsed.missionId)).find((d) => d.lineId === parsed.lineId && d.status === 'Live');
  if (existing) {
    throw new ConflictError('This line already has a live distribution — revoke it first to re-allocate.', {
      lineId: parsed.lineId,
      distributionId: existing.distributionId,
    });
  }

  return p.writes.transaction(actor, async (tx) => {
    const mission = await tx.getMission(parsed.missionId);
    if (!mission) throw new NotFoundError('Mission', parsed.missionId);
    if (!mission.isActive) throw new ConflictError('This mission is retired — its money is frozen.', { missionId: parsed.missionId });

    const line = await tx.getMissionLine(parsed.lineId);
    if (!line || line.missionId !== parsed.missionId) throw new NotFoundError('Mission line', parsed.lineId);
    if (line.direction !== 'Income') throw new ValidationError('Distributions allocate INCOME — expenses are paid, not split.', { lineId: parsed.lineId });
    if (line.paymentStatus !== 'Received') {
      throw new ConflictError('Only RECEIVED money is distributed — record the receipt on the line first.', { lineId: parsed.lineId, paymentStatus: line.paymentStatus });
    }

    const pool = line.receivedAmountMinor ?? line.amountMinor;
    const { orgCutMinor, rows } = allocateDistribution(pool, parsed.orgShareBps, parsed.shares);

    const distributionId = formatDistributionId(await tx.allocateSequence('distribution'));
    const head = await tx.insertDistribution({
      distributionId,
      missionId: parsed.missionId,
      lineId: parsed.lineId,
      poolMinor: pool,
      currency: line.currency,
      orgShareBps: parsed.orgShareBps,
      orgCutMinor,
      notes: parsed.notes,
      createdBy: actor.identity,
    });
    for (const r0 of rows) {
      await tx.insertDistributionShare({ distributionId, personId: r0.personId, shareBps: r0.shareBps, amountMinor: r0.amountMinor });
    }

    await tx.appendAuditEvent({
      entityType: 'Distribution',
      entityId: distributionId,
      action: 'DistributionCreated',
      actor: actor.identity,
      before: null,
      after: {
        distributionId,
        missionId: parsed.missionId,
        lineId: parsed.lineId,
        poolMinor: pool,
        currency: line.currency,
        orgShareBps: parsed.orgShareBps,
        orgCutMinor,
        shares: rows.map((r0) => ({ personId: r0.personId, shareBps: r0.shareBps, amountMinor: r0.amountMinor })),
      },
    });
    await tx.appendAuditEvent({
      entityType: 'Mission',
      entityId: parsed.missionId,
      action: 'DistributionCreated',
      actor: actor.identity,
      before: null,
      after: { distributionId, lineId: parsed.lineId, poolMinor: pool, currency: line.currency },
    });

    const shares = await tx.listDistributionSharesTx(distributionId);
    return { distribution: head, shares };
  });
}

export async function revokeDistribution(p: Persistence, actor: Actor, distributionId: string, reason: string, expectedVersion: number): Promise<DistributionView> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const trimmed = reason.trim();
  if (trimmed === '') throw new ValidationError('A revoke reason is required.', { distributionId });

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getDistribution(distributionId);
    if (!current) throw new NotFoundError('Distribution', distributionId);
    const shares = await tx.listDistributionSharesTx(distributionId);
    if (shares.some((s) => s.payoutStatus === 'Paid')) {
      throw new ConflictError('Payouts have already been made — correct the individual payout rows instead of revoking the allocation.', { distributionId });
    }

    const revoked = await tx.revokeDistribution(distributionId, expectedVersion, trimmed);
    if (!revoked) throw new ConcurrencyError('Distribution', distributionId);

    await tx.appendAuditEvent({
      entityType: 'Distribution',
      entityId: distributionId,
      action: 'DistributionRevoked',
      actor: actor.identity,
      before: { status: 'Live' },
      after: { status: 'Revoked', reason: trimmed },
    });
    return { distribution: revoked, shares };
  });
}

export async function markPayout(
  p: Persistence,
  actor: Actor,
  distributionId: string,
  personId: string,
  input: MarkPayoutInput,
): Promise<DistributionShare> {
  assertManageMissions(actor);
  assertViewFinancials(actor);
  const parsed = markPayoutInputSchema.parse(input);
  if (parsed.paid && !parsed.paymentSourceLabel) {
    throw new ValidationError('A payment-source LABEL is required when marking a payout paid (never an account number).', { distributionId, personId });
  }

  return p.writes.transaction(actor, async (tx) => {
    const head = await tx.getDistribution(distributionId);
    if (!head) throw new NotFoundError('Distribution', distributionId);
    if (head.status !== 'Live') throw new ConflictError('This distribution was revoked — its payouts are frozen.', { distributionId });
    const current = await tx.getDistributionShare(distributionId, personId);
    if (!current) throw new NotFoundError('Payout row', `${distributionId}/${personId}`);

    const flipped = await tx.setPayout(distributionId, personId, parsed.expectedVersion, {
      payoutStatus: parsed.paid ? 'Paid' : 'Pending',
      paidOn: parsed.paid ? new Date().toISOString().slice(0, 10) : null,
      paymentSourceLabel: parsed.paid ? parsed.paymentSourceLabel : null,
      refNo: parsed.paid ? parsed.refNo : null,
    });
    if (!flipped) throw new ConcurrencyError('Payout row', `${distributionId}/${personId}`);

    await tx.appendAuditEvent({
      entityType: 'Distribution',
      entityId: distributionId,
      action: 'PayoutMarked',
      actor: actor.identity,
      before: { personId, payoutStatus: current.payoutStatus },
      after: {
        personId,
        payoutStatus: flipped.payoutStatus,
        amountMinor: flipped.amountMinor,
        paymentSourceLabel: flipped.paymentSourceLabel,
        refNo: flipped.refNo,
      },
    });
    return flipped;
  });
}
