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
  CURRENCY_CODES,
  entityCreateInputSchema,
  entityUpdateInputSchema,
  setFxRateInputSchema,
  formatEntityId,
  ConcurrencyError,
  ConflictError,
  NotFoundError,
  ValidationError,
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

/** The source's native shape (units-per-USD), handed in by the API route. */
export interface FxFetchedRates {
  readonly source: string;
  readonly asOf: string;
  readonly unitsPerUsd: Record<string, number>;
}

export interface FxRefreshResult {
  readonly rates: FxRate[];
  /** Tracked currencies that were updated from the source. */
  readonly refreshed: string[];
  /** Tracked currencies the source did not carry (left untouched). */
  readonly skipped: string[];
  readonly source: string;
  readonly asOf: string;
}

/**
 * Track B — FX auto-fetch. Refresh every SUPPORTED currency (CURRENCY_CODES
 * minus the USD pivot) from the source, inverting units-per-USD to the domain's
 * usdPerUnit pivot and upserting — so one click populates them all, whether or
 * not they were set before. USD is never touched (the pivot is pinned to 1).
 * Currencies the source does not carry are left as-is and reported as skipped —
 * never blanked. One summary audit event records the provenance.
 */
export async function refreshFxRates(p: Persistence, actor: Actor, fetched: FxFetchedRates): Promise<FxRefreshResult> {
  assertManageEntities(actor);
  // M-17: validate the provider payload shape before trusting any of it.
  if (typeof fetched.source !== 'string' || fetched.source.trim() === '') {
    throw new ValidationError('FX refresh: the source is missing.', { source: fetched.source });
  }
  if (typeof fetched.asOf !== 'string' || Number.isNaN(Date.parse(fetched.asOf))) {
    throw new ValidationError('FX refresh: the source timestamp is not a valid date.', { asOf: fetched.asOf });
  }
  if (typeof fetched.unitsPerUsd !== 'object' || fetched.unitsPerUsd === null) {
    throw new ValidationError('FX refresh: the source payload is malformed.', {});
  }

  const supported = CURRENCY_CODES.filter((c) => c !== 'USD');
  const refreshed: string[] = [];
  const skipped: string[] = [];
  await p.writes.transaction(actor, async (tx) => {
    for (const currency of supported) {
      const units = fetched.unitsPerUsd[currency];
      // A currency the source does not carry is legitimately SKIPPED (never blanked).
      if (units === undefined || units === null) {
        skipped.push(currency);
        continue;
      }
      // M-17: a currency the source DOES carry but with a bad/out-of-bounds value
      // REJECTS the whole refresh — a malformed provider payload must not
      // partially write, and every derived rate passes the SAME domain bounds as
      // a manual set (positive, ≤ 1,000,000) before it reaches the DB.
      if (typeof units !== 'number' || !Number.isFinite(units) || units <= 0) {
        throw new ValidationError(`FX refresh: the source returned an invalid rate for ${currency}.`, { currency, units });
      }
      const usdPerUnit = Math.round((1 / units) * 1e8) / 1e8; // numeric(18,8)
      const check = setFxRateInputSchema.safeParse({ currency, usdPerUnit });
      if (!check.success) {
        throw new ValidationError(`FX refresh: the derived rate for ${currency} is outside the accepted range.`, { currency, usdPerUnit });
      }
      await tx.upsertFxRate(currency, usdPerUnit);
      refreshed.push(currency);
    }
    if (refreshed.length > 0) {
      await tx.appendAuditEvent({
        entityType: 'FxRate',
        entityId: 'refresh',
        action: 'FxRatesRefreshed',
        actor: actor.identity,
        before: null,
        after: { source: fetched.source, asOf: fetched.asOf, refreshed, skipped },
      });
    }
  });
  const rates = await p.reads.forActor(actor).listFxRates();
  return { rates, refreshed, skipped, source: fetched.source, asOf: fetched.asOf };
}
