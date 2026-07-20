/**
 * currentUserId.test.ts — the participant identity GUC (Comms Phase 1).
 *
 * Proves the `app.user_id` → current_user_id() wiring that withTenantTx sets
 * alongside app.tenant_id (in ONE round trip). The helper is DORMANT (no policy
 * references it yet), so these tests exercise the mechanism directly:
 *   - inside a tenant transaction it reflects the actor's stable userId;
 *   - on a raw connection (GUC unset) it is NULL — nullable-by-construction, so
 *     the c3_auth/c3_backup/migration connections that never set it are safe;
 *   - a missing/malformed userId is passed as '' → current_user_id() is NULL
 *     (deny the participant match) rather than failing the whole transaction.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@c3web/domain';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';
import { withTenantTx } from '../src/tenantContext';

let db: TestDatabase;
let p: PersistenceHandle;
let owner: Actor;

beforeAll(async () => {
  db = await startTestDatabase();
  const seeded = await db.seedTenant({
    slug: 'current-user-id',
    users: [{ key: 'owner', email: 'owner@cui.test', displayName: 'Owner', role: 'owner' }],
  });
  p = createPersistence({ appConnectionString: db.appUrl });
  const u = seeded.users.owner!;
  owner = { userId: u.userId, identity: u.email, displayName: u.displayName, role: 'owner', tenantId: seeded.tenantId };
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

function readCurrentUserId(actor: Actor): Promise<string | null> {
  return withTenantTx(p.pool, actor, 'read', async (_db, client) => {
    const r = await client.query<{ uid: string | null }>('SELECT current_user_id() AS uid');
    return r.rows[0]!.uid;
  });
}

describe('current_user_id() — participant GUC (dormant helper)', () => {
  it('reflects the actor userId inside a tenant transaction', async () => {
    expect(await readCurrentUserId(owner)).toBe(owner.userId);
  });

  it('is NULL on a raw connection (GUC never set)', async () => {
    const client = await p.pool.connect();
    try {
      const r = await client.query<{ uid: string | null }>('SELECT current_user_id() AS uid');
      expect(r.rows[0]!.uid).toBeNull();
    } finally {
      client.release();
    }
  });

  it('is NULL when the actor userId is absent/malformed (empty → deny participant match)', async () => {
    const noUid = { ...owner, userId: 'not-a-uuid' } as Actor;
    expect(await readCurrentUserId(noUid)).toBeNull();
  });
});
