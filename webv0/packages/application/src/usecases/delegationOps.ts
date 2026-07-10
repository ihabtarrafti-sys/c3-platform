/**
 * delegationOps — Tier 0.5 approver delegation: the owner grants review+
 * execute standing AS ONE UNIT to a named ACTIVE member for a bounded window.
 * Direct-but-audited owner act (a governed grant would wedge single-owner
 * tenants — no second approver exists to approve the delegation that creates
 * one). Separation of duties is NOT delegable; rows are history, never deleted.
 */
import {
  type Actor,
  ConflictError,
  createDelegationSchema,
  type CreateDelegationInput,
  type Delegation,
  formatDelegationId,
  isDelegationActive,
  NotFoundError,
  revokeDelegationSchema,
  ValidationError,
  ConcurrencyError,
} from '@c3web/domain';
import { assertManageDelegations, canReviewApproval } from '@c3web/authz';
import type { Persistence, WriteTx } from '../ports';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

export async function listDelegations(p: Persistence, actor: Actor): Promise<Delegation[]> {
  assertManageDelegations(actor);
  return p.reads.forActor(actor).listDelegations();
}

export async function createDelegation(p: Persistence, actor: Actor, input: CreateDelegationInput): Promise<Delegation> {
  assertManageDelegations(actor);
  const parsed = createDelegationSchema.parse(input);

  if (parsed.granteeIdentity === actor.identity.toLowerCase()) {
    throw new ValidationError('You already hold review standing — delegating to yourself is meaningless.', {
      field: 'granteeIdentity',
    });
  }

  // The grantee must be an ACTIVE member — and one whose ROLE does not
  // already carry review standing (such a grant is probably a mistake).
  const members = await p.reads.forActor(actor).listMembers();
  const member = members.find((m) => m.email.toLowerCase() === parsed.granteeIdentity);
  if (!member || !member.isActive) {
    throw new ValidationError(`'${parsed.granteeIdentity}' is not an active member of this organization.`, {
      field: 'granteeIdentity',
    });
  }
  if (canReviewApproval(member.role)) {
    throw new ValidationError(`'${parsed.granteeIdentity}' already holds review standing by role (${member.role}).`, {
      field: 'granteeIdentity',
    });
  }

  // One UNREVOKED delegation per grantee — friendly refusal here; the DB
  // partial-unique index remains the hard law under any race.
  const existing = await p.reads.forActor(actor).findUnrevokedDelegationId(parsed.granteeIdentity);
  if (existing) {
    throw new ConflictError(`'${parsed.granteeIdentity}' already holds an unrevoked delegation (${existing}). Revoke it first.`);
  }

  return p.writes.transaction(actor, async (tx: WriteTx) => {
    const seq = await tx.allocateSequence('delegation');
    const delegationId = formatDelegationId(seq);
    let created: Delegation;
    try {
      created = await tx.insertDelegation({
        delegationId,
        granteeIdentity: parsed.granteeIdentity,
        grantedBy: actor.identity,
        startsOn: parsed.startsOn,
        endsOn: parsed.endsOn,
        reason: parsed.reason,
      });
    } catch (err) {
      if (err instanceof Error && /delegation_one_unrevoked_per_grantee/.test(String(err) + String((err as { cause?: unknown }).cause ?? ''))) {
        throw new ConflictError(`'${parsed.granteeIdentity}' already holds an unrevoked delegation. Revoke it first.`);
      }
      throw err;
    }
    await tx.appendAuditEvent({
      entityType: 'Delegation',
      entityId: delegationId,
      action: 'DelegationGranted',
      actor: actor.identity,
      after: { granteeIdentity: parsed.granteeIdentity, startsOn: parsed.startsOn, endsOn: parsed.endsOn, reason: parsed.reason },
    });
    return created;
  });
}

export async function revokeDelegation(
  p: Persistence,
  actor: Actor,
  delegationId: string,
  input: { expectedVersion: number; reason: string },
): Promise<Delegation> {
  assertManageDelegations(actor);
  const parsed = revokeDelegationSchema.parse(input);

  return p.writes.transaction(actor, async (tx: WriteTx) => {
    const current = await tx.lockDelegation(delegationId);
    if (!current) throw new NotFoundError('Delegation', delegationId);
    if (current.revokedAt !== null) {
      throw new ConflictError(`${delegationId} is already revoked.`);
    }
    const updated = await tx.revokeDelegation(delegationId, parsed.expectedVersion, actor.identity, parsed.reason);
    if (!updated) throw new ConcurrencyError('Delegation', delegationId);
    await tx.appendAuditEvent({
      entityType: 'Delegation',
      entityId: delegationId,
      action: 'DelegationRevoked',
      actor: actor.identity,
      before: { granteeIdentity: current.granteeIdentity, endsOn: current.endsOn },
      after: { revokeReason: parsed.reason },
    });
    return updated;
  });
}

/**
 * The effective-review question, for READ surfaces and /me: role standing OR
 * an active delegation today. Decision/execute paths ask the same question
 * inside their own transaction (see reviewApproval/executeApproval).
 */
export async function hasEffectiveReviewStanding(p: Persistence, actor: Actor): Promise<boolean> {
  if (canReviewApproval(actor.role)) return true;
  return p.reads.forActor(actor).hasActiveDelegation(actor.identity.toLowerCase(), todayIso());
}

export { isDelegationActive };
