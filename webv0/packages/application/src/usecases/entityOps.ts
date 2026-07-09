/**
 * entityOps — the Entity use-cases (S48). Pure DIRECT-BUT-AUDITED CRUD in the
 * mission-shell mould: create / update (partial patch) / deactivate, role-gated
 * (canManageEntities: owner/operations), version-guarded, audit in the SAME
 * transaction, update audit images restricted to exactly the changed fields.
 *
 * An Entity is one of the tenant company's own legal operating entities per
 * jurisdiction (e.g. a UAE company, a KSA company). People are assigned to the
 * one they signed with; agreements sit under one. Finance specifics (banking,
 * per-diem, money) are out of scope here by design.
 */
import {
  type Actor,
  type Entity,
  type EntityCreateInput,
  type EntityUpdateInput,
  type FxRate,
  type SetFxRateInput,
  entityCreateInputSchema,
  entityUpdateInputSchema,
  setFxRateInputSchema,
  formatEntityId,
  ConcurrencyError,
  ConflictError,
  NotFoundError,
} from '@c3web/domain';
import { assertManageEntities } from '@c3web/authz';
import type { EntityPatch, Persistence } from '../ports';

const EDITABLE = ['name', 'code', 'jurisdiction', 'registrationId', 'localCurrency'] as const;

/** S2: friendly duplicate-entity-code check (the partial unique index is the last line). */
async function assertEntityCodeAvailable(p: Persistence, actor: Actor, code: string | null, exceptEntityId?: string): Promise<void> {
  if (!code) return;
  const taken = (await p.reads.forActor(actor).listEntities()).some((e) => e.code === code && e.entityId !== exceptEntityId);
  if (taken) throw new ConflictError('That entity code is already in use.', { code });
}

export async function createEntity(p: Persistence, actor: Actor, input: EntityCreateInput): Promise<Entity> {
  assertManageEntities(actor);
  const parsed = entityCreateInputSchema.parse(input);
  await assertEntityCodeAvailable(p, actor, parsed.code);

  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('entity');
    const entityId = formatEntityId(seq);
    const entity = await tx.insertEntity(entityId, {
      name: parsed.name,
      code: parsed.code,
      jurisdiction: parsed.jurisdiction,
      registrationId: parsed.registrationId,
      localCurrency: parsed.localCurrency,
    });
    await tx.appendAuditEvent({
      entityType: 'Entity',
      entityId,
      action: 'EntityCreated',
      actor: actor.identity,
      before: null,
      after: { name: parsed.name, code: parsed.code, jurisdiction: parsed.jurisdiction, registrationId: parsed.registrationId, localCurrency: parsed.localCurrency },
    });
    return entity;
  });
}

export async function updateEntity(
  p: Persistence,
  actor: Actor,
  entityId: string,
  input: EntityUpdateInput,
): Promise<Entity> {
  assertManageEntities(actor);
  const parsed = entityUpdateInputSchema.parse(input);
  if ('code' in parsed && parsed.code) await assertEntityCodeAvailable(p, actor, parsed.code, entityId);

  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getEntity(entityId);
    if (!current) throw new NotFoundError('Entity', entityId);

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
    if (Object.keys(patch).length === 0) return current; // no-op patch

    const updated = await tx.updateEntity(entityId, parsed.expectedVersion, patch as EntityPatch);
    if (!updated) throw new ConcurrencyError('Entity', entityId);

    await tx.appendAuditEvent({
      entityType: 'Entity',
      entityId,
      action: 'EntityUpdated',
      actor: actor.identity,
      before,
      after,
    });
    return updated;
  });
}

export async function deactivateEntity(
  p: Persistence,
  actor: Actor,
  entityId: string,
  expectedVersion: number,
): Promise<Entity> {
  assertManageEntities(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getEntity(entityId);
    if (!current) throw new NotFoundError('Entity', entityId);
    if (!current.isActive) throw new ConflictError('The entity is already inactive.');

    const updated = await tx.deactivateEntity(entityId, expectedVersion);
    if (!updated) throw new ConcurrencyError('Entity', entityId);

    // People/agreements that reference this entity are untouched: their
    // membership is a historical fact. The FK is by tenant+entity id, which
    // still resolves — deactivation is a soft retire, not a delete.
    await tx.appendAuditEvent({
      entityType: 'Entity',
      entityId,
      action: 'EntityDeactivated',
      actor: actor.identity,
      before: { isActive: true },
      after: { isActive: false },
    });
    return updated;
  });
}

export async function reactivateEntity(
  p: Persistence,
  actor: Actor,
  entityId: string,
  expectedVersion: number,
): Promise<Entity> {
  assertManageEntities(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await tx.getEntity(entityId);
    if (!current) throw new NotFoundError('Entity', entityId);
    if (current.isActive) throw new ConflictError('The entity is already active.');

    const updated = await tx.reactivateEntity(entityId, expectedVersion);
    if (!updated) throw new ConcurrencyError('Entity', entityId);

    await tx.appendAuditEvent({
      entityType: 'Entity',
      entityId,
      action: 'EntityReactivated',
      actor: actor.identity,
      before: { isActive: false },
      after: { isActive: true },
    });
    return updated;
  });
}

export async function listEntities(p: Persistence, actor: Actor): Promise<Entity[]> {
  return p.reads.forActor(actor).listEntities();
}

// ── Finance S1: FX rates (org settings; owner/operations manage) ──────────────

export async function listFxRates(p: Persistence, actor: Actor): Promise<FxRate[]> {
  return p.reads.forActor(actor).listFxRates();
}

export async function setFxRate(p: Persistence, actor: Actor, input: SetFxRateInput): Promise<FxRate> {
  assertManageEntities(actor);
  const parsed = setFxRateInputSchema.parse(input);
  return p.writes.transaction(actor, async (tx) => {
    const rate = await tx.upsertFxRate(parsed.currency, parsed.usdPerUnit);
    await tx.appendAuditEvent({
      entityType: 'FxRate',
      entityId: parsed.currency,
      action: 'FxRateSet',
      actor: actor.identity,
      before: null,
      after: { currency: parsed.currency, usdPerUnit: parsed.usdPerUnit },
    });
    return rate;
  });
}
