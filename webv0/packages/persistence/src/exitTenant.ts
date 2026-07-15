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
import { enumerateTenantBlobs, tenantBlobPrefixes } from './blobUniverse';

/** A4: the minimal object-store surface finalize needs to re-list the tenant prefixes. */
export interface PrefixLister {
  listKeys(prefix: string): Promise<string[]>;
}

export interface ExitOptions {
  /** The tenant slug. Optional only when resuming by `tenantId` (A3). */
  readonly tenantSlug?: string;
  /** A3 (H-07 tail): resume an interrupted exit by tenant UUID — the slug is resolved
   *  from it (the tenant row is present until finalize). One of slug/tenantId is required. */
  readonly tenantId?: string;
  /** false/undefined = dry-run (default). */
  readonly execute?: boolean;
  /** Must equal the resolved slug to execute (typed by the requester). */
  readonly confirmSlug?: string;
  /** R4-N01: how long the data phase waits for in-flight upload leases to drain to zero
   *  before REFUSING (fail-closed; the exit resumes on a re-run). Default 60s. */
  readonly leaseDrainTimeoutMs?: number;
  /** R4-N01: the drain's poll interval. Default 500ms (tests shrink it). */
  readonly leaseDrainPollMs?: number;
  /** Must equal the resolved slug to execute (typed by the second authorizer). */
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
  /** Present after the data phase: DATA rows re-verified zero, tenant still Exiting
   *  (identity held for --finalize), append-only triggers restored. */
  readonly postChecks?: { zeroRowsVerified: boolean; tenantExiting: boolean; triggersReEnabled: boolean };
}

const APPEND_ONLY_TRIGGERS: Array<{ table: string; trigger: string }> = [
  { table: 'audit_event', trigger: 'audit_event_append_only' },
  { table: 'approval_event', trigger: 'approval_event_append_only' },
  // L-03 (0064): comment DELETE is guarded everywhere; the exit ceremony is the sole
  // exception — disable the guard for the data phase so erasure can remove comments.
  { table: 'comment', trigger: 'comment_no_delete' },
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

  // A3 (H-07 tail): resume by UUID — when only the tenant id is known (from the ceremony
  // output), resolve its slug (the tenant row survives until finalize). Everything below
  // keys on the slug, and the dual confirmation is checked against the RESOLVED slug.
  let tenantSlug = opts.tenantSlug;
  if (!tenantSlug) {
    if (!opts.tenantId) throw new Error('exitTenant requires a tenantSlug or a tenantId.');
    const r = await client.query<{ slug: string }>('SELECT slug FROM tenant WHERE id = $1', [opts.tenantId]);
    if (!r.rows[0]) throw new Error(`Unknown tenant id '${opts.tenantId}'.`);
    tenantSlug = r.rows[0].slug;
  }

  if (execute) {
    // Dual typed confirmation — both the requester and a second authorizer
    // must have typed the slug. Checked before touching the database.
    if (opts.confirmSlug !== tenantSlug || opts.secondConfirm !== tenantSlug) {
      throw new Error(
        `Execute refused: erasure of '${tenantSlug}' requires BOTH confirmations to match the slug (dual authorization).`,
      );
    }
  }

  // R2-N01 Phase 0 (execute): mark Exiting in its OWN committed transaction BEFORE
  // we enumerate. This turns on the write-quiesce (no new object can appear during
  // the ceremony) and is the durable resume-by-UUID anchor. Idempotent: re-running
  // on an already-Exiting tenant (a resume) is a no-op.
  if (execute) {
    await client.query('BEGIN');
    try {
      const t0 = await client.query<{ id: string }>('SELECT id FROM tenant WHERE slug = $1', [tenantSlug]);
      if (!t0.rows[0]) throw new Error(`Unknown tenant '${tenantSlug}'.`);
      const active0 = await count(
        client,
        `SELECT count(*)::int AS n FROM tenant_membership tm JOIN app_user u ON u.id = tm.user_id WHERE tm.tenant_id = $1 AND u.is_active`,
        [t0.rows[0].id],
      );
      if (active0 > 0) {
        throw new Error(
          `Execute refused: ${active0} active member(s) still hold a membership in '${tenantSlug}'. Complete Phase E1 (access termination) first.`,
        );
      }
      await client.query(`UPDATE tenant SET exit_state = 'Exiting' WHERE id = $1`, [t0.rows[0].id]);
      // R3-N02: revoke every live intake link IN THE SAME TX as the state flip, so once
      // the tenant is Exiting no new public upload can even start — the route's cheap
      // peek sees a non-Active link and returns 410 before buffering any bytes.
      await client.query(`UPDATE intake_link SET status = 'Revoked' WHERE tenant_id = $1 AND status = 'Active'`, [t0.rows[0].id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    }

    // R4-N01: DRAIN the in-flight upload leases to zero BEFORE enumerating/sweeping. Exiting
    // is committed and every link is revoked, so intake_lease_acquire refuses NEW leases (it
    // takes the tenant lock first — 0068's order — so no acquire can slip past this point
    // unobserved). Any lease still present covers a local request that may still be active:
    // successful claims release it; failed/aborted requests deliberately retain it until TTL
    // expiry. Expired leases no longer block this bounded local drain. This does not assert a
    // maximum provider-side publication delay after local rejection. Fail-closed on drain
    // timeout — re-run resumes.
    {
      const t0 = await client.query<{ id: string }>('SELECT id FROM tenant WHERE slug = $1', [tenantSlug]);
      const tid = t0.rows[0]!.id;
      const timeoutMs = opts.leaseDrainTimeoutMs ?? 60_000;
      const pollMs = opts.leaseDrainPollMs ?? 500;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const live = await count(
          client,
          `SELECT count(*)::int AS n FROM intake_upload_lease WHERE tenant_id = $1 AND expires_at > now()`,
          [tid],
        );
        if (live === 0) break;
        if (Date.now() >= deadline) {
          throw new Error(
            `Exit REFUSED: ${live} in-flight intake upload(s) still hold a lease after ${timeoutMs}ms — ` +
              'wait for them to resolve (or expire) and re-run; the exit resumes from the Exiting state.',
          );
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
    }
  }

  await client.query(execute ? 'BEGIN' : 'BEGIN TRANSACTION READ ONLY');
  try {
    const t = await client.query<{ id: string; slug: string; name: string }>(
      'SELECT id, slug, name FROM tenant WHERE slug = $1',
      [tenantSlug],
    );
    if (t.rowCount === 0) throw new Error(`Unknown tenant '${tenantSlug}'.`);
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

    // ── The DATA-erasure transaction (Phase 1) ───────────────────────────────
    // The tenant is already Exiting (Phase 0, committed) so writers are quiesced
    // and the enumeration above is complete. This tx erases the tenant's DATA and
    // records the blob ledger; the IDENTITY (tenant_membership + sole users +
    // tenant row) is removed later by --finalize.
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

    // R2-N01: delete the tenant DATA only. Keep tenant_membership (so finalize can
    // recompute the sole-user set), the sole app_users, and the tenant row itself —
    // the IDENTITY is removed last, by an explicit --finalize, only after the R2
    // sweep re-verifies zero remaining bytes. Nothing FKs to tenant_membership, so
    // holding it back is safe.
    // R4-N01: ALSO keep intake_link until --finalize. It is the token→tenant attribution;
    // deleting it here would leave a late refused-claim upload (bytes stored before the DB
    // claim) UNATTRIBUTABLE, so intake_tombstone_refused could no longer resolve the tenant
    // and the object would strand after identity is gone. It is revoked in Phase-0 (no new
    // claims) and erased at finalize, after the relist proves both prefixes empty.
    for (const name of TENANT_TABLES) {
      if (name === 'tenant_membership' || name === 'intake_link') continue; // kept until --finalize
      await client.query(`DELETE FROM ${name} WHERE tenant_id = $1`, [tenant.id]);
    }

    for (const { table, trigger } of APPEND_ONLY_TRIGGERS) {
      await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${trigger}`);
    }

    // In-transaction post-checks: refuse to commit a partial erasure. Every DATA
    // table (all but the held-back tenant_membership) must be zero, the tenant
    // must still be Exiting (identity intact for --finalize), and the append-only
    // triggers must be back on.
    let zero = true;
    for (const name of TENANT_TABLES) {
      if (name === 'tenant_membership' || name === 'intake_link') continue; // held until --finalize
      if ((await count(client, `SELECT count(*)::int AS n FROM ${name} WHERE tenant_id = $1`, [tenant.id])) !== 0) zero = false;
    }
    const tenantExiting = (await count(client, `SELECT count(*)::int AS n FROM tenant WHERE id = $1 AND exit_state = 'Exiting'`, [tenant.id])) === 1;
    const enabled = await client.query<{ n: string }>(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = ANY($1) AND tgenabled = 'O'`,
      [APPEND_ONLY_TRIGGERS.map((x) => x.trigger)],
    );
    const triggersReEnabled = Number(enabled.rows[0]!.n) === APPEND_ONLY_TRIGGERS.length;

    if (!zero || !tenantExiting || !triggersReEnabled) {
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
      postChecks: { zeroRowsVerified: zero, tenantExiting, triggersReEnabled },
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

/**
 * R2-N01 --finalize: the POINT OF NO RETURN, a SEPARATE explicit invocation run
 * only after the R2 sweep verified zero remaining bytes. Fail-closed: it refuses
 * unless the tenant is Exiting, EVERY blob_tombstone is resolved (swept), and no
 * DATA row survives — leaving the identity intact for the operator to investigate.
 * On a clean re-verify it removes the identity LAST: tenant_membership → sole
 * external_identity + app_user → the tenant row, with an in-tx post-check.
 *
 * A4 (R3-N01): when a `reader` is supplied, finalize also RE-LISTS both object-store
 * prefixes and is fail-closed on any survivor — the tombstone ledger cannot see an
 * object planted under a prefix AFTER the last sweep (e.g. a late in-flight upload).
 */
export async function finalizeTenantExit(
  client: Client,
  tenantId: string,
  reader?: PrefixLister | null,
): Promise<{ removed: true; soleUsers: number }> {
  // R4-N02: the object-store reader is MANDATORY. Finalize is the point of no return — it must
  // PROVE both prefixes are empty against the LIVE store, because a late in-flight upload can
  // land under a prefix after the last sweep, invisible to the tombstone ledger. A null reader
  // REFUSES rather than skipping the re-list (the old optional-reader path finalized blind).
  if (!reader) {
    throw new Error(
      'Finalize REFUSED: no object-store reader supplied — finalize MUST re-list both blob prefixes ' +
        'against the live store before removing identity (configure R2_*/DOCUMENTS_DIR). Identity left intact.',
    );
  }
  // The prefix re-list is a READ against the object store — do it BEFORE opening the
  // destructive transaction so a survivor refuses without having touched the DB.
  for (const prefix of tenantBlobPrefixes(tenantId)) {
    const keys = await reader.listKeys(prefix);
    if (keys.length > 0) {
      throw new Error(
        `Finalize REFUSED: ${keys.length} object(s) still present under '${prefix}' (planted after the last sweep?) — re-run the sweep and re-verify zero. Identity left intact.`,
      );
    }
  }
  await client.query('BEGIN');
  try {
    // HARDEN-3.5 A-1: pin the tenant row FOR UPDATE **before** the unswept-tombstone check.
    // blob_tombstone.tenant_ref carries NO FK (0046 — the ledger must survive erasure), so the
    // 0076 interlock trigger reads this row FOR SHARE on every tombstone INSERT: an in-flight
    // pre-register either commits BEFORE this lock (the check below then SEES its row and
    // refuses) or BLOCKS here until finalize commits and then fails tenant-missing. The
    // check-then-delete window is atomic against pre-registers.
    const t = await client.query<{ slug: string }>(`SELECT slug FROM tenant WHERE id = $1 AND exit_state = 'Exiting' FOR UPDATE`, [tenantId]);
    if (t.rowCount === 0) {
      throw new Error('Finalize refused: tenant is not in the Exiting state (already finalized, or the data phase never ran).');
    }
    // Fail-closed re-verify: the sweep must have resolved every tombstone (prepared and armed
    // rows BOTH count as unswept — deleted_at IS NULL covers the whole live machine), and no
    // DATA row may remain. Any straggler → refuse, leave identity intact.
    const unswept = await count(client, `SELECT count(*)::int AS n FROM blob_tombstone WHERE tenant_ref = $1 AND deleted_at IS NULL`, [tenantId]);
    if (unswept > 0) {
      throw new Error(`Finalize REFUSED: ${unswept} blob object(s) are still unswept — re-run the sweep and re-verify zero before finalizing. Identity left intact.`);
    }
    for (const name of TENANT_TABLES) {
      // tenant_membership + intake_link are HELD past the data phase (finalize erases them).
      if (name === 'tenant_membership' || name === 'intake_link') continue;
      if ((await count(client, `SELECT count(*)::int AS n FROM ${name} WHERE tenant_id = $1`, [tenantId])) !== 0) {
        throw new Error(`Finalize REFUSED: ${name} still has rows — the data phase is incomplete. Identity left intact.`);
      }
    }

    // Recompute the sole-user set from the still-present memberships, then remove
    // the identity LAST, children first.
    const sole = await client.query<{ user_id: string }>(SOLE_USERS_SQL, [tenantId]);
    const soleIds = sole.rows.map((r) => r.user_id);
    // R4-N01: erase the held-back token→tenant attribution now — after the mandatory relist
    // above proved both prefixes empty (no in-flight upload can still need to be attributed).
    await client.query(`DELETE FROM intake_link WHERE tenant_id = $1`, [tenantId]);
    await client.query(`DELETE FROM tenant_membership WHERE tenant_id = $1`, [tenantId]);
    if (soleIds.length > 0) {
      await client.query(`DELETE FROM external_identity WHERE user_id = ANY($1::uuid[])`, [soleIds]);
      await client.query(`DELETE FROM app_user WHERE id = ANY($1::uuid[])`, [soleIds]);
    }
    await client.query(`DELETE FROM tenant WHERE id = $1`, [tenantId]);

    // Post-check: identity is gone.
    const tenantGone = (await count(client, `SELECT count(*)::int AS n FROM tenant WHERE id = $1`, [tenantId])) === 0;
    const membershipsGone = (await count(client, `SELECT count(*)::int AS n FROM tenant_membership WHERE tenant_id = $1`, [tenantId])) === 0;
    const usersGone = soleIds.length === 0 || (await count(client, `SELECT count(*)::int AS n FROM app_user WHERE id = ANY($1::uuid[])`, [soleIds])) === 0;
    if (!tenantGone || !membershipsGone || !usersGone) {
      throw new Error('Finalize post-check failed inside the transaction — rolling back (identity not removed).');
    }
    await client.query('COMMIT');
    return { removed: true, soleUsers: soleIds.length };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}
