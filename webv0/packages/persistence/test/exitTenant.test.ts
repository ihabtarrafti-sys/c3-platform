/**
 * exitTenant.test.ts — B-5 item 3 evidence. Proves the erasure ceremony:
 *   - dry-run reports the full erasure picture and mutates NOTHING;
 *   - execute refuses without dual confirmation (nothing changed);
 *   - execute refuses while Phase E1 is incomplete (an active user still holds
 *     a membership) — nothing changed;
 *   - a completed ceremony erases exactly the target tenant: all rows gone,
 *     sole-tenant users + identities gone, shared users preserved, the other
 *     tenant byte-for-byte untouched;
 *   - the append-only triggers are re-enabled and still ENFORCE afterwards;
 *   - an erased/unknown slug is refused.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { Actor } from '@c3web/domain';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';
import { exitTenant } from '../src/exitTenant';

let db: TestDatabase;
let p: PersistenceHandle;

function ownerActor(tenantId: string, email: string): Actor {
  return { identity: email, displayName: 'Owner', role: 'owner', tenantId };
}

async function governedAddPerson(actor: Actor, fullName: string): Promise<void> {
  await p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = `APR-${String(seq).padStart(4, '0')}`;
    await tx.insertApproval({
      approvalId,
      operationType: 'AddPerson',
      targetPersonId: 'PENDING-ADDPERSON',
      targetId: null,
      reason: null,
      payload: { operationType: 'AddPerson', input: { fullName } },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({ approvalId, fromStatus: null, toStatus: 'Submitted', actor: actor.identity });
    const pseq = await tx.allocateSequence('person');
    const personId = `PER-${String(pseq).padStart(4, '0')}`;
    await tx.insertPerson({
      personId, fullName, ign: null, nationality: null, primaryRole: null,
      personnelCode: null, currentTeam: null, currentGameTitle: null, primaryDepartment: null,
      notes: null, createdByApprovalId: approvalId,
    });
    await tx.appendAuditEvent({ entityType: 'Person', entityId: personId, action: 'PersonCreated', actor: actor.identity });
  });
}

async function admin<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: db.adminUrl, options: '-c client_encoding=UTF8' });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

/** Full-DB fingerprint used to prove "nothing changed" after refusals/dry-runs. */
async function fingerprint(): Promise<string> {
  return admin(async (c) => {
    const parts: string[] = [];
    for (const t of ['tenant', 'app_user', 'external_identity', 'tenant_membership', 'role_assignment', 'business_id_counter', 'person', 'credential', 'journey', 'kit', 'apparel', 'approval', 'approval_event', 'audit_event']) {
      const r = await c.query(`SELECT count(*)::int AS n FROM ${t}`);
      parts.push(`${t}=${r.rows[0].n}`);
    }
    const active = await c.query(`SELECT count(*)::int AS n FROM app_user WHERE is_active`);
    parts.push(`active=${active.rows[0].n}`);
    return parts.join('|');
  });
}

/** Complete Phase E1 for alpha: deactivate sole members, strip the shared user's alpha rows. */
async function completePhaseE1(): Promise<void> {
  await admin(async (c) => {
    // Deactivate sole-tenant members of alpha.
    await c.query(
      `UPDATE app_user SET is_active = false WHERE id IN (
         SELECT tm.user_id FROM tenant_membership tm WHERE tm.tenant_id = $1
           AND NOT EXISTS (SELECT 1 FROM tenant_membership o WHERE o.user_id = tm.user_id AND o.tenant_id <> $1))`,
      [alphaId],
    );
    // Shared users: remove their alpha membership/role rows (they stay active elsewhere).
    await c.query(
      `DELETE FROM role_assignment WHERE tenant_id = $1 AND user_id IN (
         SELECT tm.user_id FROM tenant_membership tm WHERE tm.tenant_id = $1
           AND EXISTS (SELECT 1 FROM tenant_membership o WHERE o.user_id = tm.user_id AND o.tenant_id <> $1))`,
      [alphaId],
    );
    await c.query(
      `DELETE FROM tenant_membership tm WHERE tm.tenant_id = $1
         AND EXISTS (SELECT 1 FROM tenant_membership o WHERE o.user_id = tm.user_id AND o.tenant_id <> $1)`,
      [alphaId],
    );
  });
}

beforeAll(async () => {
  db = await startTestDatabase();
  p = createPersistence({ appConnectionString: db.appUrl });
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

let alphaId: string;
let bravoId: string;

beforeEach(async () => {
  await db.truncateAll();
  const alpha = await db.seedTenant({
    slug: 'alpha',
    name: 'Alpha Org',
    users: [
      { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner', entra: { tid: 'tid-a', oid: 'oid-owner-a' } },
      { key: 'shared', email: 'shared@x.com', displayName: 'Shared User', role: 'operations', entra: { tid: 'tid-a', oid: 'oid-shared' } },
    ],
  });
  const bravo = await db.seedTenant({
    slug: 'bravo',
    name: 'Bravo Org',
    users: [
      { key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner', entra: { tid: 'tid-b', oid: 'oid-owner-b' } },
      { key: 'shared', email: 'shared@x.com', displayName: 'Shared User', role: 'visitor' },
    ],
  });
  alphaId = alpha.tenantId;
  bravoId = bravo.tenantId;
  await governedAddPerson(ownerActor(alphaId, 'owner@a.com'), 'Alpha Person');
  await governedAddPerson(ownerActor(bravoId, 'owner@b.com'), 'Bravo Person');
});

describe('exit ceremony — dry-run', () => {
  it('reports the erasure picture (counts, sole/shared, E1 blockers) and mutates nothing', async () => {
    const before = await fingerprint();
    const report = await admin((c) => exitTenant(c, { tenantSlug: 'alpha' }));
    expect(report.mode).toBe('dry-run');
    expect(report.tenant.slug).toBe('alpha');
    expect(report.activeMembers).toBe(2); // E1 not done — would block execute
    expect(report.soleUsers).toBe(1); // owner@a.com
    expect(report.sharedUsers).toBe(1); // shared@x.com (also in bravo)
    const rows = Object.fromEntries(report.tables.map((t) => [t.name, t.rows]));
    expect(rows.person).toBe(1);
    expect(rows.approval).toBe(1);
    expect(rows.audit_event).toBeGreaterThan(0);
    expect(rows.tenant).toBe(1);
    expect(await fingerprint()).toBe(before);
  });
});

describe('exit ceremony — refusals (fail closed, nothing changes)', () => {
  it('refuses execute without dual confirmation', async () => {
    const before = await fingerprint();
    await expect(
      admin((c) => exitTenant(c, { tenantSlug: 'alpha', execute: true, confirmSlug: 'alpha' })),
    ).rejects.toThrow(/dual authorization/i);
    await expect(
      admin((c) => exitTenant(c, { tenantSlug: 'alpha', execute: true, confirmSlug: 'alpha', secondConfirm: 'wrong' })),
    ).rejects.toThrow(/dual authorization/i);
    expect(await fingerprint()).toBe(before);
  });

  it('refuses execute while Phase E1 is incomplete (active member holds a membership)', async () => {
    const before = await fingerprint();
    await expect(
      admin((c) => exitTenant(c, { tenantSlug: 'alpha', execute: true, confirmSlug: 'alpha', secondConfirm: 'alpha' })),
    ).rejects.toThrow(/active member/i);
    expect(await fingerprint()).toBe(before);
  });

  it('refuses an unknown tenant slug', async () => {
    await expect(admin((c) => exitTenant(c, { tenantSlug: 'nope' }))).rejects.toThrow(/Unknown tenant/i);
  });
});

describe('exit ceremony — executed', () => {
  it('erases exactly the target tenant; shared users and the other tenant are untouched; triggers still enforce', async () => {
    await completePhaseE1();
    const report = await admin((c) =>
      exitTenant(c, { tenantSlug: 'alpha', execute: true, confirmSlug: 'alpha', secondConfirm: 'alpha' }),
    );
    expect(report.mode).toBe('executed');
    expect(report.postChecks).toEqual({ zeroRowsVerified: true, tenantRowGone: true, triggersReEnabled: true });

    await admin(async (c) => {
      // Alpha is gone everywhere.
      expect((await c.query(`SELECT count(*)::int AS n FROM tenant WHERE slug='alpha'`)).rows[0].n).toBe(0);
      for (const t of ['person', 'credential', 'journey', 'kit', 'apparel', 'approval', 'approval_event', 'audit_event', 'tenant_membership', 'role_assignment', 'business_id_counter']) {
        expect((await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE tenant_id = $1`, [alphaId])).rows[0].n).toBe(0);
      }
      // Sole-tenant user + identity erased with the org.
      expect((await c.query(`SELECT count(*)::int AS n FROM app_user WHERE email='owner@a.com'`)).rows[0].n).toBe(0);
      expect((await c.query(`SELECT count(*)::int AS n FROM external_identity WHERE subject='oid-owner-a'`)).rows[0].n).toBe(0);
      // Shared user preserved, still active, still a bravo member.
      const shared = await c.query(`SELECT is_active FROM app_user WHERE email='shared@x.com'`);
      expect(shared.rows).toHaveLength(1);
      expect(shared.rows[0].is_active).toBe(true);
      expect(
        (await c.query(`SELECT count(*)::int AS n FROM tenant_membership tm JOIN app_user u ON u.id=tm.user_id WHERE u.email='shared@x.com' AND tm.tenant_id=$1`, [bravoId])).rows[0].n,
      ).toBe(1);
      // Bravo data untouched.
      expect((await c.query(`SELECT count(*)::int AS n FROM person WHERE tenant_id=$1`, [bravoId])).rows[0].n).toBe(1);
      expect((await c.query(`SELECT count(*)::int AS n FROM audit_event WHERE tenant_id=$1`, [bravoId])).rows[0].n).toBeGreaterThan(0);
      // Append-only triggers re-enabled AND still enforcing (on bravo's events).
      await expect(c.query(`UPDATE audit_event SET actor='hacked' WHERE tenant_id=$1`, [bravoId])).rejects.toThrow(/append-only/i);
      await expect(c.query(`DELETE FROM approval_event WHERE tenant_id=$1`, [bravoId])).rejects.toThrow(/append-only/i);
    });

    // The erased slug is now unknown — a re-run refuses.
    await expect(admin((c) => exitTenant(c, { tenantSlug: 'alpha' }))).rejects.toThrow(/Unknown tenant/i);
  });
});
