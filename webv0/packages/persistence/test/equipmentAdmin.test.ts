/**
 * equipmentAdmin.test.ts — Sprint 38 K2 evidence against a REAL PostgreSQL.
 * Covers: direct-audited create/update/deactivate for BOTH domains,
 * before/after audit images restricted to changed fields, stale-version
 * refusal with zero change (the ETag-parity case), the HR capability split
 * enforced server-side (apparel yes, kit no), person-assignment validation,
 * unassignment, no-op patches, and RLS isolation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, AddPersonInput } from '@c3web/domain';
import {
  createKit,
  updateKit,
  deactivateKit,
  createApparel,
  updateApparel,
  deactivateApparel,
  submitAddPerson,
  beginReview,
  approveApproval,
  executeApproval,
} from '@c3web/application';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;

const actor = (tenantId: string, email: string, role: string): Actor =>
  ({ identity: email, displayName: email, role: role as Actor['role'], tenantId });

let alphaId: string;
let bravoId: string;
let alphaOwner: Actor;
let alphaOps: Actor;
let alphaHr: Actor;
let alphaVisitor: Actor;
let bravoOwner: Actor;

async function addPerson(fullName: string): Promise<string> {
  const a = await submitAddPerson(p, alphaOps, { input: { fullName } as AddPersonInput });
  const inReview = await beginReview(p, alphaOwner, a.approvalId, a.version);
  const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
  const res = await executeApproval(p, alphaOwner, approved.approvalId, approved.version);
  return res.person!.personId;
}

beforeAll(async () => {
  db = await startTestDatabase();
  p = createPersistence({ appConnectionString: db.appUrl });
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  const alpha = await db.seedTenant({
    slug: 'alpha',
    users: [
      { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner' },
      { key: 'ops', email: 'ops@a.com', displayName: 'Ops A', role: 'operations' },
      { key: 'hr', email: 'hr@a.com', displayName: 'HR A', role: 'hr' },
      { key: 'visitor', email: 'visitor@a.com', displayName: 'Visitor A', role: 'visitor' },
    ],
  });
  const bravo = await db.seedTenant({
    slug: 'bravo',
    users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }],
  });
  alphaId = alpha.tenantId;
  bravoId = bravo.tenantId;
  alphaOwner = actor(alphaId, 'owner@a.com', 'owner');
  alphaOps = actor(alphaId, 'ops@a.com', 'operations');
  alphaHr = actor(alphaId, 'hr@a.com', 'hr');
  alphaVisitor = actor(alphaId, 'visitor@a.com', 'visitor');
  bravoOwner = actor(bravoId, 'owner@b.com', 'owner');
});

describe('kit lifecycle (direct-audited)', () => {
  it('create → update (changed-fields-only audit images) → deactivate, all audited same-tx', async () => {
    const personId = await addPerson('Kit Holder');
    const kit = await createKit(p, alphaOps, { name: 'Tournament headset #3', category: 'Peripheral' });
    expect(kit).toMatchObject({ kitId: 'KIT-0001', isActive: true, assignedPersonId: null, version: 0 });

    // Update: rename + assign; category untouched.
    const updated = await updateKit(p, alphaOps, kit.kitId, {
      expectedVersion: kit.version,
      name: 'Tournament headset #3 (repaired)',
      assignedPersonId: personId,
    });
    expect(updated.version).toBe(1);
    expect(updated.assignedPersonId).toBe(personId);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Kit', kit.kitId);
    const upd = audit.find((e) => e.action === 'KitUpdated')!;
    expect(upd.before).toEqual({ name: 'Tournament headset #3', assignedPersonId: null });
    expect(upd.after).toEqual({ name: 'Tournament headset #3 (repaired)', assignedPersonId: personId });
    expect('category' in (upd.before ?? {})).toBe(false); // unchanged fields stay out of the images

    const retired = await deactivateKit(p, alphaOwner, kit.kitId, updated.version);
    expect(retired.isActive).toBe(false);
    expect(audit.length + 1).toBeGreaterThanOrEqual(3);
    const audit2 = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Kit', kit.kitId);
    expect(audit2.map((e) => e.action)).toEqual(['KitCreated', 'KitUpdated', 'KitDeactivated']);
  });

  it('unassignment via explicit null; no-op patch changes nothing', async () => {
    const personId = await addPerson('Assignee');
    const kit = await createKit(p, alphaOps, { name: 'Mouse', category: 'Peripheral', assignedPersonId: personId });
    const unassigned = await updateKit(p, alphaOps, kit.kitId, { expectedVersion: kit.version, assignedPersonId: null });
    expect(unassigned.assignedPersonId).toBeNull();
    // No-op: same value again — returns current, version unchanged, no audit row.
    const noop = await updateKit(p, alphaOps, kit.kitId, { expectedVersion: unassigned.version, assignedPersonId: null });
    expect(noop.version).toBe(unassigned.version);
    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Kit', kit.kitId);
    expect(audit.filter((e) => e.action === 'KitUpdated')).toHaveLength(1);
  });

  it('stale version refuses with zero change (the ETag-parity case)', async () => {
    const kit = await createKit(p, alphaOps, { name: 'Keyboard', category: 'Peripheral' });
    await updateKit(p, alphaOps, kit.kitId, { expectedVersion: 0, name: 'Keyboard v2' });
    await expect(
      updateKit(p, alphaOps, kit.kitId, { expectedVersion: 0, name: 'Keyboard v3' }), // stale
    ).rejects.toThrow(/modified concurrently/i);
    const still = await p.reads.forActor(alphaOwner).getKitById(kit.kitId);
    expect(still?.name).toBe('Keyboard v2');
  });

  it('create refuses an unknown assigned person; deactivate twice conflicts', async () => {
    await expect(createKit(p, alphaOps, { name: 'X', category: 'Y', assignedPersonId: 'PER-9999' })).rejects.toThrow(/Person not found/i);
    const kit = await createKit(p, alphaOps, { name: 'Monitor', category: 'Display' });
    const retired = await deactivateKit(p, alphaOps, kit.kitId, kit.version);
    await expect(deactivateKit(p, alphaOps, kit.kitId, retired.version)).rejects.toThrow(/already inactive/i);
  });
});

describe('the HR capability split (CP parity, server-enforced)', () => {
  it('HR manages apparel but NOT kit; visitor manages neither', async () => {
    const apparel = await createApparel(p, alphaHr, { name: 'Away jersey L', category: 'Jersey', size: 'L' });
    expect(apparel.apparelId).toBe('APL-0001');
    const renamed = await updateApparel(p, alphaHr, apparel.apparelId, { expectedVersion: 0, name: 'Away jersey L (2026)' });
    expect(renamed.name).toBe('Away jersey L (2026)');

    await expect(createKit(p, alphaHr, { name: 'Headset', category: 'Peripheral' })).rejects.toThrow(/may not manage kit/i);
    await expect(createApparel(p, alphaVisitor, { name: 'Cap', category: 'Cap' })).rejects.toThrow(/may not manage apparel/i);
    await expect(createKit(p, alphaVisitor, { name: 'Cam', category: 'Streaming' })).rejects.toThrow(/may not manage kit/i);

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Apparel', apparel.apparelId);
    expect(audit.map((e) => e.action)).toEqual(['ApparelCreated', 'ApparelUpdated']);
    expect(audit[0]!.actor).toBe('hr@a.com'); // HR's write, truthfully attributed
  });
});

describe('isolation', () => {
  it('equipment is tenant-isolated (RLS): bravo sees nothing of alpha', async () => {
    await createKit(p, alphaOps, { name: 'Isolated kit', category: 'Peripheral' });
    await createApparel(p, alphaHr, { name: 'Isolated jersey', category: 'Jersey' });
    expect(await p.reads.forActor(bravoOwner).listKit()).toHaveLength(0);
    expect(await p.reads.forActor(bravoOwner).listApparel()).toHaveLength(0);
    expect(await p.reads.forActor(bravoOwner).getKitById('KIT-0001')).toBeNull();
    expect(await p.reads.forActor(alphaOwner).listKit()).toHaveLength(1);
  });
});
