import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Actor } from '@c3web/domain';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence } from '../src/stores';

let db: TestDatabase;
let actor: Actor;

beforeAll(async () => {
  db = await startTestDatabase();
  const seeded = await db.seedTenant({
    slug: 'u4-deadline',
    users: [{ key: 'owner', email: 'owner@u4.test', displayName: 'Owner', role: 'owner' }],
  });
  actor = { identity: 'owner@u4.test', displayName: 'Owner', role: 'owner', tenantId: seeded.tenantId };
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('HARDEN-3.7 U4 — signal-gated pre-registration and bounded pool checkout', () => {
  it('a signal fired while queued is re-checked after checkout, before callback/insert', async () => {
    const p = createPersistence({ appConnectionString: db.appUrl, max: 1, poolCheckoutTimeoutMs: 2_000 });
    const holder = await p.pool.connect();
    let holderReleased = false;
    const controller = new AbortController();
    const reason = new Error('request deadline fired while waiting for the pool');
    const key = `${actor.tenantId}/u4-post-checkout-gate`;
    let callbackCalls = 0;

    try {
      const queued = p.writes.transaction(
        actor,
        async (tx) => {
          callbackCalls += 1;
          await tx.insertBlobTombstone({
            storageKey: key,
            blobClass: 'document',
            reason: 'compensation',
            state: 'prepared',
            preparedTtlMs: 60_000,
          });
        },
        { signal: controller.signal },
      );

      await vi.waitFor(() => expect(p.pool.waitingCount).toBe(1), { timeout: 1_000, interval: 10 });
      controller.abort(reason);
      holder.release();
      holderReleased = true;

      await expect(queued).rejects.toBe(reason);
      // RED: removing the post-checkout gate invokes the callback and commits this row.
      expect(callbackCalls).toBe(0);
      const rows = await db.adminQuery<{ n: number }>(
        `SELECT count(*)::int AS n FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`,
        [actor.tenantId, key],
      );
      expect(rows[0]!.n).toBe(0);
    } finally {
      if (!holderReleased) holder.release();
      await p.close();
    }
  });

  it('a saturated checkout fails within the configured bound and the pool remains usable', async () => {
    const p = createPersistence({ appConnectionString: db.appUrl, max: 1, poolCheckoutTimeoutMs: 100 });
    const holder = await p.pool.connect();
    let holderReleased = false;
    const started = Date.now();
    try {
      const checkout = p.writes.transaction(actor, async () => undefined).then(
        () => 'resolved' as const,
        (error: unknown) => error,
      );
      const outcome = await Promise.race([
        checkout,
        new Promise<'still-pending'>((resolve) => setTimeout(() => resolve('still-pending'), 400)),
      ]);
      expect(outcome).not.toBe('still-pending');
      expect(String((outcome as Error).message ?? outcome)).toMatch(/timeout exceeded when trying to connect/i);
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(70);
      expect(elapsed).toBeLessThan(1_000);
      expect(p.pool.waitingCount).toBe(0);
      holder.release();
      holderReleased = true;
      expect((await p.pool.query<{ n: number }>('SELECT 1::int AS n')).rows[0]!.n).toBe(1);
    } finally {
      if (!holderReleased) holder.release();
      await p.close();
    }
  });
});
