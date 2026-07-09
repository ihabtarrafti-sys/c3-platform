/**
 * entities.test.ts — S48 evidence against a REAL PostgreSQL. Covers the
 * direct-audited Entity CRUD (create/update/deactivate + changed-field audit
 * images), the owner/operations gate, RLS isolation, and the person/agreement
 * "signed with / under" entity threading through the governed pipelines.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Actor, AddPersonInput } from '@c3web/domain';
import { ForbiddenError, NotFoundError } from '@c3web/domain';
import {
  createEntity,
  updateEntity,
  deactivateEntity,
  listEntities,
  setFxRate,
  listFxRates,
  submitAddPerson,
  submitAddAgreement,
  beginReview,
  approveApproval,
  executeApproval,
} from '@c3web/application';
import { usdPerUnitMap, convertMinor } from '@c3web/domain';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';

let db: TestDatabase;
let p: PersistenceHandle;

const actor = (tenantId: string, email: string, role: string): Actor =>
  ({ identity: email, displayName: email, role: role as Actor['role'], tenantId });

let alphaId: string;
let alphaOwner: Actor;
let alphaOps: Actor;
let alphaVisitor: Actor;
let bravoOwner: Actor;

async function addPerson(fullName: string, entityId?: string): Promise<string> {
  const a = await submitAddPerson(p, alphaOps, { input: { fullName, entityId } as AddPersonInput });
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
      { key: 'visitor', email: 'visitor@a.com', displayName: 'Visitor A', role: 'visitor' },
    ],
  });
  const bravo = await db.seedTenant({ slug: 'bravo', users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }] });
  alphaId = alpha.tenantId;
  alphaOwner = actor(alphaId, 'owner@a.com', 'owner');
  alphaOps = actor(alphaId, 'ops@a.com', 'operations');
  alphaVisitor = actor(alphaId, 'visitor@a.com', 'visitor');
  bravoOwner = actor(bravo.tenantId, 'owner@b.com', 'owner');
});

describe('entity lifecycle (direct-audited)', () => {
  it('create → update (changed-fields-only audit) → deactivate, all audited same-tx', async () => {
    const e = await createEntity(p, alphaOps, { name: 'Geekay UAE', jurisdiction: 'United Arab Emirates', localCurrency: 'AED' });
    expect(e).toMatchObject({ entityId: 'ENT-0001', name: 'Geekay UAE', jurisdiction: 'United Arab Emirates', localCurrency: 'AED', isActive: true, version: 0 });

    const updated = await updateEntity(p, alphaOps, e.entityId, { expectedVersion: e.version, registrationId: 'DED-123456' });
    expect(updated.registrationId).toBe('DED-123456');

    const audit = await p.reads.forActor(alphaOwner).listAuditEventsForEntity('Entity', e.entityId);
    expect(audit.map((a) => a.action)).toEqual(['EntityCreated', 'EntityUpdated']);
    const upd = audit.find((a) => a.action === 'EntityUpdated')!;
    expect(upd.after).toMatchObject({ registrationId: 'DED-123456' });
    expect('name' in (upd.after ?? {})).toBe(false); // only the changed field

    const retired = await deactivateEntity(p, alphaOwner, e.entityId, updated.version);
    expect(retired.isActive).toBe(false);
  });

  it('only owner/operations may manage; a stale version is refused', async () => {
    await expect(createEntity(p, alphaVisitor, { name: 'X', jurisdiction: 'Y' })).rejects.toBeInstanceOf(ForbiddenError);
    const e = await createEntity(p, alphaOps, { name: 'Geekay KSA', jurisdiction: 'Saudi Arabia', localCurrency: 'SAR' });
    await updateEntity(p, alphaOps, e.entityId, { expectedVersion: e.version, name: 'Geekay KSA v2' });
    await expect(updateEntity(p, alphaOps, e.entityId, { expectedVersion: 0, name: 'stale' })).rejects.toThrow();
  });

  it('is tenant-isolated (RLS): bravo cannot see alpha entities', async () => {
    await createEntity(p, alphaOps, { name: 'Geekay UAE', jurisdiction: 'UAE', localCurrency: 'AED' });
    expect(await listEntities(p, alphaOwner)).toHaveLength(1);
    expect(await listEntities(p, bravoOwner)).toHaveLength(0);
  });
});

describe('entity threading (person + agreement)', () => {
  it('a person is created assigned to the entity they signed with', async () => {
    const e = await createEntity(p, alphaOps, { name: 'Geekay UAE', jurisdiction: 'UAE', localCurrency: 'AED' });
    const personId = await addPerson('Kairo Mendes', e.entityId);
    const person = await p.reads.forActor(alphaOwner).getPersonById(personId);
    expect(person!.entityId).toBe(e.entityId);
  });

  it('an agreement is created under an entity', async () => {
    const e = await createEntity(p, alphaOps, { name: 'Geekay UAE', jurisdiction: 'UAE', localCurrency: 'AED' });
    const personId = await addPerson('Player One');
    const sub = await submitAddAgreement(p, alphaOps, {
      input: { personId, entityId: e.entityId, agreementType: 'Player Contract', startsOn: '2026-01-01', endsOn: '2027-01-01' } as never,
    });
    const inReview = await beginReview(p, alphaOwner, sub.approvalId, sub.version);
    const approved = await approveApproval(p, alphaOwner, inReview.approvalId, inReview.version);
    const res = await executeApproval(p, alphaOwner, approved.approvalId, approved.version);
    expect(res.agreement!.entityId).toBe(e.entityId);
  });

  it('submitting a person with a non-existent entity is refused (friendly, before approval)', async () => {
    await expect(
      submitAddPerson(p, alphaOps, { input: { fullName: 'Nobody', entityId: 'ENT-9999' } as AddPersonInput }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('FX rates (Finance S1, tenant-scoped, owner/ops)', () => {
  it('owner/ops set rates (upsert replaces); visitor is refused; RLS isolates', async () => {
    await setFxRate(p, alphaOps, { currency: 'AED', usdPerUnit: 0.2723 });
    await setFxRate(p, alphaOps, { currency: 'SAR', usdPerUnit: 0.2666 });
    // upsert: setting AED again replaces, not duplicates
    await setFxRate(p, alphaOwner, { currency: 'AED', usdPerUnit: 0.27 });

    const rates = await listFxRates(p, alphaOwner);
    expect(rates).toHaveLength(2);
    expect(rates.find((r) => r.currency === 'AED')!.usdPerUnit).toBeCloseTo(0.27, 5);

    await expect(setFxRate(p, alphaVisitor, { currency: 'EUR', usdPerUnit: 1.08 })).rejects.toBeInstanceOf(ForbiddenError);

    // tenant isolation: bravo sees none of alpha's rates
    expect(await listFxRates(p, bravoOwner)).toHaveLength(0);
  });

  it('the stored rates drive a correct cross-rate (AED → SAR)', async () => {
    await setFxRate(p, alphaOps, { currency: 'AED', usdPerUnit: 0.2723 });
    await setFxRate(p, alphaOps, { currency: 'SAR', usdPerUnit: 0.2666 });
    const map = usdPerUnitMap(await listFxRates(p, alphaOwner));
    // 100.00 AED → SAR
    expect(convertMinor(10_000, 'AED', 'SAR', map)).toBe(10_214);
  });
});
