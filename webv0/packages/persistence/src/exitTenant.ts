/**
 * exitTenant.ts — Phase-E2 tenant erasure ceremony (Track A, B-5 item 3).
 *
 * Erasure is deliberately a CEREMONY, not an API call (see
 * docs/design/B5-org-scoped-export-and-exit.md §2). This module is the guarded
 * core the owner-run CLI wraps:
 *
 *   - DRY-RUN is the default mode: reports exactly what WOULD be erased and
 *     which guards would block, inside a READ ONLY transaction — it cannot
 *     mutate even in principle.
 *   - EXECUTE requires two independently-typed confirmations of the slug
 *     (requester + second authorizer) and REFUSES while any active user still
 *     holds a membership in the tenant — Phase E1 (access termination) must be
 *     complete before Phase E2 (erasure).
 *   - The erasure itself is ONE transaction: disable the two append-only
 *     triggers → tenant-scoped deletes in FK-safe order → re-enable triggers →
 *     in-transaction zero-row post-checks → commit. Any failure rolls back
 *     everything, including the trigger state (DDL is transactional).
 *   - Shared users (members of another tenant) are never deleted; only
 *     sole-tenant users leave with their org. access_event (platform-level)
 *     and the erasure report itself are retained by design.
 *
 * Packaging contract (HARDEN-0 revision): 'pg' stays a type-only import; the
 * ONLY runtime import is the sibling tenant-table registry — one shared truth
 * for export and exit is the point of H-03 (drift between the two ceremonies
 * is what stranded nine tables).
 */
import type { Client } from 'pg';
import { tenantTablesInExitOrder } from './tenantTables';
import { enumerateTenantBlobs } from './blobUniverse';

export interface ExitOptions {
  readonly tenantSlug: string;
  /** false/undefined = dry-run (default). */
  readonly execute?: boolean;
  /** Must equal tenantSlug to execute (typed by the requester). */
  readonly confirmSlug?: string;
  /** Must equal tenantSlug to execute (typed by the second authorizer). */
  readonly secondConfirm?: string;
}

export interface ExitReport {
  readonly mode: 'dry-run' | 'executed';
  readonly tenant: { id: string; slug: string; name: string };
  /** Members still active (holding a membership in this tenant). >0 blocks execute. */
  readonly activeMembers: number;
  /** Users deleted with the org (this was their only tenant). */
  readonly soleUsers: number;
  /** Users preserved (members of another tenant); their membership rows here are counted in tables. */
  readonly sharedUsers: number;
  /** Rows per table that would be / were erased, in deletion order. */
  readonly tables: Array<{ name: string; rows: number }>;
  /**
   * H-07: DB-known storage objects (documents + photos + intake quarantine) in
   * the blob universe. On execute these are recorded as `blob_tombstone` rows
   * INSIDE the erasure transaction (Phase 1); the CLI deletes + verifies them
   * after commit (Phase 2). A dry-run reports the count without recording.
   */
  readonly blobObjects: number;
  /** Present after execute: every count re-verified zero inside the transaction. */
  readonly postChecks?: { zeroRowsVerified: boolean; tenantRowGone: boolean; triggersReEnabled: boolean };
}

const APPEND_ONLY_TRIGGERS: Array<{ table: string; trigger: string }> = [
  { table: 'audit_event', trigger: 'audit_event_append_only' },
  { table: 'approval_event', trigger: 'approval_event_append_only' },
];

/**
 * HARDEN-0 (H-03): the deletion set comes from the ONE authoritative registry,
 * children before parents via exitRank. Before this, nine newer tables were
 * missing — the final `DELETE FROM tenant` hit their surviving FKs and rolled
 * the whole ceremony back for any tenant using those domains.
 */
const TENANT_TABLES = tenantTablesInExitOrder();

async function count(client: Client, sql: string, params: unknown[]): Promise<number> {
  const r = await client.query<{ n: string }>(sql, params);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Sole-tenant member ids: members of T with no membership anywhere else.
 * Computed BEFORE any deletion so the set is a stable snapshot.
 */
const SOLE_USERS_SQL = `
  SELECT tm.user_id FROM tenant_membership tm
   WHERE tm.tenant_id = $1
     AND NOT EXISTS (SELECT 1 FROM tenant_membership o WHERE o.user_id = tm.user_id AND o.tenant_id <> $1)`;

export async function exitTenant(client: Client, opts: ExitOptions): Promise<ExitReport> {
  const execute = opts.execute === true;

  if (execute) {
    // Dual typed confirmation — both the requester and a second authorizer
    // must have typed the slug. Checked before touching the database.
    if (opts.confirmSlug !== opts.tenantSlug || opts.secondConfirm !== opts.tenantSlug) {
      throw new Error(
        `Execute refused: erasure of '${opts.tenantSlug}' requires BOTH confirmations to match the slug (dual authorization).`,
      );
    }
  }

  await client.query(execute ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    const t = await client.query<{ id: string; slug: string; name: string }>(
      'SELECT id, slug, name FROM tenant WHERE slug = $1',
      [opts.tenantSlug],
    );
    if (t.rowCount === 0) throw new Error(`Unknown tenant '${opts.tenantSlug}'.`);
    const tenant = t.rows[0]!;

    // Guard: Phase E1 must be complete — no ACTIVE user may still hold a
    // membership in this tenant (sole-tenant users deactivated; shared users'
    // membership/role rows removed).
    const activeMembers = await count(
      client,
      `SELECT count(*)::int AS n FROM tenant_membership tm JOIN app_user u ON u.id = tm.user_id
        WHERE tm.tenant_id = $1 AND u.is_active`,
      [tenant.id],
    );
    if (execute && activeMembers > 0) {
      throw new Error(
        `Execute refused: ${activeMembers} active member(s) still hold a membership in '${tenant.slug}'. ` +
          `Complete Phase E1 (access termination) first.`,
      );
    }

    const soleUsers = await count(client, `SELECT count(*)::int AS n FROM (${SOLE_USERS_SQL}) s`, [tenant.id]);
    const memberCount = await count(client, 'SELECT count(*)::int AS n FROM tenant_membership WHERE tenant_id = $1', [tenant.id]);
    const sharedUsers = memberCount - soleUsers;

    const tables: Array<{ name: string; rows: number }> = [];
    for (const name of TENANT_TABLES) {
      tables.push({ name, rows: await count(client, `SELECT count(*)::int AS n FROM ${name} WHERE tenant_id = $1`, [tenant.id]) });
    }
    tables.push({
      name: 'external_identity',
      rows: await count(client, `SELECT count(*)::int AS n FROM external_identity WHERE user_id IN (${SOLE_USERS_SQL})`, [tenant.id]),
    });
    tables.push({ name: 'app_user', rows: soleUsers });
    tables.push({ name: 'tenant', rows: 1 });

    // H-07: enumerate the blob universe WHILE the source rows still exist —
    // documents + photos + intake quarantine, across both storage prefixes.
    const blobs = await enumerateTenantBlobs(client, tenant.id);

    if (!execute) {
      await client.query('COMMIT'); // read-only; nothing to commit, ends the snapshot
      return { mode: 'dry-run', tenant, activeMembers, soleUsers, sharedUsers, tables, blobObjects: blobs.length };
    }

    // ── The ceremony proper (single transaction) ─────────────────────────────
    // Snapshot the sole-user set before membership rows disappear.
    const sole = await client.query<{ user_id: string }>(SOLE_USERS_SQL, [tenant.id]);
    const soleIds = sole.rows.map((r) => r.user_id);

    for (const { table, trigger } of APPEND_ONLY_TRIGGERS) {
      await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${trigger}`);
    }

    // H-07 Phase 1: record every DB-known object in the durable erasure ledger
    // BEFORE the rows that name them are deleted. blob_tombstone is platform-level
    // (tenant_ref, no FK) so it survives the DELETE FROM tenant below and remains
    // as the retryable record the CLI's Phase 2 works from. Idempotent per key.
    for (const b of blobs) {
      await client.query(
        `INSERT INTO blob_tombstone (tenant_ref, storage_key, blob_class, reason)
         VALUES ($1, $2, $3, 'exit') ON CONFLICT (tenant_ref, storage_key, reason) DO NOTHING`,
        [tenant.id, b.storageKey, b.blobClass],
      );
    }

    for (const name of TENANT_TABLES) {
      await client.query(`DELETE FROM ${name} WHERE tenant_id = $1`, [tenant.id]);
    }
    if (soleIds.length > 0) {
      await client.query(`DELETE FROM external_identity WHERE user_id = ANY($1::uuid[])`, [soleIds]);
      await client.query(`DELETE FROM app_user WHERE id = ANY($1::uuid[])`, [soleIds]);
    }
    await client.query('DELETE FROM tenant WHERE id = $1', [tenant.id]);

    for (const { table, trigger } of APPEND_ONLY_TRIGGERS) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    }

    // In-transaction post-checks: refuse to commit a partial erasure.
    let zero = true;
    for (const name of TENANT_TABLES) {
      if ((await count(client, `SELECT count(*)::int AS n FROM ${name} WHERE tenant_id = $1`, [tenant.id])) !== 0) zero = false;
    }
    if (soleIds.length > 0) {
      if ((await count(client, `SELECT count(*)::int AS n FROM app_user WHERE id = ANY($1::uuid[])`, [soleIds])) !== 0) zero = false;
    }
    const tenantRowGone = (await count(client, 'SELECT count(*)::int AS n FROM tenant WHERE id = $1', [tenant.id])) === 0;
    const enabled = await client.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = ANY($1) AND tgenabled = 'O'`,
      [APPEND_ONLY_TRIGGERS.map((x) => x.trigger)],
    );
    const triggersReEnabled = Number(enabled.rows[0]!.n) === APPEND_ONLY_TRIGGERS.length;

    if (!zero || !tenantRowGone || !triggersReEnabled) {
      throw new Error('Post-check failed inside the erasure transaction — rolling back (no partial erasure).');
    }

    await client.query('COMMIT');
    return {
      mode: 'executed',
      tenant,
      activeMembers,
      soleUsers,
      sharedUsers,
      tables,
      blobObjects: blobs.length,
      postChecks: { zeroRowsVerified: zero, tenantRowGone, triggersReEnabled },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}
