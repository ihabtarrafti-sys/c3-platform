/**
 * tenantContext.ts — leak-proof, per-transaction tenant binding.
 *
 * Every tenant-scoped DB access runs inside a transaction that sets
 * `app.tenant_id` with is_local = true, so the setting is scoped to that
 * transaction and is automatically discarded at COMMIT/ROLLBACK. A pooled
 * connection therefore NEVER carries a prior request's tenant context into the
 * next request. Missing/empty tenant fails closed before any SQL runs.
 */
import type { Pool, PoolClient } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { type Actor, TenantContextMissingError } from '@c3web/domain';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function withTenantTx<T>(
  pool: Pool,
  actor: Actor,
  mode: 'read' | 'write',
  fn: (db: Db, client: PoolClient) => Promise<T>,
): Promise<T> {
  const tenantId = actor?.tenantId;
  if (!tenantId || !UUID_RE.test(tenantId)) {
    // Fail closed: never open a transaction without a valid tenant context.
    throw new TenantContextMissingError();
  }

  const client = await pool.connect();
  try {
    await client.query(mode === 'read' ? 'BEGIN READ ONLY' : 'BEGIN');
    // is_local = true → transaction-scoped, auto-reset at COMMIT/ROLLBACK.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const db = drizzle(client, { schema });
    const result = await fn(db, client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* ignore rollback failure */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Re-exported for callers that need the sql tag against the bound client. */
export { sql };
