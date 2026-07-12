/**
 * equipmentOps — the Kit and Apparel use-cases (Sprint 38). Pure
 * DIRECT-BUT-AUDITED CRUD: create / update (partial patch) / deactivate, all
 * role-gated, version-guarded (the CP-era ETag discipline), with the audit
 * event committed in the SAME transaction as the mutation. The update audit
 * carries before/after images of exactly the fields that changed.
 *
 * One generic core drives both domains; the only differences are the id kind,
 * the audit actions, and the authorization gate (HR may manage Apparel only).
 */
import {
  type Actor,
  type Apparel,
  type AuditAction,
  type EquipmentCreateInput,
  type EquipmentStatus,
  type EquipmentTransition,
  type EquipmentUpdateInput,
  type Kit,
  canTransitionEquipment,
  equipmentCreateInputSchema,
  equipmentUpdateInputSchema,
  formatApparelId,
  formatKitId,
  nextEquipmentStatus,
  ConcurrencyError,
  ConflictError,
  NotFoundError,
} from '@c3web/domain';
import { assertManageApparel, assertManageKit } from '@c3web/authz';
import type { EquipmentPatch, Persistence, WriteTx } from '../ports';

type EquipmentKind = 'kit' | 'apparel';

interface EquipmentConfig<T extends Kit | Apparel> {
  readonly kind: EquipmentKind;
  readonly entityName: 'Kit' | 'Apparel';
  readonly assert: (actor: Actor) => void;
  readonly formatId: (seq: number) => string;
  readonly actions: { created: AuditAction; updated: AuditAction; deactivated: AuditAction; reactivated: AuditAction; statusChanged: AuditAction };
  readonly idOf: (item: T) => string;
  readonly tx: {
    insert: (tx: WriteTx, id: string, row: Parameters<WriteTx['insertKit']>[1]) => Promise<T>;
    get: (tx: WriteTx, id: string) => Promise<T | null>;
    update: (tx: WriteTx, id: string, expectedVersion: number, patch: EquipmentPatch) => Promise<T | null>;
    deactivate: (tx: WriteTx, id: string, expectedVersion: number) => Promise<T | null>;
    reactivate: (tx: WriteTx, id: string, expectedVersion: number) => Promise<T | null>;
    setStatus: (tx: WriteTx, id: string, expectedVersion: number, status: string) => Promise<T | null>;
  };
}

const KIT: EquipmentConfig<Kit> = {
  kind: 'kit',
  entityName: 'Kit',
  assert: assertManageKit,
  formatId: formatKitId,
  actions: { created: 'KitCreated', updated: 'KitUpdated', deactivated: 'KitDeactivated', reactivated: 'KitReactivated', statusChanged: 'KitStatusChanged' },
  idOf: (k) => k.kitId,
  tx: {
    insert: (tx, id, row) => tx.insertKit(id, row),
    get: (tx, id) => tx.getKit(id),
    update: (tx, id, v, patch) => tx.updateKit(id, v, patch),
    deactivate: (tx, id, v) => tx.deactivateKit(id, v),
    reactivate: (tx, id, v) => tx.reactivateKit(id, v),
    setStatus: (tx, id, v, status) => tx.setKitStatus(id, v, status),
  },
};

const APPAREL: EquipmentConfig<Apparel> = {
  kind: 'apparel',
  entityName: 'Apparel',
  assert: assertManageApparel,
  formatId: formatApparelId,
  actions: { created: 'ApparelCreated', updated: 'ApparelUpdated', deactivated: 'ApparelDeactivated', reactivated: 'ApparelReactivated', statusChanged: 'ApparelStatusChanged' },
  idOf: (a) => a.apparelId,
  tx: {
    insert: (tx, id, row) => tx.insertApparel(id, row),
    get: (tx, id) => tx.getApparel(id),
    update: (tx, id, v, patch) => tx.updateApparel(id, v, patch),
    deactivate: (tx, id, v) => tx.deactivateApparel(id, v),
    reactivate: (tx, id, v) => tx.reactivateApparel(id, v),
    setStatus: (tx, id, v, status) => tx.setApparelStatus(id, v, status),
  },
};

const EDITABLE = ['name', 'category', 'size', 'assignedPersonId', 'notes'] as const;

async function assertPersonExists(p: Persistence, actor: Actor, personId: string): Promise<void> {
  const person = await p.reads.forActor(actor).getPersonById(personId);
  if (!person) throw new NotFoundError('Person', personId);
}

async function createEquipment<T extends Kit | Apparel>(
  cfg: EquipmentConfig<T>,
  p: Persistence,
  actor: Actor,
  input: EquipmentCreateInput,
): Promise<T> {
  cfg.assert(actor);
  const parsed = equipmentCreateInputSchema.parse(input);
  if (parsed.assignedPersonId) await assertPersonExists(p, actor, parsed.assignedPersonId);

  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence(cfg.kind);
    const id = cfg.formatId(seq);
    const item = await cfg.tx.insert(tx, id, {
      name: parsed.name,
      category: parsed.category,
      size: parsed.size,
      assignedPersonId: parsed.assignedPersonId,
      notes: parsed.notes,
    });
    await tx.appendAuditEvent({
      entityType: cfg.entityName,
      entityId: id,
      action: cfg.actions.created,
      actor: actor.identity,
      before: null,
      after: { name: parsed.name, category: parsed.category, assignedPersonId: parsed.assignedPersonId },
    });
    return item;
  });
}

async function updateEquipment<T extends Kit | Apparel>(
  cfg: EquipmentConfig<T>,
  p: Persistence,
  actor: Actor,
  id: string,
  input: EquipmentUpdateInput,
): Promise<T> {
  cfg.assert(actor);
  const parsed = equipmentUpdateInputSchema.parse(input);
  if (parsed.assignedPersonId) await assertPersonExists(p, actor, parsed.assignedPersonId);

  return p.writes.transaction(actor, async (tx) => {
    const current = await cfg.tx.get(tx, id);
    if (!current) throw new NotFoundError(cfg.entityName, id);

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

    const updated = await cfg.tx.update(tx, id, parsed.expectedVersion, patch as EquipmentPatch);
    if (!updated) throw new ConcurrencyError(cfg.entityName, id);

    await tx.appendAuditEvent({
      entityType: cfg.entityName,
      entityId: id,
      action: cfg.actions.updated,
      actor: actor.identity,
      before,
      after,
    });
    return updated;
  });
}

async function deactivateEquipment<T extends Kit | Apparel>(
  cfg: EquipmentConfig<T>,
  p: Persistence,
  actor: Actor,
  id: string,
  expectedVersion: number,
): Promise<T> {
  cfg.assert(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await cfg.tx.get(tx, id);
    if (!current) throw new NotFoundError(cfg.entityName, id);
    if (!current.isActive) throw new ConflictError(`The ${cfg.kind} item is already inactive.`);

    const updated = await cfg.tx.deactivate(tx, id, expectedVersion);
    if (!updated) throw new ConcurrencyError(cfg.entityName, id);

    await tx.appendAuditEvent({
      entityType: cfg.entityName,
      entityId: id,
      action: cfg.actions.deactivated,
      actor: actor.identity,
      before: { isActive: true },
      after: { isActive: false },
    });
    return updated;
  });
}

async function reactivateEquipment<T extends Kit | Apparel>(
  cfg: EquipmentConfig<T>,
  p: Persistence,
  actor: Actor,
  id: string,
  expectedVersion: number,
): Promise<T> {
  cfg.assert(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await cfg.tx.get(tx, id);
    if (!current) throw new NotFoundError(cfg.entityName, id);
    if (current.isActive) throw new ConflictError(`The ${cfg.kind} item is already active.`);

    const updated = await cfg.tx.reactivate(tx, id, expectedVersion);
    if (!updated) throw new ConcurrencyError(cfg.entityName, id);

    await tx.appendAuditEvent({
      entityType: cfg.entityName,
      entityId: id,
      action: cfg.actions.reactivated,
      actor: actor.identity,
      before: { isActive: false },
      after: { isActive: true },
    });
    return updated;
  });
}

async function transitionEquipment<T extends Kit | Apparel>(
  cfg: EquipmentConfig<T>,
  p: Persistence,
  actor: Actor,
  id: string,
  action: EquipmentTransition,
  expectedVersion: number,
): Promise<T> {
  cfg.assert(actor);
  return p.writes.transaction(actor, async (tx) => {
    const current = await cfg.tx.get(tx, id);
    if (!current) throw new NotFoundError(cfg.entityName, id);

    const from = current.status as EquipmentStatus;
    const to = nextEquipmentStatus(action, from);
    if (!to || !canTransitionEquipment(action, from)) {
      throw new ConflictError(`Cannot ${action} a ${cfg.kind} item that is ${from}.`);
    }

    const updated = await cfg.tx.setStatus(tx, id, expectedVersion, to);
    if (!updated) throw new ConcurrencyError(cfg.entityName, id);

    await tx.appendAuditEvent({
      entityType: cfg.entityName,
      entityId: id,
      action: cfg.actions.statusChanged,
      actor: actor.identity,
      before: { status: from },
      after: { status: to },
    });
    return updated;
  });
}

// ── the public surface ────────────────────────────────────────────────────────
export const createKit = (p: Persistence, actor: Actor, input: EquipmentCreateInput): Promise<Kit> =>
  createEquipment(KIT, p, actor, input);
export const updateKit = (p: Persistence, actor: Actor, kitId: string, input: EquipmentUpdateInput): Promise<Kit> =>
  updateEquipment(KIT, p, actor, kitId, input);
export const deactivateKit = (p: Persistence, actor: Actor, kitId: string, expectedVersion: number): Promise<Kit> =>
  deactivateEquipment(KIT, p, actor, kitId, expectedVersion);
export const reactivateKit = (p: Persistence, actor: Actor, kitId: string, expectedVersion: number): Promise<Kit> =>
  reactivateEquipment(KIT, p, actor, kitId, expectedVersion);
export const transitionKit = (
  p: Persistence,
  actor: Actor,
  kitId: string,
  action: EquipmentTransition,
  expectedVersion: number,
): Promise<Kit> => transitionEquipment(KIT, p, actor, kitId, action, expectedVersion);

export const createApparel = (p: Persistence, actor: Actor, input: EquipmentCreateInput): Promise<Apparel> =>
  createEquipment(APPAREL, p, actor, input);
export const updateApparel = (p: Persistence, actor: Actor, apparelId: string, input: EquipmentUpdateInput): Promise<Apparel> =>
  updateEquipment(APPAREL, p, actor, apparelId, input);
export const deactivateApparel = (p: Persistence, actor: Actor, apparelId: string, expectedVersion: number): Promise<Apparel> =>
  deactivateEquipment(APPAREL, p, actor, apparelId, expectedVersion);
export const reactivateApparel = (p: Persistence, actor: Actor, apparelId: string, expectedVersion: number): Promise<Apparel> =>
  reactivateEquipment(APPAREL, p, actor, apparelId, expectedVersion);
export const transitionApparel = (
  p: Persistence,
  actor: Actor,
  apparelId: string,
  action: EquipmentTransition,
  expectedVersion: number,
): Promise<Apparel> => transitionEquipment(APPAREL, p, actor, apparelId, action, expectedVersion);
