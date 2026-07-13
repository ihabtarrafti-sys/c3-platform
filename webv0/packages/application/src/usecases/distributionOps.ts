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
  // M-04: heads + ALL their shares in two reads (never one query per head).
  const [heads, allShares] = await Promise.all([
    reads.listDistributionsForMission(missionId),
    reads.listDistributionSharesForMission(missionId),
  ]);
  const byHead = new Map<string, DistributionShare[]>();
  for (const s of allShares) {
    const list = byHead.get(s.distributionId) ?? [];
    list.push(s);
    byHead.set(s.distributionId, list);
  }
  return heads.map((d) => ({ distribution: d, shares: byHead.get(d.distributionId) ?? [] }));
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
  // M-04: ONE query fetches every candidate term for the whole roster
  // (previously member × agreement × term nested reads). First hit per person
  // wins, in agreement order — the same suggestion the nested walk produced.
  const candidates = await reads.listPrizeShareTermsForPeople(members.map((m) => m.personId));
  const firstByPerson = new Map<string, { termId: string; percentBps: number }>();
  for (const c of candidates) {
    if (!firstByPerson.has(c.personId)) firstByPerson.set(c.personId, { termId: c.termId, percentBps: c.percentBps });
  }
  return members.map((m) => {
    const hit = firstByPerson.get(m.personId);
    return hit
      ? { personId: m.personId, personName: m.personName, suggestedBps: hit.percentBps, sourceTermId: hit.termId }
      : { personId: m.personId, personName: m.personName, suggestedBps: null, sourceTermId: null };
  });
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
    // R2-N03: acquire the mission HEAD lock BEFORE the source lines — the same
    // order settlement uses (mission → lines). Reading the head unlocked and then
    // locking lines (while the insert's FK also key-share-locks the mission) was a
    // reachable deadlock cycle against a concurrent settlement.
    const mission = await tx.getMissionForUpdate(parsed.missionId);
    if (!mission) throw new NotFoundError('Mission', parsed.missionId);
    if (!mission.isActive) throw new ConflictError('This mission is retired — its money is frozen.', { missionId: parsed.missionId });

    // HARDEN-1 H-05: LOCK the source line before snapshotting the pool — a
    // concurrent receipt edit can no longer slip between the read and the
    // insert (and the 0034 trigger freezes the line while the head is Live).
    const lockedLines = await tx.listMissionLinesTxLocked(parsed.missionId);
    const line = lockedLines.find((l) => l.lineId === parsed.lineId && l.isActive);
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
    // HARDEN-1 H-05: revoke and payout serialize on the SAME head lock —
    // the revoke-vs-pay race (Revoked head with a Paid share) is closed here
    // and made unrepresentable by the 0034 trigger.
    const current = await tx.lockDistribution(distributionId);
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
    // HARDEN-1 H-05: the payout flip holds the head lock, so a concurrent
    // revoke waits behind it (and vice versa).
    const head = await tx.lockDistribution(distributionId);
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
