/**
 * subscriptionOps — recurring subscriptions (Track B). Direct-but-audited CRUD
 * (the entity/mission-shell mould): create / update (partial patch) / cancel /
 * reactivate, version-guarded, audit in the SAME transaction, update images
 * restricted to the changed fields. READ is finance-gated (org cost data);
 * MANAGE is owner/operations. No payment credentials — vendor NAME + amount only.
 */
import {
  type Actor,
  type Subscription,
  type SubscriptionCreateInput,
  type SubscriptionUpdateInput,
  subscriptionCreateInputSchema,
  subscriptionUpdateInputSchema,
  formatSubscriptionId,
  ConcurrencyError,
  ConflictError,
  NotFoundError,
} from '@c3web/domain';
import { assertManageSubscriptions, assertViewFinancials } from '@c3web/authz';
import type { SubscriptionPatch, Persistence } from '../ports';

const EDITABLE = ['name', 'vendorName', 'amountMinor', 'currency', 'cadence', 'category', 'startedOn', 'nextRenewalOn', 'notes'] as const;

export async function listSubscriptions(p: Persistence, actor: Actor): Promise<Subscription[]> {
  assertViewFinancials(actor); // cost data — owner/ops/finance/management may view
  return p.reads.forActor(actor).listSubscriptions();
}

export async function createSubscription(p: Persistence, actor: Actor, input: SubscriptionCreateInput): Promise<Subscription> {
  assertManageSubscriptions(actor);
  const parsed = subscriptionCreateInputSchema.parse(input);
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('subscription');
    const subscriptionId = formatSubscriptionId(seq);
    const sub = await tx.insertSubscription(subscriptionId, {
      name: parsed.name,
      vendorName: parsed.vendorName,
      amountMinor: parsed.amountMinor,
      currency: parsed.currency,
      cadence: parsed.cadence,
      category: parsed.category,
      startedOn: parsed.startedOn,
      nextRenewalOn: parsed.nextRenewalOn,
      notes: parsed.notes,
    });
    await tx.appendAuditEvent({
      entityType: 'Subscription',
      entityId: subscriptionId,
      action: 'SubscriptionCreated',
      actor: actor.identity,
      before: null,
      after: { name: parsed.name, vendorName: parsed.vendorName, amountMinor: parsed.amountMinor, currency: parsed.currency, cadence: parsed.cadence },
    });
    return sub;
  });
}

export async function updateSubscription(p: Persistence, actor: Actor, subscriptionId: string, input: SubscriptionUpdateInput): Promise<Subscription> {
  assertManageSubscriptions(actor);
  const parsed = subscriptionUpdateInputSchema.parse(input);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getSubscription(subscriptionId);
    if (!current) throw new NotFoundError('Subscription', subscriptionId);

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
    if (Object.keys(patch).length === 0) return current;

    const updated = await tx.updateSubscription(subscriptionId, parsed.expectedVersion, patch as SubscriptionPatch);
    if (!updated) throw new ConcurrencyError('Subscription', subscriptionId);
    await tx.appendAuditEvent({ entityType: 'Subscription', entityId: subscriptionId, action: 'SubscriptionUpdated', actor: actor.identity, before, after });
    return updated;
  });
}

export async function cancelSubscription(p: Persistence, actor: Actor, subscriptionId: string, expectedVersion: number): Promise<Subscription> {
  assertManageSubscriptions(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getSubscription(subscriptionId);
    if (!current) throw new NotFoundError('Subscription', subscriptionId);
    if (current.status === 'Cancelled') throw new ConflictError('The subscription is already cancelled.');
    const updated = await tx.setSubscriptionStatus(subscriptionId, expectedVersion, 'Cancelled');
    if (!updated) throw new ConcurrencyError('Subscription', subscriptionId);
    await tx.appendAuditEvent({ entityType: 'Subscription', entityId: subscriptionId, action: 'SubscriptionCancelled', actor: actor.identity, before: { status: 'Active' }, after: { status: 'Cancelled' } });
    return updated;
  });
}

export async function reactivateSubscription(p: Persistence, actor: Actor, subscriptionId: string, expectedVersion: number): Promise<Subscription> {
  assertManageSubscriptions(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getSubscription(subscriptionId);
    if (!current) throw new NotFoundError('Subscription', subscriptionId);
    if (current.status === 'Active') throw new ConflictError('The subscription is already active.');
    const updated = await tx.setSubscriptionStatus(subscriptionId, expectedVersion, 'Active');
    if (!updated) throw new ConcurrencyError('Subscription', subscriptionId);
    await tx.appendAuditEvent({ entityType: 'Subscription', entityId: subscriptionId, action: 'SubscriptionReactivated', actor: actor.identity, before: { status: 'Cancelled' }, after: { status: 'Active' } });
    return updated;
  });
}
