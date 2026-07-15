import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { sweepTenantBlobErasure, type BlobReader } from '../src/blobBundle';
import type { Queryable } from '../src/blobUniverse';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);

beforeEach(async () => {
  await db.truncateAll();
});

afterAll(async () => {
  await db?.stop();
});

function emptyReader(onList?: () => void): BlobReader {
  return {
    driver: 'fs',
    get: async () => null,
    listKeys: async () => {
      onList?.();
      return [];
    },
    deleteKey: async () => undefined,
    close: () => undefined,
  };
}

describe('HARDEN-3.7 U3 — sweep census/use race and honest verification count', () => {
  it('a real prepared insert after the first census parks at the second census before storage access', async () => {
    const tenant = await db.seedTenant({ slug: 'u3-insert-after-census' });
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    let preparedCensuses = 0;
    let storageLists = 0;
    const key = `${tenant.tenantId}/${randomUUID()}`;

    const racedDb: Queryable = {
      query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await client.query(sql, params);
        if (sql.includes('SELECT count(*)::int AS n') && sql.includes("WHERE tenant_ref = $1 AND state = 'prepared'")) {
          preparedCensuses += 1;
          if (preparedCensuses === 1) {
            // The named Round-8 schedule: this is a separate, committed REAL PostgreSQL insert
            // after census #1 returned zero and before sweep can enumerate/mutate storage.
            await db.adminQuery(
              `INSERT INTO blob_tombstone
                 (tenant_ref, storage_key, blob_class, reason, state, prepared_expires_at)
               VALUES ($1, $2, 'document', 'compensation', 'prepared', now() + interval '5 minutes')`,
              [tenant.tenantId, key],
            );
          }
        }
        return result as { rows: R[]; rowCount?: number | null };
      },
    };

    try {
      await expect(
        sweepTenantBlobErasure(racedDb, emptyReader(() => { storageLists += 1; }), tenant.tenantId),
      ).rejects.toThrow(/parked.*prepared upload intent/i);
      expect(preparedCensuses).toBe(2);
      expect(storageLists).toBe(0);
      const rows = await db.adminQuery<{ state: string; deleted_at: Date | null }>(
        `SELECT state, deleted_at FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`,
        [tenant.tenantId, key],
      );
      // RED: removing census #2 lets the pass resolve while this producer survives prepared.
      expect(rows).toEqual([{ state: 'prepared', deleted_at: null }]);
    } finally {
      await client.end();
    }
  });

  it('does not report verification when the armed-to-swept UPDATE matches zero rows', async () => {
    const tenant = await db.seedTenant({ slug: 'u3-honest-count' });
    const id = randomUUID();
    const key = `${tenant.tenantId}/${randomUUID()}`;
    await db.adminQuery(
      `INSERT INTO blob_tombstone
         (id, tenant_ref, storage_key, blob_class, reason, state)
       VALUES ($1, $2, $3, 'document', 'compensation', 'armed')`,
      [id, tenant.tenantId, key],
    );

    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    let raced = false;
    const racedDb: Queryable = {
      query: async <R extends Record<string, unknown>>(sql: string, params?: unknown[]) => {
        const result = await client.query(sql, params);
        if (!raced && sql.includes('SELECT id, storage_key FROM blob_tombstone')) {
          raced = true;
          // A separate REAL connection wins the state transition after pending selection.
          await db.adminQuery(
            `UPDATE blob_tombstone SET state='swept', deleted_at=now() WHERE id=$1 AND state='armed'`,
            [id],
          );
        }
        return result as { rows: R[]; rowCount?: number | null };
      },
    };

    try {
      const result = await sweepTenantBlobErasure(racedDb, emptyReader(), tenant.tenantId);
      expect(raced).toBe(true);
      // RED: the old unconditional increment reports one despite UPDATE ... WHERE state='armed'
      // matching no row.
      expect(result.verifiedTombstones).toBe(0);
      const rows = await db.adminQuery<{ state: string }>(`SELECT state FROM blob_tombstone WHERE id=$1`, [id]);
      expect(rows).toEqual([{ state: 'swept' }]);
    } finally {
      await client.end();
    }
  });
});
