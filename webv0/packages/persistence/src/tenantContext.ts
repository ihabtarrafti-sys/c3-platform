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
  isolation?: 'REPEATABLE READ',
  signal?: AbortSignal,
): Promise<T> {
  const tenantId = actor?.tenantId;
  if (!tenantId || !UUID_RE.test(tenantId)) {
    // Fail closed: never open a transaction without a valid tenant context.
    throw new TenantContextMissingError();
  }

  // HARDEN-3.7 U4: never join the checkout queue after the caller has expired. A signal that
  // fires while queued is checked again immediately after the bounded pool checkout.
  signal?.throwIfAborted();
  const client = await pool.connect();
  let transactionStarted = false;
  try {
    signal?.throwIfAborted();
    // R5-N06 (test-only): a write tx may run at a stricter isolation to reproduce the composed
    // serialization race. Production writes are READ COMMITTED; reads are READ ONLY.
    // L-05b: a batched read may ask for REPEATABLE READ so every SELECT in the
    // transaction shares ONE snapshot — a genuinely coherent one-pass register
    // read (a read-only RR tx cannot hit serialization failures).
    const begin =
      mode === 'read'
        ? isolation === 'REPEATABLE READ'
          ? 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'
          : 'BEGIN READ ONLY'
        : isolation === 'REPEATABLE READ'
          ? 'BEGIN ISOLATION LEVEL REPEATABLE READ'
          : 'BEGIN';
    await client.query(begin);
    transactionStarted = true;
    signal?.throwIfAborted();
    // is_local = true → transaction-scoped, auto-reset at COMMIT/ROLLBACK.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const db = drizzle(client, { schema });
    signal?.throwIfAborted();
    const result = await fn(db, client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Re-exported for callers that need the sql tag against the bound client. */
export { sql };
