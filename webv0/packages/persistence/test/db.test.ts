/**
 * db.test.ts — DB integration evidence against a REAL PostgreSQL (embedded when
 * DATABASE_URL is unset). Covers: migrations, constraints, RLS, transaction
 * rollback, optimistic concurrency, execution idempotency, append-only event
 * enforcement, tenant isolation, connection-pool tenant-context isolation, and
 * admin/app connection (role) separation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { markPayout, revokeDistribution, isRetryableSerializationError } from '@c3web/application';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Actor } from '@c3web/domain';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';
import { runMigrations } from '../src/migrate';
import { exitTenant, finalizeTenantExit } from '../src/exitTenant';
import { TENANT_TABLES, tenantTablesInExitOrder } from '../src/tenantTables';

let db: TestDatabase;
let p: PersistenceHandle;

const OWNER = { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner' };
const OPS = { key: 'ops', email: 'ops@a.com', displayName: 'Ops A', role: 'operations' };

let tenantA: string;
let tenantB: string;
let actorA: Actor;
let actorB: Actor;

function ownerActor(tenantId: string, email: string): Actor {
  return { identity: email, displayName: 'Owner', role: 'owner', tenantId };
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
  const a = await db.seedTenant({ slug: 'alpha', users: [OWNER, OPS] });
  const b = await db.seedTenant({ slug: 'bravo', users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }] });
  tenantA = a.tenantId;
  tenantB = b.tenantId;
  actorA = ownerActor(tenantA, 'owner@a.com');
  actorB = ownerActor(tenantB, 'owner@b.com');
});

async function submitApprovalIn(actor: Actor): Promise<{ approvalId: string }> {
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = `APR-${String(seq).padStart(4, '0')}`;
    await tx.insertApproval({
      approvalId,
      operationType: 'AddPerson',
      targetPersonId: 'PENDING-ADDPERSON',
      targetId: null,
      reason: null,
      payload: { operationType: 'AddPerson', input: { fullName: 'Test Person' } },
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({ approvalId, fromStatus: null, toStatus: 'Submitted', actor: actor.identity });
    return { approvalId };
  });
}

describe('migrations & schema', () => {
  it('applied all migrations from an empty database', async () => {
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      const migs = await client.query('SELECT id FROM _migrations ORDER BY id');
      expect(migs.rows.map((r) => r.id)).toEqual(['0001_schema.sql', '0002_rls.sql', '0003_grants.sql', '0004_auth_role_grants.sql', '0005_external_identity.sql', '0006_backup_role_grants.sql', '0007_access_events.sql', '0008_member_admin.sql', '0009_credentials.sql', '0010_journeys.sql', '0011_kit_apparel.sql', '0012_missions.sql', '0013_agreements.sql', '0014_withdrawn_status.sql', '0015_equipment_status.sql', '0016_entities.sql', '0017_money_foundation.sql', '0018_per_diem.sql', '0019_agreement_terms.sql', '0020_governed_agreement_terms.sql', '0021_mission_lines.sql', '0022_entity_level_agreements.sql', '0023_mission_finance_upgrade.sql', '0024_documents.sql', '0025_import_batches.sql', '0026_invoices.sql', '0027_teams.sql', '0028_distributions.sql', '0029_claims.sql', '0030_notifications.sql', '0031_delegations.sql', '0032_people_v2.sql', '0033_credentials_v2_beneficiaries.sql', '0034_harden1.sql', '0035_beneficiary_payee_anchor.sql', '0036_harden2_closure.sql', '0037_tenant_settings.sql', '0038_request_corrections.sql', '0039_comments.sql', '0040_guest_intake.sql', '0041_subscriptions.sql', '0042_departures.sql', '0043_person_photo.sql', '0044_saved_views.sql', '0045_scrub_intake_pii.sql', '0046_blob_tombstone.sql', '0047_reactivate_credential_op.sql', '0048_finance_check_hardening.sql', '0049_settlement_race_guards.sql', '0050_provision_identity_lock.sql', '0051_tombstone_immutability.sql', '0052_settlement_race_guards_v2.sql', '0053_migration_correctives.sql', '0054_departure_deactivation_outbox.sql', '0055_journey_dates_and_comment_immutability.sql', '0056_tenant_exit_state.sql', '0057_exit_quiesce_definer.sql', '0058_approval_revision_outbox.sql', '0059_exit_quiesce_lock.sql', '0060_intake_refused_tombstone.sql', '0061_revision_live_successor_unique.sql', '0062_one_open_deactivate_person.sql', '0063_distribution_share_pay_lock.sql', '0064_comment_delete_guard.sql', '0065_deactivate_open_status_align.sql', '0066_distribution_share_pay_head_write.sql', '0067_intake_tombstone_key_guard.sql', '0068_intake_claim_lock_order.sql', '0069_intake_upload_lease.sql', '0070_compensation_tombstone.sql', '0071_definer_search_path_hardening.sql', '0072_distribution_insert_invariant.sql', '0073_intake_lease_ttl_param.sql', '0074_distribution_every_mutation_invariant.sql', '0075_intake_lease_ttl_bounds.sql', '0076_compensation_state_machine.sql', '0077_tombstone_state_timestamp_coupling.sql', '0078_erased_tenant_prefix.sql', '0079_erased_tenant_prefix_dead_only.sql']);
      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name`,
      );
      const names = tables.rows.map((r) => r.table_name);
      for (const t of ['tenant', 'app_user', 'tenant_membership', 'role_assignment', 'business_id_counter', 'person', 'approval', 'approval_event', 'audit_event']) {
        expect(names).toContain(t);
      }
    } finally {
      await client.end();
    }
  });

  it('HARDEN-3.7 J\u2032: 0078 is permanent global authority with only least-privileged telemetry writes', async () => {
    const admin = new Client({ connectionString: db.adminUrl });
    const app = new Client({ connectionString: db.appUrl });
    const auth = new Client({ connectionString: db.authUrl });
    const backup = new Client({ connectionString: db.backupUrl });
    await Promise.all([admin.connect(), app.connect(), auth.connect(), backup.connect()]);
    const dead = '00000000-0000-4000-8000-000000000078';
    try {
      const columns = await admin.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema='public' AND table_name='erased_tenant_prefix'
          ORDER BY ordinal_position`,
      );
      expect(columns.rows.map((row) => row.column_name)).toEqual([
        'tenant_ref', 'doc_prefix', 'intake_prefix', 'finalized_at',
        'last_swept_at', 'last_result', 'straggler_count',
      ]);
      const posture = await admin.query<{ foreign_keys: number; rls: boolean }>(
        `SELECT
           (SELECT count(*)::int FROM pg_constraint
             WHERE conrelid='erased_tenant_prefix'::regclass AND contype='f') AS foreign_keys,
           (SELECT relrowsecurity FROM pg_class WHERE oid='erased_tenant_prefix'::regclass) AS rls`,
      );
      expect(posture.rows[0]).toEqual({ foreign_keys: 0, rls: false });
      const deadOnlyTrigger = await admin.query<{
        deferrable: boolean; initially_deferred: boolean; definition: string;
      }>(
        `SELECT tgdeferrable AS deferrable,
                tginitdeferred AS initially_deferred,
                pg_get_triggerdef(oid) AS definition
           FROM pg_trigger
          WHERE tgrelid='erased_tenant_prefix'::regclass
            AND tgname='erased_tenant_prefix_dead_only'
            AND NOT tgisinternal`,
      );
      expect(deadOnlyTrigger.rows).toHaveLength(1);
      expect(deadOnlyTrigger.rows[0]).toMatchObject({ deferrable: true, initially_deferred: true });
      expect(deadOnlyTrigger.rows[0]!.definition).toMatch(/AFTER INSERT OR UPDATE OF tenant_ref/i);

      const grants = await admin.query<{
        app_select: boolean; app_insert: boolean; app_delete: boolean;
        app_prefix_update: boolean; app_sweep_update: boolean; app_result_update: boolean; app_count_update: boolean;
        auth_select: boolean; backup_select: boolean;
      }>(
        `SELECT
           has_table_privilege('c3_app','erased_tenant_prefix','SELECT') AS app_select,
           has_table_privilege('c3_app','erased_tenant_prefix','INSERT') AS app_insert,
           has_table_privilege('c3_app','erased_tenant_prefix','DELETE') AS app_delete,
           has_column_privilege('c3_app','erased_tenant_prefix','doc_prefix','UPDATE') AS app_prefix_update,
           has_column_privilege('c3_app','erased_tenant_prefix','last_swept_at','UPDATE') AS app_sweep_update,
           has_column_privilege('c3_app','erased_tenant_prefix','last_result','UPDATE') AS app_result_update,
           has_column_privilege('c3_app','erased_tenant_prefix','straggler_count','UPDATE') AS app_count_update,
           has_table_privilege('c3_auth','erased_tenant_prefix','SELECT') AS auth_select,
           has_table_privilege('c3_backup','erased_tenant_prefix','SELECT') AS backup_select`,
      );
      expect(grants.rows[0]).toEqual({
        app_select: true,
        app_insert: false,
        app_delete: false,
        app_prefix_update: false,
        app_sweep_update: true,
        app_result_update: true,
        app_count_update: true,
        auth_select: false,
        backup_select: true,
      });

      await admin.query(
        `INSERT INTO erased_tenant_prefix (tenant_ref, doc_prefix, intake_prefix)
         VALUES ($1, $2, $3)`,
        [dead, `${dead}/`, `intake/${dead}/`],
      );
      await expect(admin.query(
        `INSERT INTO erased_tenant_prefix (tenant_ref, doc_prefix, intake_prefix)
         VALUES ('00000000-0000-4000-8000-000000000080','neighbour/','intake/00000000-0000-4000-8000-000000000080/')`,
      )).rejects.toThrow(/erased_tenant_prefix_doc_canonical_chk/i);
      // No tenant context is set: the platform janitor can see every dead row.
      expect((await app.query(`SELECT count(*)::int AS n FROM erased_tenant_prefix`)).rows[0].n).toBe(1);
      await app.query(
        `UPDATE erased_tenant_prefix
            SET last_swept_at=now(), last_result='{"status":"clean"}', straggler_count=straggler_count+1
          WHERE tenant_ref=$1`,
        [dead],
      );
      await expect(app.query(`UPDATE erased_tenant_prefix SET doc_prefix='other/' WHERE tenant_ref=$1`, [dead]))
        .rejects.toThrow(/permission denied/i);
      await expect(app.query(
        `INSERT INTO erased_tenant_prefix (tenant_ref, doc_prefix, intake_prefix)
         VALUES ('00000000-0000-4000-8000-000000000079','00000000-0000-4000-8000-000000000079/','intake/00000000-0000-4000-8000-000000000079/')`,
      )).rejects.toThrow(/permission denied/i);
      await expect(app.query(`DELETE FROM erased_tenant_prefix WHERE tenant_ref=$1`, [dead]))
        .rejects.toThrow(/permission denied/i);
      await expect(auth.query(`SELECT * FROM erased_tenant_prefix`)).rejects.toThrow(/permission denied/i);
      expect((await backup.query(`SELECT count(*)::int AS n FROM erased_tenant_prefix`)).rows[0].n).toBe(1);
    } finally {
      await Promise.all([admin.end(), app.end(), auth.end(), backup.end()]);
    }
  });

  it('HARDEN-3.6 T8: a throwing post-lock logger still closes the advisory-lock client', async () => {
    const countMigratorLocks = async () => Number((await db.adminQuery<{ n: string }>(
      `SELECT count(*) AS n FROM pg_locks
        WHERE locktype='advisory' AND classid=928340015`,
    ))[0]!.n);
    const before = await countMigratorLocks();
    await expect(runMigrations({
      adminConnectionString: db.adminUrl,
      appRole: 'c3_app', appPassword: 'c3_app_dev_pw',
      authRole: 'c3_auth', authPassword: 'c3_auth_dev_pw',
      backupRole: 'c3_backup', backupPassword: 'c3_backup_dev_pw',
      allowDevSecrets: true,
      log: () => { throw new Error('injected logger failure after advisory lock'); },
    })).rejects.toThrow(/injected logger failure/);
    expect(await countMigratorLocks()).toBe(before);
  });

  it('H-03: the tenant-table registry covers the LIVE catalog exactly — export/exit cannot silently lag the schema', async () => {
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      const res = await client.query(`
        SELECT c.table_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
           AND t.table_type = 'BASE TABLE'
         ORDER BY c.table_name
      `);
      const catalog = res.rows.map((r: { table_name: string }) => r.table_name).sort();
      const registry = [...TENANT_TABLES.map((t) => t.name)].sort();
      expect(registry, 'registry must equal every live table carrying tenant_id').toEqual(catalog);
      // exit order is a permutation of the registry (nothing dropped in sorting)
      expect([...tenantTablesInExitOrder()].sort()).toEqual(registry);
      // every export projection actually runs against the live schema
      const t0 = await client.query(`SELECT id FROM tenant LIMIT 1`);
      const anyTenant = (t0.rows[0]?.id as string) ?? '00000000-0000-0000-0000-000000000000';
      for (const spec of TENANT_TABLES) {
        await client.query(spec.exportSql, [anyTenant]); // throws on a stale column list
      }
    } finally {
      await client.end();
    }
  });

  it('H-10: every tenant FK child exits before its parent (exit cannot roll back on a surviving FK)', async () => {
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      const rank = new Map(TENANT_TABLES.map((t) => [t.name, t.exitRank] as const));
      const fks = await client.query<{ child: string; parent: string; conname: string }>(`
        SELECT child.relname AS child, parent.relname AS parent, con.conname
          FROM pg_constraint con
          JOIN pg_class child  ON child.oid  = con.conrelid
          JOIN pg_class parent ON parent.oid = con.confrelid
         WHERE con.contype = 'f' AND child.relname <> parent.relname
      `);
      const offenders: string[] = [];
      for (const fk of fks.rows) {
        const childRank = rank.get(fk.child);
        const parentRank = rank.get(fk.parent);
        // Only FKs where BOTH ends are registered tenant tables — FKs to
        // `tenant` / directory tables are the bespoke final DELETE's job.
        if (childRank === undefined || parentRank === undefined) continue;
        if (childRank >= parentRank) offenders.push(`${fk.child}(${childRank}) → ${fk.parent}(${parentRank}) [${fk.conname}]`);
      }
      expect(offenders, 'child must exit (lower rank) before its parent').toEqual([]);
    } finally {
      await client.end();
    }
  });

  it('M-16: no exported column is a raw DATE — every date is cast ::text (date-as-text law)', async () => {
    const DATE_OID = 1082; // pg_type oid for `date`
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      const t0 = await client.query(`SELECT id FROM tenant LIMIT 1`);
      const anyTenant = (t0.rows[0]?.id as string) ?? '00000000-0000-0000-0000-000000000000';
      const offenders: string[] = [];
      for (const spec of TENANT_TABLES) {
        const res = await client.query({ text: `SELECT * FROM (${spec.exportSql}) _probe LIMIT 0`, values: [anyTenant] });
        for (const f of res.fields) if (f.dataTypeID === DATE_OID) offenders.push(`${spec.name}.${f.name}`);
      }
      expect(offenders, 'these exported columns are raw DATE — cast them ::text').toEqual([]);
    } finally {
      await client.end();
    }
  });

  it('HARDEN-1 H-04: concurrent owner demotions cannot leave a tenant ownerless (two real connections)', async () => {
    // A fresh tenant with TWO active owners.
    await db.truncateAll();
    const t = await db.seedTenant({
      slug: 'race',
      users: [
        { key: 'o1', email: 'o1@race.com', displayName: 'Owner One', role: 'owner' },
        { key: 'o2', email: 'o2@race.com', displayName: 'Owner Two', role: 'owner' },
      ],
    });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const ids = await admin.query(
        `SELECT u.id, u.email FROM app_user u JOIN tenant_membership m ON m.user_id = u.id WHERE m.tenant_id = $1 ORDER BY u.email`,
        [t.tenantId],
      );
      const [o1, o2] = ids.rows as Array<{ id: string; email: string }>;

      // Two REAL app connections, each demoting the OTHER owner concurrently.
      // Before H-04 both last-owner checks could pass (check-then-write); the
      // 0034 advisory lock serializes them so exactly one is refused.
      const c1 = new Client({ connectionString: db.appUrl });
      const c2 = new Client({ connectionString: db.appUrl });
      await c1.connect();
      await c2.connect();
      try {
        await c1.query('BEGIN');
        await c1.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
        await c2.query('BEGIN');
        await c2.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);

        const settled = await Promise.allSettled([
          c1.query(`SELECT member_set_role($1::uuid, 'operations', $2)`, [o2!.id, o1!.email]).then(() => c1.query('COMMIT')),
          c2.query(`SELECT member_set_role($1::uuid, 'operations', $2)`, [o1!.id, o2!.email]).then(() => c2.query('COMMIT')),
        ]);
        const failures = settled.filter((s) => s.status === 'rejected');
        expect(failures.length, 'exactly one demotion must be refused').toBe(1);
        expect(String((failures[0] as PromiseRejectedResult).reason)).toMatch(/LAST_OWNER_PROTECTED/);
        await c1.query('ROLLBACK').catch(() => {});
        await c2.query('ROLLBACK').catch(() => {});

        const owners = await admin.query(
          `SELECT count(*)::int AS n FROM role_assignment ra JOIN app_user u ON u.id = ra.user_id
            WHERE ra.tenant_id = $1 AND ra.role = 'owner' AND u.is_active`,
          [t.tenantId],
        );
        expect(owners.rows[0].n, 'the tenant must never be ownerless').toBeGreaterThanOrEqual(1);
      } finally {
        await c1.end().catch(() => {});
        await c2.end().catch(() => {});
      }
    } finally {
      await admin.end();
    }
  });

  it('0050 (M-01): concurrent provisioning of one identity is serialized — no ghost user', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'prov' });
    const args = ['newbie@prov.com', 'New Bie', 'operations', 'entra', 'issuer-x', 'subject-x'];
    const c1 = new Client({ connectionString: db.appUrl });
    const c2 = new Client({ connectionString: db.appUrl });
    await c1.connect();
    await c2.connect();
    try {
      await c1.query('BEGIN');
      await c1.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await c2.query('BEGIN');
      await c2.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);

      // Both provision the SAME new identity at once. The 0050 advisory lock
      // serializes them: the winner creates the user + membership; the loser
      // blocks, re-reads the committed identity, and is refused CLEANLY as an
      // existing member — never a raw unique-violation and never a second user.
      const provision = (c: InstanceType<typeof Client>) =>
        c.query(`SELECT member_provision($1,$2,$3,$4,$5,$6)`, args).then(() => c.query('COMMIT'));
      const settled = await Promise.allSettled([provision(c1), provision(c2)]);
      const ok = settled.filter((s) => s.status === 'fulfilled');
      const failed = settled.filter((s) => s.status === 'rejected');
      expect(ok.length, 'exactly one provision wins').toBe(1);
      expect(failed.length).toBe(1);
      expect(String((failed[0] as PromiseRejectedResult).reason)).toMatch(/already a member/i);
      await c1.query('ROLLBACK').catch(() => {});
      await c2.query('ROLLBACK').catch(() => {});
    } finally {
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
    }

    // exactly ONE user for that email — the race left no duplicate/ghost.
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const n = await admin.query(`SELECT count(*)::int AS n FROM app_user WHERE email = 'newbie@prov.com'`);
      expect(n.rows[0].n, 'no ghost user').toBe(1);
    } finally {
      await admin.end();
    }
  });

  it('0051 (R2-N06): blob_tombstone is append-and-mark-only — identity frozen, deleted_at monotonic', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'tomb' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const ins = await admin.query(
        `INSERT INTO blob_tombstone (tenant_ref, storage_key, blob_class, reason) VALUES ($1, 'tomb/obj-1', 'document', 'exit') RETURNING id`,
        [t.tenantId],
      );
      const id = ins.rows[0].id as string;

      // The trigger freezes identity/key/class/reason/created even for admin.
      await expect(admin.query(`UPDATE blob_tombstone SET storage_key = 'tomb/hacked' WHERE id = $1`, [id])).rejects.toThrow(/identity is immutable/i);
      await expect(admin.query(`UPDATE blob_tombstone SET tenant_ref = gen_random_uuid() WHERE id = $1`, [id])).rejects.toThrow(/identity is immutable/i);
      await expect(admin.query(`UPDATE blob_tombstone SET blob_class = 'photo' WHERE id = $1`, [id])).rejects.toThrow(/identity is immutable/i);
      await expect(admin.query(`UPDATE blob_tombstone SET reason = 'intake_reject' WHERE id = $1`, [id])).rejects.toThrow(/identity is immutable/i);

      // Resolution bookkeeping is writable; terminal timestamp rides the legal armed→swept
      // transition, then remains monotonic (0077 state/timestamp coupling).
      await admin.query(`UPDATE blob_tombstone SET attempts = attempts + 1, last_error = 'retry' WHERE id = $1`, [id]);
      await admin.query(`UPDATE blob_tombstone SET state='swept', deleted_at = now() WHERE id = $1`, [id]);
      await expect(admin.query(`UPDATE blob_tombstone SET deleted_at = NULL WHERE id = $1`, [id])).rejects.toThrow(/monotonic/i);
    } finally {
      await admin.end();
    }

    // The app role cannot even NAME an identity column in an UPDATE (column grant).
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await expect(c.query(`UPDATE blob_tombstone SET storage_key = 'x' WHERE tenant_ref = $1`, [t.tenantId])).rejects.toThrow(/permission denied|column/i);
      await c.query('ROLLBACK').catch(() => {});
    } finally {
      await c.end();
    }
  });

  it('0055 (L-03): comment is append-only — UPDATE is DB-refused even for a privileged role', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'cmt' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query(`INSERT INTO comment (tenant_id, subject_type, subject_id, author, body) VALUES ($1,'Person','PER-1','a@b.com','original')`, [t.tenantId]);
      // The trigger refuses UPDATE (append-only), even for the admin/BYPASSRLS role.
      await expect(admin.query(`UPDATE comment SET body='tampered' WHERE subject_id='PER-1'`)).rejects.toThrow(/append-only/i);
      // The row is untouched.
      const [row] = (await admin.query(`SELECT body FROM comment WHERE subject_id='PER-1'`)).rows;
      expect(row.body).toBe('original');
    } finally {
      await admin.end();
    }
  });

  it('0056 (R2-N01): an Exiting tenant refuses new blob writes (quiesced); Active tenants are unaffected', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'quiesce' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-Q','P')`, [t.tenantId]);
      const doc = (key: string) =>
        admin.query(
          `INSERT INTO document (tenant_id, document_id, owner_type, owner_id, file_name, content_type, size_bytes, sha256, storage_key, uploaded_by)
           VALUES ($1,$2,'Person','PER-Q','f.pdf','application/pdf',100,$3,$4,'u@x.com')`,
          [t.tenantId, key, 'a'.repeat(64), `${t.tenantId}/${key}`],
        );

      // Active: a document write + a photo write both succeed.
      await doc('DOC-1');
      await admin.query(`UPDATE person SET photo_storage_key='k1', photo_sha256=$1 WHERE person_id='PER-Q'`, ['b'.repeat(64)]);

      // Mark the tenant Exiting → new blob-referencing writes are DB-refused.
      await admin.query(`UPDATE tenant SET exit_state='Exiting' WHERE id=$1`, [t.tenantId]);
      await expect(doc('DOC-2')).rejects.toThrow(/exiting/i);
      await expect(admin.query(`UPDATE person SET photo_storage_key='k2', photo_sha256=$1 WHERE person_id='PER-Q'`, ['c'.repeat(64)])).rejects.toThrow(/exiting/i);
      // A non-blob person edit is still allowed (only photo-SET is quiesced).
      await admin.query(`UPDATE person SET full_name='Renamed' WHERE person_id='PER-Q'`);
    } finally {
      await admin.end();
    }
  });

  it('R3-N02: the quiesce trigger LOCKS the tenant row (FOR SHARE) so the Exiting transition serializes with in-flight writers', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'lockco' });
    const writer = new Client({ connectionString: db.adminUrl });
    const exiter = new Client({ connectionString: db.adminUrl });
    await writer.connect();
    await exiter.connect();
    try {
      await writer.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-L','P')`, [t.tenantId]);
      // Writer opens a tx and inserts a blob row for the (Active) tenant. The quiesce
      // trigger's UNCONDITIONAL `SELECT … FOR SHARE` takes a share lock on the tenant
      // row and HOLDS it for the open tx (on the old conditional form it locked nothing).
      await writer.query('BEGIN');
      await writer.query(
        `INSERT INTO document (tenant_id, document_id, owner_type, owner_id, file_name, content_type, size_bytes, sha256, storage_key, uploaded_by)
         VALUES ($1,'DOC-L','Person','PER-L','f','application/pdf',10,$2,$3,'u@x.com')`,
        [t.tenantId, 'a'.repeat(64), `${t.tenantId}/doc-l`],
      );
      // The Exiting transition needs FOR NO KEY UPDATE on that row → it CONFLICTS with the
      // writer's share lock and blocks. A short statement_timeout turns the block into a
      // deterministic error (GREEN). On the lock-free/conditional trigger the UPDATE would
      // not block and would succeed → this expectation fails (RED), proving the lock works.
      await exiter.query(`SET statement_timeout = '600ms'`);
      await expect(
        exiter.query(`UPDATE tenant SET exit_state = 'Exiting' WHERE id = $1`, [t.tenantId]),
      ).rejects.toThrow(/statement timeout|canceling statement/i);
    } finally {
      await writer.query('ROLLBACK').catch(() => {});
      await writer.end();
      await exiter.end();
    }
  });

  it('R3-N03: a SECOND live successor per source is DB-refused under a real two-connection race (0061 partial-unique)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'forkco' });
    const cA = new Client({ connectionString: db.adminUrl });
    const cB = new Client({ connectionString: db.adminUrl });
    await cA.connect();
    await cB.connect();
    const insApproval = (c: Client, aid: string, revOf: string | null, status: string) =>
      c.query(
        `INSERT INTO approval (tenant_id, approval_id, operation_type, target_person_id, target_id, status, payload, submitted_by, revision_of)
         VALUES ($1,$2,'AddPerson','PENDING-ADDPERSON',NULL,$3,$4::jsonb,'u@x.com',$5)`,
        [t.tenantId, aid, status, JSON.stringify({ operationType: 'AddPerson', input: { fullName: 'x' } }), revOf],
      );
    try {
      await insApproval(cA, 'APR-SRC', null, 'Rejected'); // the source

      // Two connections both try to create a LIVE successor for APR-SRC concurrently.
      await cA.query('BEGIN');
      await insApproval(cA, 'APR-S1', 'APR-SRC', 'Submitted'); // A's successor (uncommitted)
      await cB.query('BEGIN');
      const bInsert = insApproval(cB, 'APR-S2', 'APR-SRC', 'Submitted'); // BLOCKS on the unique
      await cA.query('COMMIT'); // A wins → B must fail
      await expect(bInsert).rejects.toThrow(/duplicate key|unique|approval_one_live_successor/i);
      await cB.query('ROLLBACK').catch(() => {});

      // exactly one live successor; a WITHDRAWN successor is still allowed (excluded).
      expect((await cA.query(`SELECT count(*)::int n FROM approval WHERE revision_of='APR-SRC' AND status<>'Withdrawn'`)).rows[0].n).toBe(1);
      await expect(insApproval(cA, 'APR-S3', 'APR-SRC', 'Withdrawn')).resolves.toBeDefined();
    } finally {
      await cA.end();
      await cB.end();
    }
  });

  it('R3-N04: a SECOND open DeactivatePerson per person is DB-refused under a real two-connection race (0062)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'depco' });
    const cA = new Client({ connectionString: db.adminUrl });
    const cB = new Client({ connectionString: db.adminUrl });
    await cA.connect();
    await cB.connect();
    const insDeact = (c: Client, aid: string, status: string) =>
      c.query(
        `INSERT INTO approval (tenant_id, approval_id, operation_type, target_person_id, target_id, status, payload, submitted_by)
         VALUES ($1,$2,'DeactivatePerson','PER-X',NULL,$3,$4::jsonb,'u@x.com')`,
        [t.tenantId, aid, status, JSON.stringify({ operationType: 'DeactivatePerson', input: { personId: 'PER-X' } })],
      );
    try {
      await cA.query('BEGIN');
      await insDeact(cA, 'APR-D1', 'Submitted'); // A's open DeactivatePerson (uncommitted)
      await cB.query('BEGIN');
      const bInsert = insDeact(cB, 'APR-D2', 'Submitted'); // BLOCKS on the unique
      await cA.query('COMMIT'); // A wins → B must fail
      await expect(bInsert).rejects.toThrow(/duplicate key|unique|deactivate_person/i);
      await cB.query('ROLLBACK').catch(() => {});

      // exactly one OPEN DeactivatePerson; a terminal (Withdrawn) one is still allowed.
      expect(
        (await cA.query(
          `SELECT count(*)::int n FROM approval WHERE operation_type='DeactivatePerson' AND target_person_id='PER-X' AND status IN ('Submitted','InReview','Approved')`,
        )).rows[0].n,
      ).toBe(1);
      await expect(insDeact(cA, 'APR-D3', 'Withdrawn')).resolves.toBeDefined();
    } finally {
      await cA.end();
      await cB.end();
    }
  });

  it('R4-N01: intake_link SURVIVES the data phase (attribution stays live for a late refused upload); finalize erases it', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'attrco' });
    const admin = new Client({ connectionString: db.adminUrl });
    const app = new Client({ connectionString: db.appUrl });
    await admin.connect(); await app.connect();
    try {
      const u = await admin.query<{ id: string }>(`INSERT INTO app_user (email, display_name, is_active) VALUES ('g@attr.com','G',false) RETURNING id`);
      await admin.query(`INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2)`, [t.tenantId, u.rows[0]!.id]);
      await admin.query(`INSERT INTO intake_link (tenant_id, token_hash, kind, created_by, expires_at) VALUES ($1,'tok-attr','Onboarding','o@attr.com', now()+interval '1 day')`, [t.tenantId]);

      // Data phase: DATA erased, identity + intake_link HELD (tenant Exiting).
      await exitTenant(admin, { tenantSlug: 'attrco', execute: true, confirmSlug: 'attrco', secondConfirm: 'attrco' });

      // R4-N01: the token→tenant attribution SURVIVED the data phase (old code deleted it here).
      expect((await admin.query(`SELECT count(*)::int n FROM intake_link WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(1);
      // So a late refused-claim upload can STILL be attributed + durably tombstoned via the token
      // (on old code intake_tombstone_refused would resolve NULL and strand the bytes).
      const key = `intake/${t.tenantId}/late-sub/late-up`;
      expect((await app.query(`SELECT intake_tombstone_refused('tok-attr', ARRAY[$1]) AS n`, [key])).rows[0].n).toBe(1);
      expect((await admin.query(`SELECT count(*)::int n FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`, [t.tenantId, key])).rows[0].n).toBe(1);

      // Sweep the late tombstone, then finalize (clean reader) → attribution erased LAST.
      await admin.query(`UPDATE blob_tombstone SET state='swept', deleted_at=now() WHERE tenant_ref=$1 AND state='armed'`, [t.tenantId]);
      await finalizeTenantExit(admin, t.tenantId, { listKeys: async () => [] });
      expect((await admin.query(`SELECT count(*)::int n FROM intake_link WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(0);
    } finally {
      await admin.end(); await app.end();
    }
  });

  it('R5-N03: EVERY SECURITY DEFINER function ends its search_path with pg_temp (catalog invariant) (0071)', async () => {
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      // pg_proc.proconfig holds the SET clauses as 'key=value' strings. Assert every
      // prosecdef function in public sets search_path AND that its LAST element is pg_temp —
      // so any future definer missing it fails the gate (mirrors the tenantTables guard).
      const rows = (await admin.query<{ sig: string; proconfig: string[] | null }>(`
        SELECT p.oid::regprocedure::text AS sig, p.proconfig
          FROM pg_proc p
         WHERE p.prosecdef AND p.pronamespace = 'public'::regnamespace
      `)).rows;
      expect(rows.length).toBeGreaterThan(0);
      const offenders: string[] = [];
      for (const r of rows) {
        const sp = (r.proconfig ?? []).find((c) => c.toLowerCase().startsWith('search_path='));
        if (!sp) { offenders.push(`${r.sig} (no search_path)`); continue; }
        const value = sp.slice('search_path='.length);
        const last = value.split(',').map((s) => s.trim().replace(/^"|"$/g, '')).pop();
        if (last !== 'pg_temp') offenders.push(`${r.sig} (ends '${last}')`);
      }
      expect(offenders, `definers missing a trailing pg_temp: ${offenders.join('; ')}`).toEqual([]);
    } finally {
      await admin.end();
    }
  });

  it('R5-N03: a pg_temp table shadowing intake_link is IGNORED — the definer resolves the canonical table (0071)', async () => {
    await db.truncateAll();
    const real = await db.seedTenant({ slug: 'shadowco' });
    const app = new Client({ connectionString: db.appUrl });
    await app.connect();
    try {
      await app.query(`SELECT set_config('app.tenant_id',$1,true)`, [real.tenantId]); // harmless; definer is DEFINER-scoped
      // As the restricted c3_app role, forge a temp intake_link that maps the attacker's
      // token to a tenant of their choosing. Under 'search_path = public' this would be
      // consulted FIRST; under 'public, pg_temp' it is ignored.
      await app.query(`CREATE TEMPORARY TABLE intake_link (id uuid, tenant_id uuid, token_hash text, status text, kind text, expires_at timestamptz, used_count int, max_uses int, consumed_at timestamptz)`);
      await app.query(`INSERT INTO intake_link (id, tenant_id, token_hash, status, kind, expires_at, used_count, max_uses) VALUES (gen_random_uuid(), $1, 'forged-tok', 'Active', 'Onboarding', now()+interval '1 day', 0, 1)`, [real.tenantId]);
      // The forged token does NOT exist in public.intake_link → the definer must resolve NULL
      // (returns 0), NOT the shadow's row. A shadow-consulting definer would tombstone.
      const n = (await app.query(`SELECT intake_tombstone_refused('forged-tok', ARRAY['intake/${real.tenantId}/x/y']) AS n`)).rows[0]!.n;
      expect(n).toBe(0); // canonical table has no such token → nothing attributed

      // And a REAL token in the canonical table still works despite the shadow being present.
      const admin = new Client({ connectionString: db.adminUrl });
      await admin.connect();
      try {
        await admin.query(`INSERT INTO intake_link (tenant_id, token_hash, kind, created_by, expires_at) VALUES ($1,'real-tok','Onboarding','o@s.com', now()+interval '1 day')`, [real.tenantId]);
        expect((await app.query(`SELECT intake_tombstone_refused('real-tok', ARRAY['intake/${real.tenantId}/a/b']) AS n`)).rows[0]!.n).toBe(1);
      } finally {
        await admin.end();
      }
    } finally {
      await app.end();
    }
  });

  it('R4-N01: a LIVE in-flight upload lease BLOCKS the exit data phase until released (drain-to-zero) (0069)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'leaseco' });
    const admin = new Client({ connectionString: db.adminUrl });
    const app = new Client({ connectionString: db.appUrl });
    const chk = new Client({ connectionString: db.adminUrl });
    await admin.connect(); await app.connect(); await chk.connect();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      await admin.query(`INSERT INTO intake_link (tenant_id, token_hash, kind, created_by, expires_at) VALUES ($1,'tok-lease','Onboarding','o@l.com', now()+interval '1 day')`, [t.tenantId]);
      await admin.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-L2','P')`, [t.tenantId]);

      // A REAL in-flight upload: the route acquires a lease (as c3_app, via the definer)
      // right after the peek, before streaming bytes.
      const leaseId = (await app.query(`SELECT intake_lease_acquire('tok-lease', 900000) AS id`)).rows[0]!.id as string;
      expect(leaseId).toBeTruthy();

      // The exit executes. It must PARK at the drain while the lease is live — the data
      // phase (which would erase PER-L2) cannot start under an in-flight upload.
      const exitP = exitTenant(admin, { tenantSlug: 'leaseco', execute: true, confirmSlug: 'leaseco', secondConfirm: 'leaseco', leaseDrainPollMs: 50, leaseDrainTimeoutMs: 30_000 });
      const raced = await Promise.race([exitP.then(() => 'completed' as const), sleep(2_500).then(() => 'still-draining' as const)]);
      expect(raced).toBe('still-draining'); // RED without the drain: the exit completes immediately
      expect((await chk.query(`SELECT count(*)::int n FROM person WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(1); // data untouched
      // Phase-0 already committed (Exiting + links revoked) → a NEW acquire is refused,
      // so the drain can only ever shrink.
      expect((await app.query(`SELECT intake_lease_acquire('tok-lease', 900000) AS id`)).rows[0]!.id).toBeNull();

      // The upload resolves (claimed or refused+tombstoned) → release → the exit converges.
      await app.query(`SELECT intake_lease_release($1)`, [leaseId]);
      const report = await exitP;
      expect(report.mode).toBe('executed');
      expect((await chk.query(`SELECT count(*)::int n FROM person WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(0);
    } finally {
      await admin.end(); await app.end(); await chk.end();
    }
  }, 40_000);

  it('D3 (R6-N07): the lease TTL is DB-bounded — out-of-range values RAISE; an in-range TTL stores the exact expiry (0075)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'ttlbound' });
    const admin = new Client({ connectionString: db.adminUrl });
    const app = new Client({ connectionString: db.appUrl });
    await admin.connect(); await app.connect();
    try {
      await admin.query(`INSERT INTO intake_link (tenant_id, token_hash, kind, created_by, expires_at) VALUES ($1,'tok-ttl','Onboarding','o@t.com', now()+interval '1 day')`, [t.tenantId]);
      // R6-N07: 0073 accepted the int4 maximum (≈24.8 DAYS — the exit drain waits 60s). 0075
      // caps the parameter at 2h and floors it at 1s; each violation RAISEs loudly.
      for (const bad of [2_147_483_647, 7_200_001, 999, 0, -1]) {
        await expect(app.query(`SELECT intake_lease_acquire('tok-ttl', ${bad}) AS id`)).rejects.toThrow(/between 1000 ms .* and 7200000 ms|R6-N07/i);
      }
      // The boundary values are accepted, and the STORED expiry matches the requested TTL.
      const atCap = (await app.query(`SELECT intake_lease_acquire('tok-ttl', 7200000) AS id`)).rows[0]!.id as string;
      expect(atCap).toBeTruthy();
      const row = await admin.query(
        `SELECT extract(epoch FROM (expires_at - now())) AS secs FROM intake_upload_lease WHERE id = $1`, [atCap],
      );
      const secs = Number(row.rows[0]!.secs);
      expect(secs).toBeGreaterThan(7195); // ~2h out (allow a few seconds of test latency)
      expect(secs).toBeLessThanOrEqual(7200);
      await app.query(`SELECT intake_lease_release($1)`, [atCap]);
      const atFloor = (await app.query(`SELECT intake_lease_acquire('tok-ttl', 1000) AS id`)).rows[0]!.id as string;
      expect(atFloor).toBeTruthy();
      await app.query(`SELECT intake_lease_release($1)`, [atFloor]);
    } finally {
      await admin.end(); await app.end();
    }
  });

  it('R4-N08: intake_claim locks the TENANT before the intake_link (global order tenant → link) (0068)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'lockord' });
    const admin = new Client({ connectionString: db.adminUrl });
    const hold = new Client({ connectionString: db.adminUrl });
    const claim = new Client({ connectionString: db.adminUrl });
    const obs = new Client({ connectionString: db.adminUrl });
    await admin.connect(); await hold.connect(); await claim.connect(); await obs.connect();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      await admin.query(
        `INSERT INTO intake_link (tenant_id, token_hash, kind, created_by, expires_at) VALUES ($1,'tok-lo','Onboarding','o@lo.com', now()+interval '1 day')`,
        [t.tenantId],
      );
      const claimPid = (await claim.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid;

      // An exit-style holder takes the TENANT row lock first (as Phase-0 does).
      await hold.query('BEGIN');
      await hold.query(`SELECT id FROM tenant WHERE id=$1 FOR NO KEY UPDATE`, [t.tenantId]);

      // The claim fires. WITH the fix its FIRST lock is the tenant FOR SHARE → it BLOCKS on the
      // holder and never reaches the link. WITHOUT the fix it grabs the link FOR UPDATE first.
      await claim.query('BEGIN');
      const claimP = claim.query(`SELECT link_id FROM intake_claim('tok-lo')`).then(() => 'done' as const, () => 'err' as const);

      // Wait until the claim SETTLES: blocked on a lock (fixed) or idle-in-txn (old, it finished).
      for (let i = 0; i < 200; i++) {
        const r = await obs.query<{ wait_event_type: string | null; state: string | null }>(
          'SELECT wait_event_type, state FROM pg_stat_activity WHERE pid=$1', [claimPid],
        );
        const row = r.rows[0];
        if (row?.wait_event_type === 'Lock' || row?.state === 'idle in transaction') break;
        await sleep(25);
      }

      // The crux: with tenant-first ordering the claim is blocked on the tenant and has NOT
      // locked the link, so a third connection can lock the link immediately. With the old
      // link-first order the claim already holds the link → this NOWAIT would fail (55P03).
      await expect(obs.query(`SELECT id FROM intake_link WHERE token_hash='tok-lo' FOR UPDATE NOWAIT`)).resolves.toBeDefined();

      await hold.query('ROLLBACK'); // release the tenant → the (fixed) claim converges
      await claimP;
      await claim.query('ROLLBACK').catch(() => {});
    } finally {
      await admin.end(); await hold.end(); await claim.end(); await obs.end();
    }
  });

  it('R4-N02: finalizeTenantExit REFUSES without an object-store reader (the re-list is mandatory)', async () => {
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      // The reader check is the FIRST thing finalize does (before touching the DB), so it fires
      // regardless of tenant state. A null/absent reader must refuse with a reader-specific error
      // — on the old optional-reader path it would instead skip the re-list and reach the DB.
      await expect(finalizeTenantExit(admin, '00000000-0000-0000-0000-000000000000', null)).rejects.toThrow(/object-store reader|re-list both blob prefixes/i);
      await expect(finalizeTenantExit(admin, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(/object-store reader/i);
    } finally {
      await admin.end();
    }
  });

  it('R4-N03: the intake_tombstone_refused definer rejects keys outside the token tenant (no cross-tenant tombstone) (0067)', async () => {
    await db.truncateAll();
    const a = await db.seedTenant({ slug: 'tomba' });
    const b = await db.seedTenant({ slug: 'tombb' });
    const admin = new Client({ connectionString: db.adminUrl });
    const app = new Client({ connectionString: db.appUrl });
    await admin.connect();
    await app.connect();
    try {
      await admin.query(
        `INSERT INTO intake_link (tenant_id, token_hash, kind, created_by, expires_at) VALUES ($1,'tok-A','Onboarding','o@a.com', now()+interval '1 day')`,
        [a.tenantId],
      );
      const bKey = `intake/${b.tenantId}/sub-1/up-1`; // a key that belongs to tenant B
      const aKey = `intake/${a.tenantId}/sub-1/up-1`; // a key in the token tenant's own namespace

      // The definer runs as owner (bypasses RLS); called as c3_app it must REFUSE a foreign key.
      await expect(app.query(`SELECT intake_tombstone_refused('tok-A', ARRAY[$1])`, [bKey])).rejects.toThrow(/cross-tenant tombstone|outside the token tenant/i);
      // A path-traversal escape under the right prefix is also refused.
      await expect(app.query(`SELECT intake_tombstone_refused('tok-A', ARRAY[$1])`, [`intake/${a.tenantId}/../${b.tenantId}/x`])).rejects.toThrow(/cross-tenant|outside/i);
      // NOTHING was recorded — no tombstone for B's key exists (checked as owner, RLS-bypassing).
      expect((await admin.query(`SELECT count(*)::int n FROM blob_tombstone WHERE storage_key=$1`, [bKey])).rows[0].n).toBe(0);

      // A legitimate key in the token tenant's OWN namespace still records a tombstone.
      expect((await app.query(`SELECT intake_tombstone_refused('tok-A', ARRAY[$1]) AS n`, [aKey])).rows[0].n).toBe(1);
      expect((await admin.query(`SELECT count(*)::int n FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2 AND reason='intake_refused'`, [a.tenantId, aKey])).rows[0].n).toBe(1);
    } finally {
      await admin.end();
      await app.end();
    }
  });

  it('R4-N06: ExecutionFailed counts as OPEN — a held ExecutionFailed DeactivatePerson refuses every open newcomer (0065)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'depco2' });
    const c = new Client({ connectionString: db.adminUrl });
    await c.connect();
    const insDeact = (aid: string, status: string) =>
      c.query(
        `INSERT INTO approval (tenant_id, approval_id, operation_type, target_person_id, target_id, status, payload, submitted_by)
         VALUES ($1,$2,'DeactivatePerson','PER-Y',NULL,$3,$4::jsonb,'u@x.com')`,
        [t.tenantId, aid, status, JSON.stringify({ operationType: 'DeactivatePerson', input: { personId: 'PER-Y' } })],
      );
    try {
      // The incumbent is ExecutionFailed — the domain treats it as open/recoverable. Under the
      // OLD (0062) index it was EXCLUDED, so a fresh Submitted slipped past the DB and coexisted
      // (the bug). 0065 includes it, so the incumbent now blocks every open newcomer.
      await insDeact('APR-EF', 'ExecutionFailed');
      let apr = 0;
      for (const status of ['Submitted', 'InReview', 'Approved', 'ExecutionFailed']) {
        await expect(insDeact(`APR-N${apr++}`, status)).rejects.toThrow(/duplicate key|unique|deactivate_person/i);
      }
      // A terminal status is still allowed alongside (a person can be re-deactivated later).
      await expect(insDeact('APR-TERM', 'Withdrawn')).resolves.toBeDefined();
      expect(
        (await c.query(
          `SELECT count(*)::int n FROM approval WHERE operation_type='DeactivatePerson' AND target_person_id='PER-Y' AND status IN ('Submitted','InReview','Approved','ExecutionFailed')`,
        )).rows[0].n,
      ).toBe(1); // only the ExecutionFailed incumbent
    } finally {
      await c.end();
    }
  });

  it('R3.2 L-03: a privileged comment DELETE is DB-refused; the exit ceremony (guard disabled) still erases it', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'cmtco' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const u = await admin.query<{ id: string }>(`INSERT INTO app_user (email, display_name, is_active) VALUES ('g@cmt.com','G',false) RETURNING id`);
      await admin.query(`INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2)`, [t.tenantId, u.rows[0]!.id]);
      await admin.query(`UPDATE app_user SET is_active=false WHERE id IN (SELECT user_id FROM tenant_membership WHERE tenant_id=$1)`, [t.tenantId]);
      await admin.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-C','P')`, [t.tenantId]);
      await admin.query(`INSERT INTO comment (tenant_id, subject_type, subject_id, author, body) VALUES ($1,'Person','PER-C','a@x.com','a retained note')`, [t.tenantId]);

      // A privileged single-row DELETE is refused (today it would succeed — red).
      await expect(admin.query(`DELETE FROM comment WHERE tenant_id=$1`, [t.tenantId])).rejects.toThrow(/append-only|not permitted/i);
      expect((await admin.query(`SELECT count(*)::int n FROM comment WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(1);

      // The exit ceremony IS the exception — it disables comment_no_delete for the data
      // phase, so erasure removes the comment (proving the sole bypass works).
      await exitTenant(admin, { tenantSlug: 'cmtco', execute: true, confirmSlug: 'cmtco', secondConfirm: 'cmtco' });
      expect((await admin.query(`SELECT count(*)::int n FROM comment WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(0);
    } finally {
      await admin.end();
    }
  });

  it('A4: finalize RE-LISTS both prefixes and REFUSES when an object was planted after the sweep', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'relistco' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const u = await admin.query<{ id: string }>(`INSERT INTO app_user (email, display_name, is_active) VALUES ('gone@relist.com','G',false) RETURNING id`);
      await admin.query(`INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2)`, [t.tenantId, u.rows[0]!.id]);
      await admin.query(`UPDATE app_user SET is_active=false WHERE id IN (SELECT user_id FROM tenant_membership WHERE tenant_id=$1)`, [t.tenantId]);
      // Data phase → tenant Exiting, data erased, no blobs (so no tombstones): finalize-ready.
      await exitTenant(admin, { tenantSlug: 'relistco', execute: true, confirmSlug: 'relistco', secondConfirm: 'relistco' });

      // A survivor planted under the tenant prefix AFTER the sweep — invisible to the
      // row/tombstone checks, caught only by the prefix re-list. Finalize must REFUSE.
      const plantedReader = { listKeys: async (prefix: string) => (prefix === `${t.tenantId}/` ? [`${t.tenantId}/planted`] : []) };
      await expect(finalizeTenantExit(admin, t.tenantId, plantedReader)).rejects.toThrow(/still present under|planted after/i);
      // identity untouched (finalize refused before the destructive tx).
      expect((await admin.query(`SELECT count(*)::int n FROM tenant WHERE id=$1`, [t.tenantId])).rows[0].n).toBe(1);

      // With a clean re-list (prefixes empty), finalize proceeds to the point of no return.
      const cleanReader = { listKeys: async () => [] as string[] };
      const fin = await finalizeTenantExit(admin, t.tenantId, cleanReader);
      expect(fin.removed).toBe(true);
      expect((await admin.query(`SELECT count(*)::int n FROM tenant WHERE id=$1`, [t.tenantId])).rows[0].n).toBe(0);
    } finally {
      await admin.end();
    }
  });

  it('HARDEN-3.7 J\u2032: finalize and permanent authority commit or roll back together', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({
      slug: 'jprime-atomic',
      users: [{ key: 'owner', email: 'owner@jprime-atomic.test', displayName: 'Owner', role: 'owner' }],
    });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    let triggerInstalled = false;
    try {
      await admin.query(
        `UPDATE app_user SET is_active=false
          WHERE id IN (SELECT user_id FROM tenant_membership WHERE tenant_id=$1)`,
        [t.tenantId],
      );
      await exitTenant(admin, {
        tenantSlug: 'jprime-atomic', execute: true,
        confirmSlug: 'jprime-atomic', secondConfirm: 'jprime-atomic',
      });

      await admin.query(`
        CREATE FUNCTION harden37_reject_tenant_delete() RETURNS trigger
        LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected tenant delete failure'; END $$;
        CREATE TRIGGER harden37_reject_tenant_delete
          BEFORE DELETE ON tenant FOR EACH ROW EXECUTE FUNCTION harden37_reject_tenant_delete();
      `);
      triggerInstalled = true;
      await expect(finalizeTenantExit(admin, t.tenantId, { listKeys: async () => [] }))
        .rejects.toThrow(/injected tenant delete failure/i);
      expect((await admin.query(`SELECT count(*)::int AS n FROM tenant WHERE id=$1`, [t.tenantId])).rows[0].n).toBe(1);
      expect((await admin.query(`SELECT count(*)::int AS n FROM tenant_membership WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(1);
      expect((await admin.query(`SELECT count(*)::int AS n FROM erased_tenant_prefix WHERE tenant_ref=$1`, [t.tenantId])).rows[0].n).toBe(0);

      await admin.query(`DROP TRIGGER harden37_reject_tenant_delete ON tenant; DROP FUNCTION harden37_reject_tenant_delete()`);
      triggerInstalled = false;
      await finalizeTenantExit(admin, t.tenantId, { listKeys: async () => [] });
      expect((await admin.query(`SELECT count(*)::int AS n FROM tenant WHERE id=$1`, [t.tenantId])).rows[0].n).toBe(0);
      const authority = await admin.query<{
        doc_prefix: string; intake_prefix: string; finalized_at: Date;
      }>(
        `SELECT doc_prefix, intake_prefix, finalized_at
           FROM erased_tenant_prefix WHERE tenant_ref=$1`,
        [t.tenantId],
      );
      expect(authority.rows).toEqual([{
        doc_prefix: `${t.tenantId}/`,
        intake_prefix: `intake/${t.tenantId}/`,
        finalized_at: expect.any(Date),
      }]);
    } finally {
      if (triggerInstalled) {
        await admin.query(`DROP TRIGGER IF EXISTS harden37_reject_tenant_delete ON tenant; DROP FUNCTION IF EXISTS harden37_reject_tenant_delete()`).catch(() => {});
      }
      await admin.end();
    }
  });

  it('A3: an exit executes/resumes BY tenant UUID (slug resolved internally, dual-confirm against the resolved slug)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'resumeco' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const u = await admin.query<{ id: string }>(`INSERT INTO app_user (email, display_name, is_active) VALUES ('g@resume.com','G',false) RETURNING id`);
      await admin.query(`INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2)`, [t.tenantId, u.rows[0]!.id]);
      await admin.query(`UPDATE app_user SET is_active=false WHERE id IN (SELECT user_id FROM tenant_membership WHERE tenant_id=$1)`, [t.tenantId]);
      await admin.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-R','P')`, [t.tenantId]);

      // Resume/execute BY UUID — no slug passed. Today's code compares confirmSlug to an
      // undefined opts.tenantSlug and refuses (red); A3 resolves the slug from the id first.
      const report = await exitTenant(admin, { tenantId: t.tenantId, execute: true, confirmSlug: 'resumeco', secondConfirm: 'resumeco' });
      expect(report.mode).toBe('executed');
      expect(report.postChecks?.tenantExiting).toBe(true);
      expect((await admin.query(`SELECT exit_state FROM tenant WHERE id=$1`, [t.tenantId])).rows[0].exit_state).toBe('Exiting');
      expect((await admin.query(`SELECT count(*)::int n FROM person WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(0);
    } finally {
      await admin.end();
    }
  });

  it('R2-N01: exit data-phase holds identity Exiting; --finalize is fail-closed on unswept blobs, removes identity only when clean', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'exitco' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      // A sole member, deactivated (Phase E1 complete), plus a document (a blob).
      const u = await admin.query<{ id: string }>(`INSERT INTO app_user (email, display_name, is_active) VALUES ('gone@exitco.com','Gone',false) RETURNING id`);
      const uid = u.rows[0]!.id;
      await admin.query(`INSERT INTO tenant_membership (tenant_id, user_id) VALUES ($1,$2)`, [t.tenantId, uid]);
      // any user seedTenant created must also be inactive so the exit isn't blocked.
      await admin.query(`UPDATE app_user SET is_active=false WHERE id IN (SELECT user_id FROM tenant_membership WHERE tenant_id=$1)`, [t.tenantId]);
      await admin.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-E','P')`, [t.tenantId]);
      await admin.query(
        `INSERT INTO document (tenant_id, document_id, owner_type, owner_id, file_name, content_type, size_bytes, sha256, storage_key, uploaded_by)
         VALUES ($1,'DOC-E','Person','PER-E','f.pdf','application/pdf',10,$2,$3,'u@x.com')`,
        [t.tenantId, 'a'.repeat(64), `${t.tenantId}/doc-e`],
      );
      // M-06: a PII-bearing revise-intent row MUST be erased by the exit ceremony
      // (it is registered in tenantTables, so the data phase deletes + zero-checks it).
      await admin.query(
        `INSERT INTO approval_revision (tenant_id, source_approval_id, operation_type, payload, submitted_by)
         VALUES ($1,'APR-0001','AddPerson',$2::jsonb,'u@x.com')`,
        [t.tenantId, JSON.stringify({ operationType: 'AddPerson', input: { fullName: 'Private Name' } })],
      );

      // Data phase: erases DATA, tombstones the blob, holds identity in Exiting.
      const report = await exitTenant(admin, { tenantSlug: 'exitco', execute: true, confirmSlug: 'exitco', secondConfirm: 'exitco' });
      expect(report.mode).toBe('executed');
      expect(report.postChecks?.tenantExiting).toBe(true);
      expect((await admin.query(`SELECT count(*)::int n FROM document WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(0);
      expect((await admin.query(`SELECT count(*)::int n FROM approval_revision WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(0); // M-06 PII swept
      expect((await admin.query(`SELECT exit_state FROM tenant WHERE id=$1`, [t.tenantId])).rows[0].exit_state).toBe('Exiting');
      expect((await admin.query(`SELECT count(*)::int n FROM tenant_membership WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(1);
      expect((await admin.query(`SELECT count(*)::int n FROM app_user WHERE id=$1`, [uid])).rows[0].n).toBe(1);
      const tomb = await admin.query<{ deleted_at: string | null }>(`SELECT deleted_at FROM blob_tombstone WHERE tenant_ref=$1 AND reason='exit'`, [t.tenantId]);
      expect(tomb.rowCount).toBe(1);
      expect(tomb.rows[0]!.deleted_at).toBeNull();

      // --finalize REFUSES while the tombstone is unswept — identity left intact.
      await expect(finalizeTenantExit(admin, t.tenantId, { listKeys: async () => [] })).rejects.toThrow(/unswept|REFUSED/i);
      expect((await admin.query(`SELECT count(*)::int n FROM tenant WHERE id=$1`, [t.tenantId])).rows[0].n).toBe(1);

      // Sweep resolves the tombstone → finalize succeeds, identity removed LAST.
      await admin.query(`UPDATE blob_tombstone SET state='swept', deleted_at=now() WHERE tenant_ref=$1 AND state='armed'`, [t.tenantId]);
      const fin = await finalizeTenantExit(admin, t.tenantId, { listKeys: async () => [] });
      expect(fin.removed).toBe(true);
      expect(fin.soleUsers).toBeGreaterThanOrEqual(1);
      expect((await admin.query(`SELECT count(*)::int n FROM tenant WHERE id=$1`, [t.tenantId])).rows[0].n).toBe(0);
      expect((await admin.query(`SELECT count(*)::int n FROM tenant_membership WHERE tenant_id=$1`, [t.tenantId])).rows[0].n).toBe(0);
      expect((await admin.query(`SELECT count(*)::int n FROM app_user WHERE id=$1`, [uid])).rows[0].n).toBe(0);
    } finally {
      await admin.end();
    }
  });

  it('0035: the beneficiary payee anchor — exactly one of person|freelancer|vendor, per-payee label law', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'payee' });
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      const begin = async () => {
        await c.query('BEGIN');
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
        // 0036: the person seat is now a composite FK — anchor to a real person.
        await c.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1, 'PER-9001', 'Payee Test')`, [t.tenantId]);
      };
      const insert = (id: string, person: string | null, freelancer: string | null, vendor: string | null, label = 'main') =>
        c.query(
          `INSERT INTO beneficiary (tenant_id, beneficiary_id, person_id, freelancer_id, vendor_id, label, bank_name, bank_country, currency)
           VALUES ($1, $2, $3, $4, $5, $6, 'ESA', 'UAE', 'AED')`,
          [t.tenantId, id, person, freelancer, vendor, label],
        );

      // zero anchors refused; two anchors refused
      await begin();
      await expect(insert('BEN-9001', null, null, null)).rejects.toThrow(/beneficiary_exactly_one_payee/);
      await c.query('ROLLBACK');
      await begin();
      await expect(insert('BEN-9002', 'PER-9001', 'FRL-9001', null)).rejects.toThrow(/beneficiary_exactly_one_payee/);
      await c.query('ROLLBACK');

      // each single seat works — the dormant seats are schema-ready today
      await begin();
      await insert('BEN-9003', 'PER-9001', null, null, 'person route');
      await insert('BEN-9004', null, 'FRL-9001', null, 'freelancer route');
      await insert('BEN-9005', null, null, 'VEN-9001', 'vendor route');
      // per-PAYEE label law: same label on DIFFERENT payees is fine…
      await insert('BEN-9006', null, 'FRL-9002', null, 'person route');
      // …but a duplicate live label on the SAME payee is refused
      await expect(insert('BEN-9007', 'PER-9001', null, null, 'PERSON ROUTE')).rejects.toThrow(/beneficiary_live_label_per_payee/);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  it('HARDEN-1 H-05: the database refuses Paid-under-revoked and line edits under a LIVE distribution', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'h5' });
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      const q = async (text: string, params: unknown[] = []) => c.query(text, params);
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1, 'MSN-9001', 'H5', '2026-06-01')`, [t.tenantId]);
      // 0036: share→person is now a composite FK — anchor to a real person.
      await q(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1, 'PER-9001', 'H5 Payee')`, [t.tenantId]);
      await q(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
         VALUES ($1, 'PNL-9001', 'MSN-9001', 'Income', 'PrizeMoney', 'Prize', 100000, 'USD', 'Received')`,
        [t.tenantId],
      );
      await q(
        `INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by)
         VALUES ($1, 'DIST-9001', 'MSN-9001', 'PNL-9001', 100000, 'USD', 0, 0, 'Live', 'owner@h5.com')`,
        [t.tenantId],
      );
      await q(
        `INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor)
         VALUES ($1, 'DIST-9001', 'PER-9001', 10000, 100000)`,
        [t.tenantId],
      );
      await q('COMMIT');

      // H-05b: the line's money truth is FROZEN while the head is Live.
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await expect(q(`UPDATE mission_line SET amount_minor = 999999 WHERE line_id = 'PNL-9001'`)).rejects.toThrow(/LIVE distribution/);
      await q('ROLLBACK');

      // revoke the head, then H-05a: a payout cannot flip to Paid under it.
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`UPDATE distribution SET status = 'Revoked', revoked_reason = 'test' WHERE distribution_id = 'DIST-9001'`);
      await expect(
        q(`UPDATE distribution_share SET payout_status = 'Paid' WHERE distribution_id = 'DIST-9001' AND person_id = 'PER-9001'`),
      ).rejects.toThrow(/LIVE distribution/);
      await q('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  it('0052 (H-04): a Settled mission freezes child money facts — DELETE + per-diem INSERT refused, concurrent settlement serialized', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'h4' });
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      const q = (text: string, params: unknown[] = []) => c.query(text, params);
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-4001','H4','2026-06-01')`, [t.tenantId]);
      await q(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-4001','H4 P')`, [t.tenantId]);
      await q(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
         VALUES ($1,'PNL-4001','MSN-4001','Income','PrizeMoney','Prize',100000,'USD','Received')`,
        [t.tenantId],
      );
      await q('COMMIT');

      // c3_app: a per-diem INSERT under Settled is refused (0049 guarded only UPDATE).
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`UPDATE mission SET finance_stage='Settled' WHERE mission_id='MSN-4001'`);
      await expect(
        q(`INSERT INTO mission_participant (tenant_id, mission_id, person_id, role, per_diem_amount_minor, per_diem_currency)
           VALUES ($1,'MSN-4001','PER-4001','Player',5000,'USD')`, [t.tenantId]),
      ).rejects.toThrow(/per-diem is frozen|settled/i);
      await q('ROLLBACK');
    } finally {
      await c.end();
    }

    // admin/raw path: a line DELETE under Settled is refused (0049 covered only
    // INSERT/UPDATE; c3_app has no DELETE grant, so the trigger guards this path).
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await admin.query('BEGIN');
      await admin.query(`UPDATE mission SET finance_stage='Settled' WHERE mission_id='MSN-4001'`);
      await expect(admin.query(`DELETE FROM mission_line WHERE line_id='PNL-4001'`)).rejects.toThrow(/settled or inactive/);
      await admin.query('ROLLBACK');
    } finally {
      await admin.end();
    }

    // Two real connections: the trigger's parent FOR UPDATE serializes a child
    // write issued BEFORE settlement so it cannot commit AFTER settlement.
    const cA = new Client({ connectionString: db.appUrl });
    const cB = new Client({ connectionString: db.appUrl });
    await cA.connect();
    await cB.connect();
    try {
      await cA.query('BEGIN');
      await cA.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await cB.query('BEGIN');
      await cB.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      // A holds the mission head lock (as settlement does).
      await cA.query(`SELECT 1 FROM mission WHERE mission_id='MSN-4001' FOR UPDATE`);
      // B's child write blocks on the trigger's FOR UPDATE of the same head.
      const bWrite = cB.query(`UPDATE mission_line SET label='changed' WHERE line_id='PNL-4001'`);
      // A settles + commits, releasing the lock.
      await cA.query(`UPDATE mission SET finance_stage='Settled' WHERE mission_id='MSN-4001'`);
      await cA.query('COMMIT');
      // B unblocks, sees Settled, and is refused — no post-settlement child write.
      await expect(bWrite).rejects.toThrow(/settled or inactive/);
      await cB.query('ROLLBACK').catch(() => {});
    } finally {
      await cA.end().catch(() => {});
      await cB.end().catch(() => {});
    }
  });

  it('0052 (H-05 inverse + R2-N02): a Live head with Paid shares cannot leave Live; a Settled mission\'s dates are frozen', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'h5i' });
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      const q = (text: string, params: unknown[] = []) => c.query(text, params);
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`INSERT INTO mission (tenant_id, mission_id, name, starts_on, ends_on) VALUES ($1,'MSN-5001','H5i','2026-06-01','2026-06-10')`, [t.tenantId]);
      await q(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-5001','P')`, [t.tenantId]);
      await q(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
         VALUES ($1,'PNL-5001','MSN-5001','Income','PrizeMoney','P',100000,'USD','Received')`,
        [t.tenantId],
      );
      await q(
        `INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by)
         VALUES ($1,'DIST-5001','MSN-5001','PNL-5001',100000,'USD',0,0,'Live','o@h.com')`,
        [t.tenantId],
      );
      await q(`INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor) VALUES ($1,'DIST-5001','PER-5001',10000,100000)`, [t.tenantId]);
      // Pay the share while the head is Live (allowed by the 0034 guard). Paid
      // demands paid_on + a payment-source label (0036 shape CHECK).
      await q(`UPDATE distribution_share SET payout_status='Paid', paid_on='2026-06-15', payment_source_label='Bank Transfer' WHERE distribution_id='DIST-5001' AND person_id='PER-5001'`);
      await q('COMMIT');

      // H-05 inverse: revoking the Live head while a Paid share exists is refused.
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await expect(q(`UPDATE distribution SET status='Revoked', revoked_reason='x' WHERE distribution_id='DIST-5001'`)).rejects.toThrow(/PAID shares/);
      await q('ROLLBACK');

      // R2-N02: a Settled mission's economically-relevant dates are frozen.
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`UPDATE mission SET finance_stage='Settled' WHERE mission_id='MSN-5001'`);
      await expect(q(`UPDATE mission SET starts_on='2026-07-01' WHERE mission_id='MSN-5001'`)).rejects.toThrow(/dates are frozen/);
      await q('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  it('R3-N05: concurrent head-revoke vs share-pay serialize on the head — invariant holds, one refused (0063)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'toctou' });
    const cA = new Client({ connectionString: db.appUrl });
    const cB = new Client({ connectionString: db.appUrl });
    await cA.connect();
    await cB.connect();
    try {
      // seed a Live distribution + a Pending share.
      await cA.query('BEGIN');
      await cA.query(`SELECT set_config('app.tenant_id',$1,true)`, [t.tenantId]);
      await cA.query(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-T','T','2026-06-01')`, [t.tenantId]);
      await cA.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-T','P')`, [t.tenantId]);
      await cA.query(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
         VALUES ($1,'PNL-T','MSN-T','Income','PrizeMoney','P',100000,'USD','Received')`,
        [t.tenantId],
      );
      await cA.query(
        `INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by)
         VALUES ($1,'DIST-T','MSN-T','PNL-T',100000,'USD',0,0,'Live','o@t.com')`,
        [t.tenantId],
      );
      await cA.query(`INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor) VALUES ($1,'DIST-T','PER-T',10000,100000)`, [t.tenantId]);
      await cA.query('COMMIT');

      // Race, ordered so the fix's lock is HELD ACROSS THE WAIT (a deterministic reproduce):
      // cB pays the share FIRST — WITH the fix its guard takes the head FOR UPDATE and holds
      // it uncommitted. cA then revokes the head: its UPDATE needs the head's row lock, which
      // (with the fix) CONFLICTS with cB's FOR UPDATE → cA blocks. Without the fix cB never
      // locks the head, so cA proceeds on a stale (Pending) read and both commit → violation.
      await cB.query('BEGIN');
      await cB.query(`SELECT set_config('app.tenant_id',$1,true)`, [t.tenantId]);
      await cB.query(
        `UPDATE distribution_share SET payout_status='Paid', paid_on='2026-06-15', payment_source_label='Bank' WHERE distribution_id='DIST-T' AND person_id='PER-T'`,
      );
      await cA.query('BEGIN');
      await cA.query(`SELECT set_config('app.tenant_id',$1,true)`, [t.tenantId]);
      const bRevoke = cA.query(`UPDATE distribution SET status='Revoked', revoked_reason='x' WHERE distribution_id='DIST-T'`);
      await cB.query('COMMIT'); // share Paid committed → cA (blocked) unblocks; its guard now sees Paid
      await expect(bRevoke).rejects.toThrow(/PAID shares|CONFLICT/i);
      await cA.query('ROLLBACK').catch(() => {});

      // Invariant holds: a Paid share remains under a still-LIVE head (the revoke was refused).
      const chk = new Client({ connectionString: db.appUrl });
      await chk.connect();
      try {
        await chk.query('BEGIN');
        await chk.query(`SELECT set_config('app.tenant_id',$1,true)`, [t.tenantId]);
        expect((await chk.query(`SELECT status FROM distribution WHERE distribution_id='DIST-T'`)).rows[0].status).toBe('Live');
        expect((await chk.query(`SELECT payout_status FROM distribution_share WHERE distribution_id='DIST-T'`)).rows[0].payout_status).toBe('Paid');
        await chk.query('COMMIT');
      } finally {
        await chk.end();
      }
    } finally {
      await cA.end();
      await cB.end();
    }
  });

  it('R2-N03: distribution-create and settlement lock mission→line in the SAME order (no deadlock cycle)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'n3' });
    const seed = new Client({ connectionString: db.appUrl });
    await seed.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await seed.query(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-3001','N3','2026-06-01')`, [t.tenantId]);
      await seed.query(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
         VALUES ($1,'PNL-3001','MSN-3001','Income','PrizeMoney','P',100000,'USD','Received')`,
        [t.tenantId],
      );
      await seed.query('COMMIT');
    } finally {
      await seed.end();
    }

    const cA = new Client({ connectionString: db.appUrl }); // "settlement": mission → line
    const cB = new Client({ connectionString: db.appUrl }); // "distribution-create" (fixed): mission → line
    await cA.connect();
    await cB.connect();
    try {
      await cA.query('BEGIN');
      await cA.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await cB.query('BEGIN');
      await cB.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);

      // A takes the mission head. B — now that createDistribution locks the head
      // FIRST too — blocks HARMLESSLY on the head (not a cycle) instead of grabbing
      // the line first and waiting on A for the mission (the old deadlock shape).
      await cA.query(`SELECT 1 FROM mission WHERE mission_id='MSN-3001' FOR UPDATE`);
      const bHead = cB.query(`SELECT 1 FROM mission WHERE mission_id='MSN-3001' FOR UPDATE`);
      await cA.query(`SELECT 1 FROM mission_line WHERE line_id='PNL-3001' FOR UPDATE`);
      await cA.query('COMMIT'); // releases mission + line
      await bHead; // B acquires the head — no deadlock (would reject with 40P01 otherwise)
      await cB.query(`SELECT 1 FROM mission_line WHERE line_id='PNL-3001' FOR UPDATE`);
      await cB.query('COMMIT');
    } finally {
      await cA.end().catch(() => {});
      await cB.end().catch(() => {});
    }
  });

  it('0053 (R2-N05): re-derives gated PII from the authoritative payload and strips the multiline notes residual', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'n5' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const link = await admin.query(
        `INSERT INTO intake_link (tenant_id, token_hash, kind, created_by, expires_at) VALUES ($1,'th-n5','Onboarding','o@n5.com', now()+interval '1 day') RETURNING id`,
        [t.tenantId],
      );
      const payload = JSON.stringify({ fullName: 'N5 Person', email: 'real@x.com', phone: '+971500000000', dateOfBirth: '1990-01-01', addressLine1: '12 Marina Walk', apparelSize: 'L', note: 'hello there' });
      await admin.query(
        `INSERT INTO intake_submission (tenant_id, link_id, kind, payload, status, reviewed_by, reviewed_at, promoted_approval_id, promoted_person_id)
         VALUES ($1,$2,'Onboarding',$3::jsonb,'Promoted','o@n5.com', now(), 'APR-9999', 'PER-N5')`,
        [t.tenantId, link.rows[0].id, payload],
      );
      // A person whose gated email was MANUFACTURED from a free-text note by 0045,
      // and whose notes still carry a multiline address residual (0045 stripped
      // only the first line of the address value).
      const notes = 'Self-submitted via guest intake.\nAddress: 12 Marina Walk\nApt 4B\nDubai AE\nEmail: hacker@evil.com\nApparel size: L\nNote from joiner: hello there';
      await admin.query(`INSERT INTO person (tenant_id, person_id, full_name, email, notes) VALUES ($1,'PER-N5','N5 Person','hacker@evil.com',$2)`, [t.tenantId, notes]);

      // Run the R2-N05 corrective (exactly as 0053 does).
      await admin.query(`UPDATE person p SET
          date_of_birth = CASE WHEN (s.payload->>'dateOfBirth') ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (s.payload->>'dateOfBirth')::date ELSE NULL END,
          email = NULLIF(btrim(s.payload->>'email'), ''),
          phone = NULLIF(btrim(s.payload->>'phone'), ''),
          address_line1 = NULLIF(btrim(s.payload->>'addressLine1'), '')
          FROM intake_submission s
         WHERE s.promoted_person_id = p.person_id AND s.payload IS NOT NULL AND p.notes LIKE 'Self-submitted via guest intake%'`);
      await admin.query(`UPDATE person p SET notes =
          CASE WHEN concat_ws(E'\\n',
                 CASE WHEN NULLIF(btrim(s.payload->>'apparelSize'),'') IS NOT NULL THEN 'Apparel size: ' || btrim(s.payload->>'apparelSize') END,
                 CASE WHEN NULLIF(btrim(s.payload->>'shoeSize'),'')    IS NOT NULL THEN 'Shoe size: '    || btrim(s.payload->>'shoeSize') END,
                 CASE WHEN NULLIF(btrim(s.payload->>'note'),'')        IS NOT NULL THEN 'Note from joiner: ' || btrim(s.payload->>'note') END
               ) = '' THEN 'Self-submitted via guest intake.'
               ELSE 'Self-submitted via guest intake —' || E'\\n' || concat_ws(E'\\n',
                 CASE WHEN NULLIF(btrim(s.payload->>'apparelSize'),'') IS NOT NULL THEN 'Apparel size: ' || btrim(s.payload->>'apparelSize') END,
                 CASE WHEN NULLIF(btrim(s.payload->>'shoeSize'),'')    IS NOT NULL THEN 'Shoe size: '    || btrim(s.payload->>'shoeSize') END,
                 CASE WHEN NULLIF(btrim(s.payload->>'note'),'')        IS NOT NULL THEN 'Note from joiner: ' || btrim(s.payload->>'note') END
               ) END
          FROM intake_submission s
         WHERE s.promoted_person_id = p.person_id AND s.payload IS NOT NULL AND p.notes LIKE 'Self-submitted via guest intake%'`);

      const [row] = (await admin.query(`SELECT email, address_line1, to_char(date_of_birth,'YYYY-MM-DD') AS dob, notes FROM person WHERE person_id='PER-N5'`)).rows;
      // Authoritative re-derive: the manufactured email is replaced by the payload's.
      expect(row.email).toBe('real@x.com');
      expect(row.address_line1).toBe('12 Marina Walk');
      expect(row.dob).toBe('1990-01-01');
      // Notes: no PII residual (manufactured email, multiline address) survives…
      expect(row.notes).not.toContain('hacker@evil.com');
      expect(row.notes).not.toContain('Apt 4B');
      expect(row.notes).not.toContain('Marina Walk');
      // …and the non-PII content is preserved.
      expect(row.notes).toContain('Apparel size: L');
      expect(row.notes).toContain('Note from joiner: hello there');
    } finally {
      await admin.end();
    }
  });

  it('HARDEN-2 M-01: composite FKs, the deferred exact-sum law, and state-shape CHECKs hold at the database boundary', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'm1' });
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      const q = async (text: string, params: unknown[] = []) => c.query(text, params);
      const begin = async () => {
        await q('BEGIN');
        await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      };

      // a valid graph: mission + person + received income line
      await begin();
      await q(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1, 'MSN-9101', 'M1', '2026-06-01')`, [t.tenantId]);
      await q(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1, 'PER-9101', 'M1 Player')`, [t.tenantId]);
      await q(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
         VALUES ($1, 'PNL-9101', 'MSN-9101', 'Income', 'PrizeMoney', 'Prize', 100000, 'USD', 'Received')`,
        [t.tenantId],
      );
      await q('COMMIT');

      // M-01a: a reference that names a row that does not exist is refused —
      // representative probes across the S6–S9 generation.
      await begin();
      await expect(
        q(`INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor)
           VALUES ($1, 'DIST-NOPE', 'PER-9101', 10000, 1)`, [t.tenantId]),
      ).rejects.toThrow(/distribution_share_head_fk/);
      await q('ROLLBACK');
      await begin();
      await expect(
        q(`INSERT INTO claim (tenant_id, claim_id, submitted_by, mission_id, category, description, amount_minor, currency, expense_on)
           VALUES ($1, 'CLM-9101', 'x@m1.com', 'MSN-NOPE', 'Travel', 'taxi', 100, 'USD', '2026-06-02')`, [t.tenantId]),
      ).rejects.toThrow(/claim_mission_fk/);
      await q('ROLLBACK');
      await begin();
      await expect(
        q(`INSERT INTO team_membership (tenant_id, team_id, person_id, role) VALUES ($1, 'TEAM-NOPE', 'PER-9101', 'Player')`, [t.tenantId]),
      ).rejects.toThrow(/team_membership_team_fk/);
      await q('ROLLBACK');

      // M-01b: the exact-sum law — a head whose shares do not close the pool
      // survives every row-level check but DIES AT COMMIT. (The sole player's
      // share_bps is 10000: players split the PLAYER pool among themselves.)
      await begin();
      await q(
        `INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by)
         VALUES ($1, 'DIST-9101', 'MSN-9101', 'PNL-9101', 100000, 'USD', 4000, 40000, 'Live', 'owner@m1.com')`,
        [t.tenantId],
      );
      await q(
        `INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor)
         VALUES ($1, 'DIST-9101', 'PER-9101', 10000, 59999)`,
        [t.tenantId],
      );
      await expect(q('COMMIT')).rejects.toThrow(/DISTRIBUTION_SUM_VIOLATION/);

      // a share split that does not sum to 100% dies at commit too
      await begin();
      await q(
        `INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by)
         VALUES ($1, 'DIST-9103', 'MSN-9101', 'PNL-9101', 100000, 'USD', 4000, 40000, 'Live', 'owner@m1.com')`,
        [t.tenantId],
      );
      await q(
        `INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor)
         VALUES ($1, 'DIST-9103', 'PER-9101', 9999, 60000)`,
        [t.tenantId],
      );
      await expect(q('COMMIT')).rejects.toThrow(/DISTRIBUTION_BPS_VIOLATION/);

      // the exact graph commits; then a direct tamper of one share dies at commit
      await begin();
      await q(
        `INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by)
         VALUES ($1, 'DIST-9102', 'MSN-9101', 'PNL-9101', 100000, 'USD', 4000, 40000, 'Live', 'owner@m1.com')`,
        [t.tenantId],
      );
      await q(
        `INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor)
         VALUES ($1, 'DIST-9102', 'PER-9101', 10000, 60000)`,
        [t.tenantId],
      );
      await q('COMMIT');
      await begin();
      await q(`UPDATE distribution_share SET amount_minor = 59999 WHERE distribution_id = 'DIST-9102'`);
      await expect(q('COMMIT')).rejects.toThrow(/DISTRIBUTION_SUM_VIOLATION/);

      // M-01c: state shapes — each broken promise is named by its constraint.
      await begin();
      await expect(
        q(`INSERT INTO delegation (tenant_id, delegation_id, grantee_identity, granted_by, starts_on, ends_on, reason, revoked_at)
           VALUES ($1, 'DLG-9101', 'g@m1.com', 'o@m1.com', '2026-06-01', '2026-06-30', 'cover', now())`, [t.tenantId]),
      ).rejects.toThrow(/delegation_revoke_shape/);
      await q('ROLLBACK');
      await begin();
      await expect(
        q(`INSERT INTO claim (tenant_id, claim_id, submitted_by, category, description, amount_minor, currency, expense_on, status, reviewed_by, paid_on)
           VALUES ($1, 'CLM-9102', 'x@m1.com', 'Travel', 'taxi', 100, 'USD', '2026-06-02', 'Paid', 'o@m1.com', '2026-06-03')`, [t.tenantId]),
      ).rejects.toThrow(/claim_paid_shape/); // Paid without a payment-source LABEL
      await q('ROLLBACK');

      // M-03: the new version columns exist and default to 0.
      const cols = await q(
        `SELECT table_name FROM information_schema.columns
          WHERE table_name IN ('mission_participant','mission_budget') AND column_name = 'version'`,
      );
      expect(cols.rows.map((r: { table_name: string }) => r.table_name).sort()).toEqual(['mission_budget', 'mission_participant']);
    } finally {
      await c.end();
    }
  });

  it('HARDEN-3 M-15 + M-05: income requires a payment_status; a USD line rejects a non-unity FX snapshot', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'bd' });
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      const q = async (text: string, params: unknown[] = []) => c.query(text, params);
      const attempt = async (sql: string) => {
        await q('BEGIN');
        await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
        try {
          return await q(sql, [t.tenantId]);
        } finally {
          await q('ROLLBACK');
        }
      };
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1, 'MSN-D1', 'BD', '2026-06-01')`, [t.tenantId]);
      await q('COMMIT');

      // M-15: an Income line with NULL payment_status is now refused (was silently allowed — NULL CHECK passes).
      await expect(
        attempt(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
                 VALUES ($1, 'PNL-D1', 'MSN-D1', 'Income', 'PrizeMoney', 'x', 1000, 'AED', NULL)`),
      ).rejects.toThrow(/mission_line_payment_shape/);

      // M-05: a USD Received line with received_usd_per_unit <> 1 is refused (would multiply reported income).
      await expect(
        attempt(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status, received_amount_minor, received_usd_per_unit)
                 VALUES ($1, 'PNL-D2', 'MSN-D1', 'Income', 'PrizeMoney', 'x', 1000, 'USD', 'Received', 1000, 1.5)`),
      ).rejects.toThrow(/mission_line_usd_snapshot_unity/);

      // …but a USD line at exactly 1, and a non-USD line at a real rate, are fine.
      await expect(
        attempt(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status, received_amount_minor, received_usd_per_unit)
                 VALUES ($1, 'PNL-D3', 'MSN-D1', 'Income', 'PrizeMoney', 'x', 1000, 'USD', 'Received', 1000, 1)`),
      ).resolves.toBeDefined();
      await expect(
        attempt(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status, received_amount_minor, received_usd_per_unit)
                 VALUES ($1, 'PNL-D4', 'MSN-D1', 'Income', 'PrizeMoney', 'x', 1000, 'AED', 'Received', 1000, 0.272294)`),
      ).resolves.toBeDefined();
    } finally {
      await c.end();
    }
  });

  it('HARDEN-3 H-05 + H-04: a Live distribution freezes its source line; a Settled/inactive mission freezes its finance children', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'race' });
    const c = new Client({ connectionString: db.appUrl });
    await c.connect();
    try {
      const q = async (text: string, params: unknown[] = []) => c.query(text, params);
      const tx = async (fn: () => Promise<unknown>) => {
        await q('BEGIN');
        await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
        try {
          return await fn();
        } finally {
          await q('ROLLBACK');
        }
      };
      // Seed: a mission with a Received USD income line that funds a LIVE distribution.
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1, 'MSN-H5', 'H5', '2026-06-01')`, [t.tenantId]);
      await q(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1, 'PER-H5', 'Payee')`, [t.tenantId]);
      await q(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status, received_amount_minor, received_usd_per_unit)
               VALUES ($1, 'PNL-H5', 'MSN-H5', 'Income', 'PrizeMoney', 'Prize', 100000, 'USD', 'Received', 100000, 1)`, [t.tenantId]);
      await q(`INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by)
               VALUES ($1, 'DIST-H5', 'MSN-H5', 'PNL-H5', 100000, 'USD', 10000, 100000, 'Live', 'owner')`, [t.tenantId]);
      await q('COMMIT');

      // H-05: while the distribution is LIVE, payment_status and receipt FX are frozen.
      await expect(tx(() => q(`UPDATE mission_line SET payment_status = 'Expected' WHERE line_id = 'PNL-H5'`)))
        .rejects.toThrow(/LIVE distribution/);
      await expect(tx(() => q(`UPDATE mission_line SET received_usd_per_unit = 2 WHERE line_id = 'PNL-H5'`)))
        .rejects.toThrow(/LIVE distribution/);

      // H-04: a Settled mission freezes its finance children (line + budget insert/update).
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`INSERT INTO mission (tenant_id, mission_id, name, starts_on, finance_stage) VALUES ($1, 'MSN-H4', 'H4', '2026-06-01', 'Settled')`, [t.tenantId]);
      await q('COMMIT');
      await expect(tx(() => q(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
                               VALUES ($1, 'PNL-H4', 'MSN-H4', 'Income', 'PrizeMoney', 'x', 1000, 'USD', 'Expected')`, [t.tenantId])))
        .rejects.toThrow(/settled or inactive/);
      await expect(tx(() => q(`INSERT INTO mission_budget (tenant_id, mission_id, direction, category, currency, amount_minor)
                               VALUES ($1, 'MSN-H4', 'Income', 'PrizeMoney', 'USD', 1000)`, [t.tenantId])))
        .rejects.toThrow(/settled or inactive/);

      // …and an INACTIVE mission is frozen the same way.
      await q('BEGIN');
      await q(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await q(`INSERT INTO mission (tenant_id, mission_id, name, starts_on, is_active) VALUES ($1, 'MSN-IN', 'Inactive', '2026-06-01', false)`, [t.tenantId]);
      await q('COMMIT');
      await expect(tx(() => q(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
                               VALUES ($1, 'PNL-IN', 'MSN-IN', 'Income', 'PrizeMoney', 'x', 1000, 'USD', 'Expected')`, [t.tenantId])))
        .rejects.toThrow(/settled or inactive/);
    } finally {
      await c.end();
    }
  });

  it('HARDEN-3 H-04: the mission-head lock serializes settlement vs a concurrent finance-child write (two real connections)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'lock' });
    const seed = new Client({ connectionString: db.appUrl });
    await seed.connect();
    try {
      await seed.query('BEGIN');
      await seed.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await seed.query(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1, 'MSN-LK', 'Lock', '2026-06-01')`, [t.tenantId]);
      await seed.query('COMMIT');
    } finally {
      await seed.end();
    }

    const cA = new Client({ connectionString: db.appUrl });
    const cB = new Client({ connectionString: db.appUrl });
    await cA.connect();
    await cB.connect();
    try {
      await cA.query('BEGIN');
      await cA.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);
      await cB.query('BEGIN');
      await cB.query(`SELECT set_config('app.tenant_id', $1, true)`, [t.tenantId]);

      // A takes the mission-head lock (as requireActiveMission does for settlement).
      await cA.query(`SELECT 1 FROM mission WHERE mission_id = 'MSN-LK' FOR UPDATE`);

      // B tries to take the SAME head lock before its child write — it must BLOCK behind A.
      let bAcquired = false;
      const bLock = cB.query(`SELECT 1 FROM mission WHERE mission_id = 'MSN-LK' FOR UPDATE`).then(() => {
        bAcquired = true;
      });
      await new Promise((r) => setTimeout(r, 300));
      expect(bAcquired, 'B must block behind A’s mission-head lock').toBe(false);

      // A settles and commits; only now can B proceed.
      await cA.query(`UPDATE mission SET finance_stage = 'Settled' WHERE mission_id = 'MSN-LK'`);
      await cA.query('COMMIT');
      await bLock;
      expect(bAcquired).toBe(true);

      // B now sees the Settled mission — its finance-child write is refused (no race window).
      await expect(
        cB.query(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
                  VALUES ('${t.tenantId}', 'PNL-LK', 'MSN-LK', 'Income', 'PrizeMoney', 'x', 1000, 'USD', 'Expected')`),
      ).rejects.toThrow(/settled or inactive/);
      await cB.query('ROLLBACK');
    } finally {
      await cA.end().catch(() => {});
      await cB.end().catch(() => {});
    }
  });

  it('H-08: the ledger freezes applied migrations — an in-place edit fails the rerun', async () => {
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      // every applied row carries a checksum after the run
      const rows = await client.query('SELECT id, checksum FROM _migrations');
      for (const r of rows.rows as Array<{ id: string; checksum: string | null }>) {
        expect(r.checksum, r.id).toMatch(/^[0-9a-f]{64}$/);
      }
      // The rerun must reuse the passwords the embedded harness provisioned —
      // runMigrations ALTERs the roles' passwords on every run.
      const pwOf = (url: string) => decodeURIComponent(new URL(url).password);
      const rerun = () =>
        runMigrations({
          adminConnectionString: db.adminUrl,
          appRole: 'c3_app',
          appPassword: pwOf(db.appUrl),
          authPassword: pwOf(db.authUrl),
          backupPassword: pwOf(db.backupUrl),
          allowDevSecrets: true, // disposable embedded DB (H-01.1 explicit opt-in)
        });
      // simulate an in-place edit: corrupt one stored checksum, rerun → loud refusal
      await client.query(`UPDATE _migrations SET checksum = repeat('0', 64) WHERE id = '0001_schema.sql'`);
      await expect(rerun()).rejects.toThrow(/EDITED after being applied|frozen/i);
      // restore the truthful hash so later suites can rerun migrations cleanly
      await client.query(`UPDATE _migrations SET checksum = NULL WHERE id = '0001_schema.sql'`);
      await rerun();
      const fixed = await client.query(`SELECT checksum FROM _migrations WHERE id = '0001_schema.sql'`);
      expect(fixed.rows[0].checksum).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      await client.end();
    }
  });
});

describe('admin/app connection separation (privilege)', () => {
  it('the app role is not superuser and cannot bypass RLS', async () => {
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      const r = await client.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname='c3_app'`);
      expect(r.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
    } finally {
      await client.end();
    }
  });

  it('the API pool connects as c3_app, distinct from the admin role', async () => {
    const c = await p.pool.connect();
    try {
      const who = await c.query('SELECT current_user');
      expect(who.rows[0].current_user).toBe('c3_app');
    } finally {
      c.release();
    }
  });
});

describe('c3_backup role posture (read-only backup identity, 0006)', () => {
  it('is a restricted role with ONLY the documented BYPASSRLS exception', async () => {
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      const r = await client.query(
        `SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, rolcanlogin
           FROM pg_roles WHERE rolname='c3_backup'`,
      );
      expect(r.rows[0]).toMatchObject({
        rolsuper: false,
        rolbypassrls: true, // the single documented backup exception
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolcanlogin: true,
      });
      // It must be the ONLY non-superuser BYPASSRLS principal.
      const bypass = await client.query(
        `SELECT rolname FROM pg_roles WHERE rolbypassrls AND NOT rolsuper ORDER BY rolname`,
      );
      expect(bypass.rows.map((x) => x.rolname)).toEqual(['c3_backup']);
    } finally {
      await client.end();
    }
  });

  it('can read every tenant\'s rows but cannot mutate or create objects', async () => {
    // Seed two tenants with data via the admin path.
    await db.truncateAll();
    await db.seedTenant({ slug: 'alpha', users: [{ key: 'o', email: 'o@a.com', displayName: 'O', role: 'owner' }] });
    await db.seedTenant({ slug: 'bravo', users: [{ key: 'o', email: 'o@b.com', displayName: 'O', role: 'owner' }] });

    const backup = new Client({ connectionString: db.backupUrl });
    await backup.connect();
    try {
      // Reads ALL tenants (BYPASSRLS) — a complete logical backup needs this.
      const t = await backup.query('SELECT count(*)::int AS n FROM tenant');
      expect(t.rows[0].n).toBe(2);
      const u = await backup.query('SELECT count(*)::int AS n FROM app_user');
      expect(u.rows[0].n).toBe(2);

      // Cannot mutate identity or operational tables.
      await expect(backup.query("INSERT INTO app_user (email, display_name) VALUES ('x@x.com','x')")).rejects.toThrow(/permission denied/i);
      await expect(backup.query("UPDATE tenant SET name='hacked'")).rejects.toThrow(/permission denied/i);
      await expect(backup.query('DELETE FROM person')).rejects.toThrow(/permission denied/i);
      // Cannot create objects.
      await expect(backup.query('CREATE TABLE evil (id int)')).rejects.toThrow(/permission denied/i);
      // Cannot grant privileges: lacking grant-option, PostgreSQL makes the
      // GRANT a no-op (a warning, not an error) — so prove it conferred nothing.
      await backup.query('GRANT INSERT ON person TO c3_auth').catch(() => {});
      const conferred = await backup.query("SELECT has_table_privilege('c3_auth','person','INSERT') AS granted");
      expect(conferred.rows[0].granted).toBe(false);
    } finally {
      await backup.end();
    }
  });
});

describe('atomic business-ID allocation', () => {
  it('concurrent allocations yield distinct sequential values (never MAX+1 race)', async () => {
    const results = await Promise.all(
      Array.from({ length: 25 }, () => p.writes.transaction(actorA, (tx) => tx.allocateSequence('person'))),
    );
    const sorted = [...results].sort((a, b) => a - b);
    expect(sorted).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    expect(new Set(results).size).toBe(25);
  });

  it('counters are per-tenant and per-kind', async () => {
    const a1 = await p.writes.transaction(actorA, (tx) => tx.allocateSequence('person'));
    const b1 = await p.writes.transaction(actorB, (tx) => tx.allocateSequence('person'));
    expect(a1).toBe(1);
    expect(b1).toBe(1); // independent per tenant
  });
});

describe('constraints & immutability', () => {
  it('rejects a duplicate person business id within a tenant', async () => {
    const { approvalId } = await submitApprovalIn(actorA);
    const { approvalId: approvalId2 } = await submitApprovalIn(actorA);
    await p.writes.transaction(actorA, (tx) =>
      tx.insertPerson({
        personId: 'PER-0001', fullName: 'A', ign: null, nationality: null, primaryRole: null,
        personnelCode: null, currentTeam: null, currentGameTitle: null, primaryDepartment: null,
        notes: null, createdByApprovalId: approvalId,
      }),
    );
    await expect(
      p.writes.transaction(actorA, (tx) =>
        tx.insertPerson({
          personId: 'PER-0001', fullName: 'B', ign: null, nationality: null, primaryRole: null,
          personnelCode: null, currentTeam: null, currentGameTitle: null, primaryDepartment: null,
          notes: null, createdByApprovalId: approvalId2,
        }),
      ),
    ).rejects.toThrow();
  });

  it('Track B1 (0038): the payload freeze sits at the beginReview boundary — polish in Submitted, frozen after', async () => {
    const { approvalId } = await submitApprovalIn(actorA);
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]); // not needed for owner but harmless

      // Submitted: the submitter's polish window — a payload change is LEGAL.
      await client.query(
        `UPDATE approval SET payload = '{"operationType":"AddPerson","input":{"fullName":"Polished Name"}}'::jsonb, edit_count = edit_count + 1 WHERE approval_id=$1`,
        [approvalId],
      );

      // …but an edit can never ride a status transition,
      await expect(
        client.query(
          `UPDATE approval SET status='InReview', payload = '{"operationType":"AddPerson","input":{"fullName":"Smuggled"}}'::jsonb WHERE approval_id=$1`,
          [approvalId],
        ),
      ).rejects.toThrow(/FROZEN from review onward/i);

      // …and from InReview onward the payload is FROZEN (the 0001 promise, moved).
      await client.query(`UPDATE approval SET status='InReview' WHERE approval_id=$1`, [approvalId]);
      await expect(
        client.query(`UPDATE approval SET payload = '{"operationType":"AddPerson","input":{"fullName":"HACKED"}}'::jsonb WHERE approval_id=$1`, [approvalId]),
      ).rejects.toThrow(/FROZEN from review onward/i);

      // Identity stays write-once no matter the status…
      await expect(
        client.query(`UPDATE approval SET operation_type='AddCredential' WHERE approval_id=$1`, [approvalId]),
      ).rejects.toThrow(/immutable/i);
      // …the edit badge never counts down…
      await expect(client.query(`UPDATE approval SET edit_count = 0 WHERE approval_id=$1`, [approvalId])).rejects.toThrow(/monotone/i);
      // …and the revision links are write-once (self-FK demands a real approval).
      const { approvalId: other } = await submitApprovalIn(actorA);
      await client.query(`UPDATE approval SET superseded_by=$2 WHERE approval_id=$1`, [approvalId, other]);
      await expect(client.query(`UPDATE approval SET superseded_by=$2 WHERE approval_id=$1`, [approvalId, approvalId])).rejects.toThrow(
        /write-once/i,
      );
      await expect(client.query(`UPDATE approval SET revision_of='APR-9999' WHERE approval_id=$1`, [other])).rejects.toThrow(
        /approval_revision_of_fk|violates foreign key/i,
      );
    } finally {
      await client.end();
    }
  });
});

describe('optimistic concurrency', () => {
  it('a stale version update mutates nothing and returns null', async () => {
    const { approvalId } = await submitApprovalIn(actorA);
    const first = await p.writes.transaction(actorA, (tx) =>
      tx.updateApprovalStatus(approvalId, 0, { status: 'InReview', reviewedBy: actorA.identity, reviewedAt: new Date().toISOString() }),
    );
    expect(first?.status).toBe('InReview');
    expect(first?.version).toBe(1);

    const stale = await p.writes.transaction(actorA, (tx) =>
      tx.updateApprovalStatus(approvalId, 0, { status: 'Approved' }),
    );
    expect(stale).toBeNull();

    const current = await p.reads.forActor(actorA).getApprovalById(approvalId);
    expect(current?.status).toBe('InReview'); // unchanged by the stale attempt
    expect(current?.version).toBe(1);
  });
});

describe('transaction rollback', () => {
  it('a failure inside a write transaction persists nothing', async () => {
    await expect(
      p.writes.transaction(actorA, async (tx) => {
        const seq = await tx.allocateSequence('approval');
        await tx.insertApproval({
          approvalId: `APR-${String(seq).padStart(4, '0')}`, operationType: 'AddPerson',
          targetPersonId: 'PENDING-ADDPERSON', targetId: null, reason: null,
          payload: { operationType: 'AddPerson', input: { fullName: 'Rollback' } }, submittedBy: actorA.identity,
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const approvals = await p.reads.forActor(actorA).listApprovals();
    expect(approvals).toHaveLength(0);
    // The counter allocation also rolled back.
    const next = await p.writes.transaction(actorA, (tx) => tx.allocateSequence('approval'));
    expect(next).toBe(1);
  });
});

describe('execution idempotency (one person per approval)', () => {
  it('a second person creation for the same approval is rejected by the DB', async () => {
    const { approvalId } = await submitApprovalIn(actorA);
    await p.writes.transaction(actorA, (tx) =>
      tx.insertPerson({
        personId: 'PER-0001', fullName: 'Once', ign: null, nationality: null, primaryRole: null,
        personnelCode: null, currentTeam: null, currentGameTitle: null, primaryDepartment: null,
        notes: null, createdByApprovalId: approvalId,
      }),
    );
    await expect(
      p.writes.transaction(actorA, (tx) =>
        tx.insertPerson({
          personId: 'PER-0002', fullName: 'Twice', ign: null, nationality: null, primaryRole: null,
          personnelCode: null, currentTeam: null, currentGameTitle: null, primaryDepartment: null,
          notes: null, createdByApprovalId: approvalId,
        }),
      ),
    ).rejects.toThrow();
    const people = await p.reads.forActor(actorA).listPeople();
    expect(people).toHaveLength(1);
  });
});

describe('append-only event streams', () => {
  it('UPDATE and DELETE on approval_event are rejected even for the owner', async () => {
    const { approvalId } = await submitApprovalIn(actorA);
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      await expect(client.query(`UPDATE approval_event SET note='x' WHERE approval_id=$1`, [approvalId])).rejects.toThrow(/append-only/i);
      await expect(client.query(`DELETE FROM approval_event WHERE approval_id=$1`, [approvalId])).rejects.toThrow(/append-only/i);
    } finally {
      await client.end();
    }
  });

  it('the app role has no UPDATE/DELETE grant on audit_event', async () => {
    const c = await p.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      await c.query(
        `INSERT INTO audit_event (tenant_id, entity_type, entity_id, action, actor) VALUES ($1,'Person','PER-0001','PersonCreated','owner@a.com')`,
        [tenantA],
      );
      await expect(c.query(`UPDATE audit_event SET actor='x'`)).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });
});

describe('tenant isolation (RLS)', () => {
  it('tenant A cannot read tenant B rows', async () => {
    await submitApprovalIn(actorB);
    const aSees = await p.reads.forActor(actorA).listApprovals();
    expect(aSees).toHaveLength(0);
    const bSees = await p.reads.forActor(actorB).listApprovals();
    expect(bSees).toHaveLength(1);
  });

  it('tenant A cannot mutate tenant B rows (write is invisible / no-op)', async () => {
    const { approvalId } = await submitApprovalIn(actorB);
    // Actor A attempts to transition B's approval — under A's tenant context the
    // row is invisible, so the version-guarded update finds nothing.
    const res = await p.writes.transaction(actorA, (tx) => tx.updateApprovalStatus(approvalId, 0, { status: 'InReview' }));
    expect(res).toBeNull();
    const stillSubmitted = await p.reads.forActor(actorB).getApprovalById(approvalId);
    expect(stillSubmitted?.status).toBe('Submitted');
  });

  it('missing tenant context fails closed (no rows, direct app connection)', async () => {
    await submitApprovalIn(actorA);
    const c = await p.pool.connect();
    try {
      // No set_config → current_tenant_id() is NULL → policy denies everything.
      const rows = await c.query('SELECT * FROM approval');
      expect(rows.rowCount).toBe(0);
    } finally {
      c.release();
    }
  });
});

describe('access_event posture (platform-level denial stream, 0007)', () => {
  it('c3_app can INSERT but not SELECT/UPDATE/DELETE; append-only enforced', async () => {
    const c = await p.pool.connect();
    try {
      // INSERT allowed (write-only stream for the app role; no RLS, no tenant).
      await c.query(
        `INSERT INTO access_event (provider, issuer_tenant_id, subject, outcome, detail)
         VALUES ('entra','tid-x','oid-x','AccessDenied','test')`,
      );
      // No read-back, no mutation for the app role.
      await expect(c.query('SELECT * FROM access_event')).rejects.toThrow(/permission denied/i);
      await expect(c.query(`UPDATE access_event SET detail='x'`)).rejects.toThrow();
      await expect(c.query('DELETE FROM access_event')).rejects.toThrow();
    } finally {
      c.release();
    }
    // Admin sees the row; append-only trigger blocks even the owner.
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      const r = await admin.query(`SELECT outcome FROM access_event WHERE subject='oid-x'`);
      expect(r.rows[0]).toMatchObject({ outcome: 'AccessDenied' });
      await expect(admin.query(`UPDATE access_event SET detail='hacked'`)).rejects.toThrow(/append-only/i);
      await expect(admin.query('DELETE FROM access_event')).rejects.toThrow(/append-only/i);
    } finally {
      await admin.end();
    }
  });
});

describe('auth role (c3_auth) least privilege', () => {
  it('can resolve memberships (SELECT identity tables) but cannot write them or read business data', async () => {
    const authClient = new Client({ connectionString: db.authUrl });
    await authClient.connect();
    try {
      // Membership resolution works (pre-tenant-context, SELECT-only).
      const m = await authClient.query(
        `SELECT t.slug, ra.role FROM app_user u
           JOIN tenant_membership tm ON tm.user_id = u.id
           JOIN role_assignment ra ON ra.user_id = u.id AND ra.tenant_id = tm.tenant_id
           JOIN tenant t ON t.id = tm.tenant_id
          WHERE u.email = $1`,
        ['owner@a.com'],
      );
      expect(m.rows[0]).toMatchObject({ slug: 'alpha', role: 'owner' });

      // No writes to identity tables.
      await expect(
        authClient.query(`INSERT INTO role_assignment (tenant_id, user_id, role) SELECT tenant_id, user_id, 'owner' FROM tenant_membership LIMIT 1`),
      ).rejects.toThrow(/permission denied/i);

      // No access to business data at all.
      await expect(authClient.query('SELECT * FROM person')).rejects.toThrow(/permission denied/i);
      await expect(authClient.query('SELECT * FROM approval')).rejects.toThrow(/permission denied/i);

      // And it can never bypass RLS.
      const r = await authClient.query(`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`);
      expect(r.rows[0]).toMatchObject({ rolsuper: false, rolbypassrls: false });
    } finally {
      await authClient.end();
    }
  });
});

describe('connection-pool tenant-context isolation', () => {
  it('a pooled client reused across tenants never retains prior context', async () => {
    await submitApprovalIn(actorA);
    await submitApprovalIn(actorB);

    // Force a single pooled client and reuse it across three phases.
    const client = await p.pool.connect();
    try {
      // Phase 1: tenant A context, transaction-local.
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
      const aRows = await client.query('SELECT approval_id FROM approval');
      expect(aRows.rowCount).toBe(1);
      await client.query('COMMIT');

      // Phase 2: SAME client, no context set → must see nothing (no leak).
      const leak = await client.query('SELECT approval_id FROM approval');
      expect(leak.rowCount).toBe(0);

      // Phase 3: SAME client, tenant B context → only B's row.
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
      const bRows = await client.query('SELECT approval_id FROM approval');
      expect(bRows.rowCount).toBe(1);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});

// A migration cannot repair a hazard its OWN transaction trips, and a LATER migration is too
// late — the earlier one already aborted the replay. 0048 flips NULL-status income rows to
// 'Expected'; a NULL-status income row carrying receipt facts was LEGAL at 0047 (the
// received_only CHECK is UNKNOWN, not FALSE) and 'Expected' + receipt facts then VIOLATES it.
// Batch D adds a preflight bound to 0048 that coheres such a row to 'Received' inside 0048's
// own tx, BEFORE its SQL, and ONLY when 0048 is pending (a fresh replay / DR rebuild). These
// tests reproduce a REAL from-0047 replay on a throwaway database rather than fake schema state.
// Skipped only when an external managed admin URL is supplied (creating databases may be locked
// down there); it runs on the embedded path the gate uses.
describe.skipIf(!!process.env.DATABASE_ADMIN_URL)('HARDEN-3.2 Batch D (R2-N04) — migration-runner preflight (from-0047 replay)', () => {
  const TARGET_0047 = '0047_reactivate_credential_op.sql';
  const PREFLIGHT_0048 = '0048_finance_check_hardening.sql';
  // Roles are cluster-global (already created by the shared db); rotate is off, so these
  // passwords are only ever used to CREATE an absent role — here they never are.
  const roles = {
    appRole: 'c3_app', appPassword: 'c3_app_dev_pw',
    authRole: 'c3_auth', authPassword: 'c3_auth_dev_pw',
    backupRole: 'c3_backup', backupPassword: 'c3_backup_dev_pw',
    allowDevSecrets: true as const,
  };
  const maintUrl = () => { const u = new URL(db.adminUrl); u.pathname = '/postgres'; return u.href; };

  async function createDbThrough0047(): Promise<{ url: string; name: string; logs: string[] }> {
    const name = `c3web_pf_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const target = new URL(db.adminUrl); target.pathname = `/${name}`;
    const boot = new Client({ connectionString: maintUrl() });
    await boot.connect();
    try {
      await boot.query(`CREATE DATABASE ${name} WITH ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    } finally {
      await boot.end();
    }
    const logs: string[] = [];
    await runMigrations({ adminConnectionString: target.href, ...roles, targetInclusive: TARGET_0047, log: (m) => logs.push(m) });
    return { url: target.href, name, logs };
  }

  async function dropDb(name: string): Promise<void> {
    const boot = new Client({ connectionString: maintUrl() });
    await boot.connect();
    try {
      await boot.query(`DROP DATABASE IF EXISTS ${name}`);
    } catch {
      /* embedded server is torn down (and its dir removed) in afterAll regardless */
    } finally {
      await boot.end();
    }
  }

  it('a receipt-carrying NULL-status income line (legal at 0047) survives the 0048 replay — the preflight coheres it to Received', async () => {
    const { url, name, logs } = await createDbThrough0047();
    // Stopped exactly at 0047: 0048 is NOT yet applied (targetInclusive honored).
    expect(logs.some((l) => l.includes('apply 0047'))).toBe(true);
    expect(logs.some((l) => l.includes('apply 0048'))).toBe(false);

    const seed = new Client({ connectionString: url });
    await seed.connect();
    try {
      // The pathological-but-LEGAL-at-0047 shape: Income, payment_status NULL, receipt facts
      // set. received_only = NULL OR (FALSE AND …) = UNKNOWN, which a CHECK admits.
      const t = await seed.query<{ id: string }>(`INSERT INTO tenant (slug, name) VALUES ('pfco','pfco') RETURNING id`);
      const tenantId = t.rows[0]!.id;
      await seed.query(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-0001','Replay','2026-06-01')`, [tenantId]);
      await seed.query(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status, received_amount_minor, received_usd_per_unit)
         VALUES ($1,'PNL-0001','MSN-0001','Income','PrizeMoney','Prize',1000000,'SAR',NULL,950000,0.2650)`,
        [tenantId],
      );
    } finally {
      await seed.end();
    }

    // Resume history (0048 → tip). Today (preflight removed) 0048's NULL→'Expected' flip turns
    // the row into 'Expected' + receipt facts → received_only VIOLATION → 0048 aborts → this
    // rejects (RED). With the preflight it repairs first, so the whole chain applies (GREEN).
    const resumeLogs: string[] = [];
    const applied = await runMigrations({ adminConnectionString: url, ...roles, log: (m) => resumeLogs.push(m) });
    expect(applied).toContain(PREFLIGHT_0048);
    expect(resumeLogs.some((l) => new RegExp(`preflight ${PREFLIGHT_0048.replace('.', '\\.')}: repaired 1 row`).test(l))).toBe(true);

    const check = new Client({ connectionString: url });
    await check.connect();
    try {
      const row = await check.query<{ payment_status: string }>(`SELECT payment_status FROM mission_line WHERE line_id='PNL-0001'`);
      expect(row.rows[0]!.payment_status).toBe('Received'); // cohered — received_only now holds
    } finally {
      await check.end();
      await dropDb(name);
    }
  }, 120_000);

  it('a coherent DB replays with the preflight as a NO-OP (it never mutates clean data)', async () => {
    const { url, name } = await createDbThrough0047();
    const seed = new Client({ connectionString: url });
    await seed.connect();
    try {
      const t = await seed.query<{ id: string }>(`INSERT INTO tenant (slug, name) VALUES ('pfok','pfok') RETURNING id`);
      const tenantId = t.rows[0]!.id;
      await seed.query(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-0001','Clean','2026-06-01')`, [tenantId]);
      // A coherent Received line (receipt facts + status Received) and a plain Expected line —
      // neither is the pathological shape, so the preflight must leave both untouched.
      await seed.query(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status, received_amount_minor, received_usd_per_unit)
         VALUES ($1,'PNL-0001','MSN-0001','Income','PrizeMoney','Recv',1000000,'SAR','Received',950000,0.2650)`,
        [tenantId],
      );
      await seed.query(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
         VALUES ($1,'PNL-0002','MSN-0001','Income','PrizeMoney','Exp',500000,'USD','Expected')`,
        [tenantId],
      );
    } finally {
      await seed.end();
    }

    const resumeLogs: string[] = [];
    await runMigrations({ adminConnectionString: url, ...roles, log: (m) => resumeLogs.push(m) });
    expect(resumeLogs.some((l) => new RegExp(`preflight ${PREFLIGHT_0048.replace('.', '\\.')}: no-op`).test(l))).toBe(true);

    const check = new Client({ connectionString: url });
    await check.connect();
    try {
      const rows = await check.query<{ line_id: string; payment_status: string }>(`SELECT line_id, payment_status FROM mission_line ORDER BY line_id`);
      expect(rows.rows).toEqual([
        { line_id: 'PNL-0001', payment_status: 'Received' },
        { line_id: 'PNL-0002', payment_status: 'Expected' },
      ]);
    } finally {
      await check.end();
      await dropDb(name);
    }
  }, 120_000);
});

// R4-N11 / R5-N10: a preflight (OR ITS ABSENCE) is part of a migration's replay identity. 3.2
// recorded only the migration checksum, so editing a preflight changed rebuilds invisibly. 3.3
// recorded a nullable preflight-checksum and refused a later EDIT — but recorded NULL for "no
// preflight", and the skip path adopted a NULL row silently, so a preflight ADDED later (a real
// change to replay identity) slipped through unrefused. R5-N10 records an explicit 'none' sentinel
// (never NULL) on apply, so ADD ('none'→checksum), REMOVE (checksum→'none') and EDIT
// (checksum→checksum') are all mismatches; a legacy NULL row (pre-sentinel) adopts its current
// identity ONCE. Real edge in every case: apply through 0048 with a THROWAWAY preflight the test
// owns, then mutate the file/ledger and rerun. Skipped when a managed admin URL is supplied (DB
// creation may be locked down); runs on the embedded path the gate uses.
describe.skipIf(!!process.env.DATABASE_ADMIN_URL)('HARDEN-3.3/3.4 Batch F (R4-N11 + R5-N10) — preflight identity bound to the ledger', () => {
  const roles = {
    appRole: 'c3_app', appPassword: 'c3_app_dev_pw',
    authRole: 'c3_auth', authPassword: 'c3_auth_dev_pw',
    backupRole: 'c3_backup', backupPassword: 'c3_backup_dev_pw',
    allowDevSecrets: true as const,
  };
  const TARGET_0048 = '0048_finance_check_hardening.sql';
  const SHA_SELECT1 = createHash('sha256').update('SELECT 1;\n').digest('hex');
  const maint = () => { const u = new URL(db.adminUrl); u.pathname = '/postgres'; return u.href; };

  async function createEmptyDb(): Promise<{ url: string; name: string }> {
    const name = `c3web_pfled_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
    const target = new URL(db.adminUrl); target.pathname = `/${name}`;
    const boot = new Client({ connectionString: maint() });
    await boot.connect();
    try {
      await boot.query(`CREATE DATABASE ${name} WITH ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`);
    } finally {
      await boot.end();
    }
    return { url: target.href, name };
  }
  async function dropDb(name: string): Promise<void> {
    const boot = new Client({ connectionString: maint() });
    await boot.connect();
    try { await boot.query(`DROP DATABASE IF EXISTS ${name}`); } catch { /* torn down in afterAll */ } finally { await boot.end(); }
  }
  async function scalar(url: string, sql: string): Promise<Record<string, unknown>> {
    const c = new Client({ connectionString: url });
    await c.connect();
    try { return (await c.query(sql)).rows[0] as Record<string, unknown>; } finally { await c.end(); }
  }
  async function exec(url: string, sql: string): Promise<void> {
    const c = new Client({ connectionString: url });
    await c.connect();
    try { await c.query(sql); } finally { await c.end(); }
  }
  /** Apply through 0048; `pf` is the preflight body, or null for NO preflight file. */
  function apply(url: string, pfDir: string, pf: string | null): ReturnType<typeof runMigrations> {
    const pfPath = join(pfDir, TARGET_0048);
    if (pf === null) { rmSync(pfPath, { force: true }); } else { writeFileSync(pfPath, pf); }
    return runMigrations({ adminConnectionString: url, ...roles, preflightsDir: pfDir, targetInclusive: TARGET_0048 });
  }

  it('records a preflight checksum on apply and REFUSES a later EDIT of that preflight', async () => {
    const pfDir = mkdtempSync(join(tmpdir(), 'c3pfled-'));
    const { url, name } = await createEmptyDb();
    try {
      // Apply through 0048 with the throwaway preflight → its checksum is recorded (never 'none').
      await apply(url, pfDir, 'SELECT 1;\n');
      const rec = await scalar(url, `SELECT preflight_checksum, checksum FROM _migrations WHERE id='${TARGET_0048}'`);
      expect(rec.preflight_checksum).toBe(SHA_SELECT1);
      const migChecksum = rec.checksum;

      // Rerun UNCHANGED → stable, the checksum matches, no throw.
      await expect(apply(url, pfDir, 'SELECT 1;\n')).resolves.toBeDefined();

      // EDIT the preflight → rerun → the ledger detects the mismatch and REFUSES.
      await expect(apply(url, pfDir, 'SELECT 2;\n')).rejects.toThrow(/preflight for .* was edited/i);

      // Non-clobber: the migration's OWN checksum was never touched by the preflight machinery.
      const after = await scalar(url, `SELECT checksum FROM _migrations WHERE id='${TARGET_0048}'`);
      expect(after.checksum).toBe(migChecksum);
    } finally {
      rmSync(pfDir, { recursive: true, force: true });
      await dropDb(name);
    }
  }, 120_000);

  it('R5-N10: records the explicit \'none\' sentinel for a migration with NO preflight (never NULL)', async () => {
    const pfDir = mkdtempSync(join(tmpdir(), 'c3pfled-'));
    const { url, name } = await createEmptyDb();
    try {
      await apply(url, pfDir, null); // no preflight file for 0048
      const rec = await scalar(url, `SELECT preflight_checksum FROM _migrations WHERE id='${TARGET_0048}'`);
      expect(rec.preflight_checksum).toBe('none'); // the seal, not NULL
      // Rerun with STILL no preflight → 'none' === 'none', stable, no throw.
      await expect(apply(url, pfDir, null)).resolves.toBeDefined();
    } finally {
      rmSync(pfDir, { recursive: true, force: true });
      await dropDb(name);
    }
  }, 120_000);

  it('R5-N10: REFUSES a preflight ADDED after apply (\'none\' → checksum) — the gap 3.3 adopted silently', async () => {
    const pfDir = mkdtempSync(join(tmpdir(), 'c3pfled-'));
    const { url, name } = await createEmptyDb();
    try {
      await apply(url, pfDir, null); // recorded 'none'
      // Now ADD a preflight to a migration that shipped without one → rerun → REFUSE.
      await expect(apply(url, pfDir, 'SELECT 1;\n')).rejects.toThrow(/preflight for .* was added.*none was recorded/i);
    } finally {
      rmSync(pfDir, { recursive: true, force: true });
      await dropDb(name);
    }
  }, 120_000);

  it('R5-N10: REFUSES a preflight REMOVED after apply (checksum → \'none\')', async () => {
    const pfDir = mkdtempSync(join(tmpdir(), 'c3pfled-'));
    const { url, name } = await createEmptyDb();
    try {
      await apply(url, pfDir, 'SELECT 1;\n'); // recorded a checksum
      // Now REMOVE the preflight file → rerun → REFUSE (the recorded checksum can't be satisfied).
      await expect(apply(url, pfDir, null)).rejects.toThrow(/preflight for .* was removed.*file now absent/i);
    } finally {
      rmSync(pfDir, { recursive: true, force: true });
      await dropDb(name);
    }
  }, 120_000);

  it('R5-N10: a legacy NULL row (pre-sentinel) ADOPTS its current identity ONCE, then holds it', async () => {
    const pfDir = mkdtempSync(join(tmpdir(), 'c3pfled-'));
    const { url, name } = await createEmptyDb();
    try {
      await apply(url, pfDir, 'SELECT 1;\n'); // recorded SHA_SELECT1
      // Simulate a row applied BEFORE the sentinel existed: force the ledger to NULL.
      await exec(url, `UPDATE _migrations SET preflight_checksum = NULL WHERE id='${TARGET_0048}'`);
      // Rerun with the SAME preflight → the legacy NULL adopts the current checksum (no throw).
      await expect(apply(url, pfDir, 'SELECT 1;\n')).resolves.toBeDefined();
      const rec = await scalar(url, `SELECT preflight_checksum FROM _migrations WHERE id='${TARGET_0048}'`);
      expect(rec.preflight_checksum).toBe(SHA_SELECT1);
      // Adoption is a ONE-SHOT: now that it holds an identity, an EDIT is refused like any other.
      await expect(apply(url, pfDir, 'SELECT 2;\n')).rejects.toThrow(/preflight for .* was edited/i);
    } finally {
      rmSync(pfDir, { recursive: true, force: true });
      await dropDb(name);
    }
  }, 120_000);

  it('R5-N10: a legacy NULL row with NO current preflight adopts \'none\' (not a false ADD-refusal)', async () => {
    const pfDir = mkdtempSync(join(tmpdir(), 'c3pfled-'));
    const { url, name } = await createEmptyDb();
    try {
      await apply(url, pfDir, null); // records 'none'
      await exec(url, `UPDATE _migrations SET preflight_checksum = NULL WHERE id='${TARGET_0048}'`); // legacy NULL
      // Rerun with still-no-preflight → adopts 'none' (a NULL legacy row is not a recorded 'none').
      await expect(apply(url, pfDir, null)).resolves.toBeDefined();
      const rec = await scalar(url, `SELECT preflight_checksum FROM _migrations WHERE id='${TARGET_0048}'`);
      expect(rec.preflight_checksum).toBe('none');
    } finally {
      rmSync(pfDir, { recursive: true, force: true });
      await dropDb(name);
    }
  }, 120_000);

  // C3 (R6-N03): adopt-once must hold across CONCURRENT runners, not just sequential reruns. Two
  // real runMigrations calls race the same legacy-NULL ledger with DIFFERENT local preflights.
  // The beforeAdoptHook latch holds each runner inside its snapshot→adopt window until the OTHER
  // runner arrives too (or a grace timeout passes) — the EXACT overlap R6-N03 names, made
  // deterministic. New code: the advisory single-flight lock means the second runner never even
  // snapshots until the winner finished (it waits at the lock; its latch times out harmlessly) →
  // exactly one adopts, the other refuses. Old code (no lock, zero-row UPDATE ignored): BOTH
  // runners reach the latch together, both write, the loser's zero-row result is swallowed and it
  // RESOLVES with a divergent identity — the exactly-one assertion goes RED.
  it('C3 (R6-N03): two CONCURRENT runners with DIFFERENT preflights — exactly one adopts, the other REFUSES', async () => {
    const pfDirA = mkdtempSync(join(tmpdir(), 'c3pfrunA-'));
    const pfDirB = mkdtempSync(join(tmpdir(), 'c3pfrunB-'));
    const { url, name } = await createEmptyDb();
    try {
      await apply(url, pfDirA, 'SELECT 1;\n'); // ledger through 0048 with P1
      await exec(url, `UPDATE _migrations SET preflight_checksum = NULL WHERE id='${TARGET_0048}'`); // legacy NULL
      writeFileSync(join(pfDirB, TARGET_0048), 'SELECT 2;\n'); // runner B believes a DIFFERENT preflight

      // 2-party latch: resolves when both runners are inside their adoption window, or after a
      // grace period (the single-flight lock legitimately prevents the overlap on new code).
      let arrived = 0;
      let releaseAll: () => void;
      const bothArrived = new Promise<void>((r) => { releaseAll = r; });
      const latch = async () => {
        arrived += 1;
        if (arrived >= 2) releaseAll!();
        await Promise.race([bothArrived, new Promise<void>((r) => setTimeout(r, 1500))]);
      };

      const settle = (dir: string) =>
        runMigrations({ adminConnectionString: url, ...roles, preflightsDir: dir, targetInclusive: TARGET_0048, beforeAdoptHook: latch })
          .then(() => 'adopted' as const, (e: unknown) => e as Error);
      // BOTH runners start together against the same DB (a real deployment overlap).
      const [ra, rb] = await Promise.all([settle(pfDirA), settle(pfDirB)]);

      const outcomes = [ra, rb];
      const winners = outcomes.filter((o) => o === 'adopted');
      const losers = outcomes.filter((o): o is Error => o instanceof Error);
      // EXACTLY one adopts; the other refuses with a mismatch (never a silent double-accept).
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]!.message).toMatch(/concurrent runner adopted|was EDITED|was ADDED|was REMOVED/i);
      // The ledger holds exactly ONE of the two identities (the winner's).
      const rec = await scalar(url, `SELECT preflight_checksum FROM _migrations WHERE id='${TARGET_0048}'`);
      const shaOf = (s: string) => createHash('sha256').update(s).digest('hex');
      expect([shaOf('SELECT 1;\n'), shaOf('SELECT 2;\n')]).toContain(rec.preflight_checksum);
    } finally {
      rmSync(pfDirA, { recursive: true, force: true });
      rmSync(pfDirB, { recursive: true, force: true });
      await dropDb(name);
    }
  }, 120_000);

  it('C3 (R6-N03): two CONCURRENT runners with the SAME preflight both complete (verified-equal, no false refusal)', async () => {
    const pfDir = mkdtempSync(join(tmpdir(), 'c3pfrunS-'));
    const { url, name } = await createEmptyDb();
    try {
      await apply(url, pfDir, 'SELECT 1;\n');
      await exec(url, `UPDATE _migrations SET preflight_checksum = NULL WHERE id='${TARGET_0048}'`);
      const settle = () =>
        runMigrations({ adminConnectionString: url, ...roles, preflightsDir: pfDir, targetInclusive: TARGET_0048 })
          .then(() => 'ok' as const, (e: unknown) => e as Error);
      const [ra, rb] = await Promise.all([settle(), settle()]);
      expect(ra).toBe('ok');
      expect(rb).toBe('ok'); // identical identity → the second verifies-equal, never refuses
      const rec = await scalar(url, `SELECT preflight_checksum FROM _migrations WHERE id='${TARGET_0048}'`);
      expect(rec.preflight_checksum).toBe(createHash('sha256').update('SELECT 1;\n').digest('hex'));
    } finally {
      rmSync(pfDir, { recursive: true, force: true });
      await dropDb(name);
    }
  }, 120_000);
});

// R4-N05: 0063 anchored revoke and pay on the head via FOR UPDATE, but that read-lock creates
// no new head version — so a REPEATABLE READ revoker waiting behind the payer's read-lock never
// gets a serialization failure, and its guard (frozen snapshot) never sees the Paid share:
// Revoked head + Paid share commit. 0066 makes the pay guard WRITE the head, so revoke and pay
// truly write-conflict. This test runs the race at BOTH isolation levels with a pg_stat_activity
// observer barrier proving the revoke is blocked before the payer is released. The RR case is
// the discriminator — RED on 0063's read-lock-only guard.
describe('HARDEN-3.3 Batch B (R4-N05) — distribution revoke/pay isolation-safe', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function waitUntilBlocked(obs: Client, pid: number): Promise<void> {
    for (let i = 0; i < 200; i++) {
      const r = await obs.query<{ wait_event_type: string | null }>(
        'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [pid],
      );
      if (r.rows[0]?.wait_event_type === 'Lock') return;
      await sleep(25);
    }
    throw new Error('the conflicting revoke never blocked on a lock (observer barrier timed out)');
  }

  async function seedLiveDistribution(slug: string): Promise<string> {
    const t = await db.seedTenant({ slug });
    const s = new Client({ connectionString: db.adminUrl });
    await s.connect();
    try {
      // One tx: the distribution sum-check is a DEFERRED constraint trigger, evaluated at
      // COMMIT once head + shares both exist (org_cut + Σshares == pool).
      await s.query('BEGIN');
      await s.query(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-B','B','2026-06-01')`, [t.tenantId]);
      await s.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-B','P')`, [t.tenantId]);
      await s.query(
        `INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status)
         VALUES ($1,'PNL-B','MSN-B','Income','PrizeMoney','P',100000,'USD','Received')`, [t.tenantId]);
      await s.query(
        `INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by)
         VALUES ($1,'DIST-B','MSN-B','PNL-B',100000,'USD',0,0,'Live','o@b.com')`, [t.tenantId]);
      await s.query(
        `INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor, payout_status)
         VALUES ($1,'DIST-B','PER-B',10000,100000,'Pending')`, [t.tenantId]);
      await s.query('COMMIT');
    } finally {
      await s.end();
    }
    return t.tenantId;
  }

  async function runRace(level: 'READ COMMITTED' | 'REPEATABLE READ', tenantId: string): Promise<void> {
    const pay = new Client({ connectionString: db.appUrl });
    const revoke = new Client({ connectionString: db.appUrl });
    const obs = new Client({ connectionString: db.adminUrl });
    await pay.connect(); await revoke.connect(); await obs.connect();
    try {
      const revokePid = (await revoke.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid;

      // Payer pays the share FIRST and holds it uncommitted — WITH the fix, the pay guard writes
      // the head, so the head now carries the payer's uncommitted write-lock.
      await pay.query(`BEGIN ISOLATION LEVEL ${level}`);
      await pay.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantId]);
      await pay.query(
        `UPDATE distribution_share SET payout_status='Paid', paid_on='2026-06-15', payment_source_label='Bank'
         WHERE distribution_id='DIST-B' AND person_id='PER-B'`,
      );

      // Revoker takes its snapshot (payer still uncommitted → it will never see the Paid share),
      // then its head UPDATE blocks on the payer's head write-lock.
      await revoke.query(`BEGIN ISOLATION LEVEL ${level}`);
      await revoke.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantId]);
      const revokePromise = revoke
        .query(`UPDATE distribution SET status='Revoked', revoked_reason='x' WHERE distribution_id='DIST-B'`)
        .then(() => 'resolved' as const);

      // Observer barrier: prove the revoke is genuinely blocked before the payer is released.
      await waitUntilBlocked(obs, revokePid);

      await pay.query('COMMIT'); // payer wins → revoker unblocks

      // The revoke MUST be refused: a serialization failure (40001) at REPEATABLE READ, or the
      // C3E:CONFLICT trigger (it now re-reads the Paid share) at READ COMMITTED.
      await expect(revokePromise).rejects.toThrow(/could not serialize|serialization failure|PAID shares|C3E:CONFLICT/i);
      await revoke.query('ROLLBACK').catch(() => {});

      // Invariant: a Paid share under a still-LIVE head (the revoke was refused).
      const chk = new Client({ connectionString: db.adminUrl });
      await chk.connect();
      try {
        expect((await chk.query(`SELECT status FROM distribution WHERE distribution_id='DIST-B'`)).rows[0].status).toBe('Live');
        expect((await chk.query(`SELECT payout_status FROM distribution_share WHERE distribution_id='DIST-B'`)).rows[0].payout_status).toBe('Paid');
      } finally {
        await chk.end();
      }
    } finally {
      await pay.end(); await revoke.end(); await obs.end();
    }
  }

  it('REPEATABLE READ: the payer writes the head, so the revoker serializes (40001) — invariant holds', async () => {
    await db.truncateAll();
    const tenantId = await seedLiveDistribution('distb-rr');
    await runRace('REPEATABLE READ', tenantId);
  });

  it('READ COMMITTED: the revoker blocks, re-reads the Paid share, and its guard refuses — invariant holds', async () => {
    await db.truncateAll();
    const tenantId = await seedLiveDistribution('distb-rc');
    await runRace('READ COMMITTED', tenantId);
  });
});

// R5-N05: the revoke/pay guards were BEFORE UPDATE only while c3_app holds INSERT, so a
// Revoked-head/Paid-share pair was directly INSERTable. 0072 extends both guards to INSERT and
// stops the migration on historical violations. R5-N06: the retry classifier now walks the
// cause chain (Drizzle wraps the SQLSTATE), so the COMPOSED revoke/pay race converges via retry.
describe('HARDEN-3.4 Batch C (R5-N05/N06) — distribution INSERT invariant + composed retry', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  async function seedLiveDist(admin: Client, tenantId: string): Promise<void> {
    // One tx: the sum-check is a DEFERRED constraint evaluated at COMMIT.
    await admin.query('BEGIN');
    await admin.query(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-C','C','2026-06-01')`, [tenantId]);
    await admin.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-C','P')`, [tenantId]);
    await admin.query(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status) VALUES ($1,'PNL-C','MSN-C','Income','PrizeMoney','P',100000,'USD','Received')`, [tenantId]);
    await admin.query(`INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by) VALUES ($1,'DIST-C','MSN-C','PNL-C',100000,'USD',0,0,'Live','o@c.com')`, [tenantId]);
    await admin.query(`INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor, payout_status) VALUES ($1,'DIST-C','PER-C',10000,100000,'Pending')`, [tenantId]);
    await admin.query('COMMIT');
  }

  it('R5-N05: a Paid share INSERTED directly under a Revoked head is DB-refused (INSERT guard, not just UPDATE)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'distins' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await seedLiveDist(admin, t.tenantId);
      await admin.query(`UPDATE distribution SET status='Revoked', revoked_reason='x' WHERE distribution_id='DIST-C'`); // no Paid shares → allowed
      // A DIRECT INSERT of a Paid share under the now-Revoked head — the UPDATE guard never
      // sees it; the 0072 INSERT guard must refuse.
      await expect(admin.query(
        `INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor, payout_status, paid_on, payment_source_label)
         VALUES ($1,'DIST-C','PER-C2',1,1,'Paid','2026-06-15','Bank')`, [t.tenantId],
      )).rejects.toThrow(/LIVE distribution|C3E:CONFLICT/i);

      // And a Revoked head INSERTED over a Paid share is refused too. Seed a Paid share with
      // triggers OFF (replica), then INSERT a Revoked head naming its distribution_id.
      await admin.query(`SET session_replication_role = replica`);
      await admin.query(`INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor, payout_status, paid_on, payment_source_label) VALUES ($1,'DIST-D','PER-D',10000,100000,'Paid','2026-06-15','Bank')`, [t.tenantId]);
      await admin.query(`SET session_replication_role = origin`);
      await expect(admin.query(
        `INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by)
         VALUES ($1,'DIST-D','MSN-C','PNL-C',100000,'USD',0,0,'Revoked','o@c.com')`, [t.tenantId],
      )).rejects.toThrow(/PAID shares|C3E:CONFLICT/i);
    } finally {
      await admin.end();
    }
  });

  it('R5-N06: the COMPOSED markPayout use case converges via retry when a concurrent revoke wins (Drizzle-wrapped 40001)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'distret' });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    await seedLiveDist(admin, t.tenantId);

    // A persistence handle whose WRITES run at REPEATABLE READ (test seam), so the head
    // write-conflict surfaces as a Drizzle-wrapped 40001 the use case's retry must converge.
    const pRR = createPersistence({ appConnectionString: db.appUrl, writeIsolation: 'REPEATABLE READ' });
    const winner = new Client({ connectionString: db.appUrl });
    const obs = new Client({ connectionString: db.adminUrl });
    await winner.connect(); await obs.connect();
    const actor = ownerActor(t.tenantId, 'owner@distret.com');
    try {
      const winnerPid = (await winner.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid;

      // The winner REVOKES the head and holds the lock (no Paid shares yet → allowed).
      await winner.query('BEGIN');
      await winner.query(`SELECT set_config('app.tenant_id',$1,true)`, [t.tenantId]);
      await winner.query(`UPDATE distribution SET status='Revoked', revoked_reason='x' WHERE distribution_id='DIST-C'`);

      // markPayout (the REAL use case, at RR) blocks on lockDistribution's FOR UPDATE.
      const payP = markPayout(pRR, actor, 'DIST-C', 'PER-C', { expectedVersion: 0, paid: true, paymentSourceLabel: 'Bank' })
        .then(() => 'paid' as const, (e: unknown) => e as Error);

      // Barrier: wait until markPayout's backend is genuinely blocked on the head lock.
      for (let i = 0; i < 200; i++) {
        const r = await obs.query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid <> $1 AND pid <> pg_backend_pid() AND state='active'`, [winnerPid],
        );
        if (r.rows.length > 0) break;
        await sleep(25);
      }
      await winner.query('COMMIT'); // head now Revoked → markPayout unblocks → RR 40001 → retry

      const res = await payP;
      // CONVERGED: on retry the fresh snapshot sees the Revoked head, so markPayout returns a
      // clean domain ConflictError — NOT a surfaced raw serialization failure. On the old
      // top-level-only classifier the 40001 would surface (message "could not serialize …").
      expect(res).toBeInstanceOf(Error);
      expect((res as Error).message, `expected a domain conflict, got: ${(res as Error).message}`).toMatch(/revoked|frozen|C3E:CONFLICT/i);
      expect(isRetryableSerializationError(res)).toBe(false); // the surfaced error is NOT a 40001

      // Invariant intact: the share stayed Pending under the Revoked head.
      expect((await admin.query(`SELECT payout_status FROM distribution_share WHERE distribution_id='DIST-C'`)).rows[0].payout_status).toBe('Pending');
      expect((await admin.query(`SELECT status FROM distribution WHERE distribution_id='DIST-C'`)).rows[0].status).toBe('Revoked');
    } finally {
      await winner.end(); await obs.end(); await pRR.close(); await admin.end();
    }
  }, 40_000);

  // ── operator-stop migration fixtures (build-through, transactional rollback proven) ──────
  describe.skipIf(!!process.env.DATABASE_ADMIN_URL)('operator-stop migrations refuse over historical violations', () => {
    const roles = { appRole: 'c3_app', appPassword: 'c3_app_dev_pw', authRole: 'c3_auth', authPassword: 'c3_auth_dev_pw', backupRole: 'c3_backup', backupPassword: 'c3_backup_dev_pw', allowDevSecrets: true as const };
    const maint = () => { const u = new URL(db.adminUrl); u.pathname = '/postgres'; return u.href; };
    async function freshThrough(target: string): Promise<{ url: string; name: string }> {
      const name = `c3web_stop_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
      const target2 = new URL(db.adminUrl); target2.pathname = `/${name}`;
      const boot = new Client({ connectionString: maint() }); await boot.connect();
      try { await boot.query(`CREATE DATABASE ${name} WITH ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`); } finally { await boot.end(); }
      await runMigrations({ adminConnectionString: target2.href, ...roles, targetInclusive: target });
      return { url: target2.href, name };
    }
    async function dropDb(name: string): Promise<void> {
      const boot = new Client({ connectionString: maint() }); await boot.connect();
      try { await boot.query(`DROP DATABASE IF EXISTS ${name}`); } catch { /* torn down in afterAll */ } finally { await boot.end(); }
    }

    it('0072 STOPS on a historical Revoked-head/Paid-share pair; the migration rolls back (not in the ledger)', async () => {
      const { url, name } = await freshThrough('0071_definer_search_path_hardening.sql');
      const c = new Client({ connectionString: url }); await c.connect();
      try {
        const t = (await c.query<{ id: string }>(`INSERT INTO tenant (slug, name) VALUES ('stopco','stopco') RETURNING id`)).rows[0]!.id;
        // Seed the historical violation with triggers OFF (superuser, replica) — the 0063 window.
        await c.query(`SET session_replication_role = replica`);
        await c.query(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-S','S','2026-06-01')`, [t]);
        await c.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-S','P')`, [t]);
        await c.query(`INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, revoked_reason, created_by) VALUES ($1,'DIST-S','MSN-S','PNL-S',100000,'USD',0,0,'Revoked','historical','o@s.com')`, [t]);
        await c.query(`INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor, payout_status, paid_on, payment_source_label) VALUES ($1,'DIST-S','PER-S',10000,100000,'Paid','2026-06-15','Bank')`, [t]);
        await c.query(`SET session_replication_role = origin`);
      } finally { await c.end(); }
      // Applying 0072 must STOP with the diagnostic; its tx rolls back so it never ledgers.
      await expect(runMigrations({ adminConnectionString: url, ...roles })).rejects.toThrow(/Revoked-head \/ Paid-share|R5-N05/i);
      const chk = new Client({ connectionString: url }); await chk.connect();
      try {
        expect((await chk.query(`SELECT count(*)::int n FROM _migrations WHERE id='0072_distribution_insert_invariant.sql'`)).rows[0].n).toBe(0);
      } finally { await chk.end(); await dropDb(name); }
    }, 120_000);

    it('0065 STOPS on a historical duplicate open DeactivatePerson (the round-5-untested twin)', async () => {
      const { url, name } = await freshThrough('0064_comment_delete_guard.sql');
      const c = new Client({ connectionString: url }); await c.connect();
      try {
        const t = (await c.query<{ id: string }>(`INSERT INTO tenant (slug, name) VALUES ('stop65','stop65') RETURNING id`)).rows[0]!.id;
        // At 0064 the 0062 index excludes ExecutionFailed, so an ExecutionFailed + a Submitted
        // DeactivatePerson for the SAME person coexist — the historical duplicate 0065 forbids.
        const ins = (aid: string, status: string) => c.query(
          `INSERT INTO approval (tenant_id, approval_id, operation_type, target_person_id, target_id, status, payload, submitted_by)
           VALUES ($1,$2,'DeactivatePerson','PER-Z',NULL,$3,$4::jsonb,'u@z.com')`,
          [t, aid, status, JSON.stringify({ operationType: 'DeactivatePerson', input: { personId: 'PER-Z' } })],
        );
        await ins('APR-EF', 'ExecutionFailed');
        await ins('APR-SU', 'Submitted');
      } finally { await c.end(); }
      await expect(runMigrations({ adminConnectionString: url, ...roles })).rejects.toThrow(/hold more than one OPEN DeactivatePerson|R4-N06/i);
      const chk = new Client({ connectionString: url }); await chk.connect();
      try {
        expect((await chk.query(`SELECT count(*)::int n FROM _migrations WHERE id='0065_deactivate_open_status_align.sql'`)).rows[0].n).toBe(0);
      } finally { await chk.end(); await dropDb(name); }
    }, 120_000);

    it('0077 STOPS on a populated state/timestamp violation legal through 0076 and installs nothing', async () => {
      const { url, name } = await freshThrough('0076_compensation_state_machine.sql');
      const c = new Client({ connectionString: url }); await c.connect();
      let tenantId = '';
      const storageKey = 'dirty-before-0077';
      try {
        tenantId = (await c.query<{ id: string }>(
          `INSERT INTO tenant (slug, name) VALUES ('stop77','stop77') RETURNING id`,
        )).rows[0]!.id;
        // Legal at 0076: the one-way terminal-stamp CHECK permits a live state carrying a stamp.
        // 0077's bundled populated-data preflight must refuse this exact historical shape.
        await c.query(
          `INSERT INTO blob_tombstone
             (tenant_ref, storage_key, blob_class, reason, state, prepared_expires_at, deleted_at)
           VALUES ($1, $2, 'document', 'compensation', 'prepared', now() + interval '1 hour', now())`,
          [tenantId, storageKey],
        );
      } finally { await c.end(); }

      await expect(runMigrations({ adminConnectionString: url, ...roles }))
        .rejects.toThrow(/0077 preflight:.*state\/deleted_at coupling violations/i);

      const chk = new Client({ connectionString: url }); await chk.connect();
      try {
        expect((await chk.query(
          `SELECT count(*)::int n FROM _migrations WHERE id='0077_tombstone_state_timestamp_coupling.sql'`,
        )).rows[0].n).toBe(0);
        expect((await chk.query(
          `SELECT count(*)::int n FROM pg_constraint WHERE conname='blob_tombstone_state_timestamp_coupling_chk'`,
        )).rows[0].n).toBe(0);
        const row = (await chk.query<{ state: string; deleted_at: Date | null }>(
          `SELECT state, deleted_at FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`,
          [tenantId, storageKey],
        )).rows[0]!;
        expect(row.state).toBe('prepared');
        expect(row.deleted_at).not.toBeNull();
      } finally { await chk.end(); await dropDb(name); }
    }, 120_000);
  });
});

// HARDEN-3.5 C2: round-6 proved the invariant still representable two ways. R6-N02 — 0072's
// share guard skipped an UPDATE whose row was ALREADY Paid, so a reparent (change
// distribution_id, keep payout_status='Paid') moved a Paid share under a Revoked head with
// balanced deferred sums and committed. 0074 fires the guard on EVERY mutation whose NEW row is
// Paid. R6-N06 — 0072 scanned and installed with no write-blocking lock, so DML could commit a
// violating row between the clean scan and trigger creation; 0074's FIRST statement takes
// SHARE ROW EXCLUSIVE on both tables, making scan+install one atomic window.
describe('HARDEN-3.5 C2 (R6-N02/R6-N06) — distribution invariant on EVERY mutation, serialized install', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  /** DIST-A Live holds the Paid share; DIST-B Revoked holds a Pending share of equal size, so a
   *  cross-swap of the two shares keeps BOTH deferred sums balanced (Sentinel's balancing move). */
  async function seedReparentFixture(c: Client, tenantId: string): Promise<void> {
    await c.query('BEGIN');
    await c.query(`INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-R','R','2026-06-01')`, [tenantId]);
    await c.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-CA','A'), ($1,'PER-CB','B')`, [tenantId]);
    await c.query(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status) VALUES ($1,'PNL-R','MSN-R','Income','PrizeMoney','P',200000,'USD','Received')`, [tenantId]);
    await c.query(`INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by) VALUES ($1,'DIST-RA','MSN-R','PNL-R',100000,'USD',0,0,'Live','o@r.com')`, [tenantId]);
    // The Paid share sits under the LIVE head (the guard allows this — head is Live).
    await c.query(`INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor, payout_status, paid_on, payment_source_label) VALUES ($1,'DIST-RA','PER-CA',10000,100000,'Paid','2026-06-15','Bank')`, [tenantId]);
    // The Revoked head is inserted with NO Paid shares (allowed), holding a Pending twin.
    await c.query(`INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, revoked_reason, created_by) VALUES ($1,'DIST-RB','MSN-R','PNL-R',100000,'USD',0,0,'Revoked','test','o@r.com')`, [tenantId]);
    await c.query(`INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor, payout_status) VALUES ($1,'DIST-RB','PER-CB',10000,100000,'Pending')`, [tenantId]);
    await c.query('COMMIT');
  }

  /** The violating transaction: swap the two shares' parents (sums stay balanced). The FIRST
   *  update is the R6-N02 bypass — a row that stays Paid while its distribution_id changes. */
  async function attemptReparent(conn: Client, tenantId: string, asApp: boolean): Promise<'committed' | Error> {
    try {
      await conn.query('BEGIN');
      if (asApp) await conn.query(`SELECT set_config('app.tenant_id',$1,true)`, [tenantId]);
      await conn.query(`UPDATE distribution_share SET distribution_id='DIST-RB' WHERE tenant_id=$1 AND distribution_id='DIST-RA' AND person_id='PER-CA'`, [tenantId]);
      await conn.query(`UPDATE distribution_share SET distribution_id='DIST-RA' WHERE tenant_id=$1 AND distribution_id='DIST-RB' AND person_id='PER-CB'`, [tenantId]);
      await conn.query('COMMIT');
      return 'committed';
    } catch (e) {
      await conn.query('ROLLBACK').catch(() => {});
      return e as Error;
    }
  }

  it("R6-N02 (round-6's exact probe): reparenting an already-Paid share onto a Revoked head is DB-refused for the real c3_app role", async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'reparent' });
    const admin = new Client({ connectionString: db.adminUrl });
    const app = new Client({ connectionString: db.appUrl });
    await admin.connect(); await app.connect();
    try {
      await seedReparentFixture(admin, t.tenantId);
      const res = await attemptReparent(app, t.tenantId, true);
      // 0074: the share UPDATE itself is refused (NEW row is Paid → its CURRENT parent must be
      // Live). On 0072's transition predicate the whole balanced swap COMMITS — RED.
      expect(res).toBeInstanceOf(Error);
      expect((res as Error).message).toMatch(/LIVE distribution|C3E:CONFLICT/i);
      const bad = await admin.query(
        `SELECT count(*)::int n FROM distribution d JOIN distribution_share s ON s.tenant_id=d.tenant_id AND s.distribution_id=d.distribution_id WHERE d.status='Revoked' AND s.payout_status='Paid'`,
      );
      expect(bad.rows[0].n).toBe(0); // the invariant is NOT representable
    } finally {
      await app.end(); await admin.end();
    }
  });

  describe.skipIf(!!process.env.DATABASE_ADMIN_URL)('R6-N06: the 0074 scan/install window is serialized against concurrent DML', () => {
    const roles = { appRole: 'c3_app', appPassword: 'c3_app_dev_pw', authRole: 'c3_auth', authPassword: 'c3_auth_dev_pw', backupRole: 'c3_backup', backupPassword: 'c3_backup_dev_pw', allowDevSecrets: true as const };
    const maint = () => { const u = new URL(db.adminUrl); u.pathname = '/postgres'; return u.href; };

    it('a violating reparent racing the migration BLOCKS at the lock and is refused by the installed guard', async () => {
      // A fresh DB through 0073 (i.e. 0072's guards active, 0074 NOT yet applied).
      const name = `c3web_win_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
      const dbUrl = new URL(db.adminUrl); dbUrl.pathname = `/${name}`;
      const boot = new Client({ connectionString: maint() }); await boot.connect();
      try { await boot.query(`CREATE DATABASE ${name} WITH ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'`); } finally { await boot.end(); }
      const m = new Client({ connectionString: dbUrl.href }); // the "migrator"
      const w = new Client({ connectionString: dbUrl.href }); // the racing writer
      const obs = new Client({ connectionString: dbUrl.href });
      try {
        await runMigrations({ adminConnectionString: dbUrl.href, ...roles, targetInclusive: '0073_intake_lease_ttl_param.sql' });
        await m.connect(); await w.connect(); await obs.connect();
        const t = (await m.query<{ id: string }>(`INSERT INTO tenant (slug, name) VALUES ('winrace','winrace') RETURNING id`)).rows[0]!.id;
        await seedReparentFixture(m, t);

        // Replay the REAL 0074 file in its marked sections, holding the migration tx open
        // across a staged race (the exact scan→install window R6-N06 names).
        const file = readFileSync(fileURLToPath(new URL('../migrations/0074_distribution_every_mutation_invariant.sql', import.meta.url)), 'utf8');
        const lockSql = file.slice(file.indexOf('-- §lock'), file.indexOf('-- §scan'));
        const scanSql = file.slice(file.indexOf('-- §scan'), file.indexOf('-- §install'));
        const installSql = file.slice(file.indexOf('-- §install'));

        await m.query('BEGIN');
        await m.query(lockSql); // R6-N06: the fix — SHARE ROW EXCLUSIVE before the scan
        await m.query(scanSql); // the historical scan sees a clean state
        const mPid = (await m.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid;

        // THE RACE: the violating reparent fires DURING the window. With the lock it must
        // BLOCK; without it (neutered file) it commits between scan and install.
        const raceP = attemptReparent(w, t, false);
        let blocked = false;
        for (let i = 0; i < 200; i++) {
          const r = await obs.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid <> $1 AND pid <> pg_backend_pid() AND state='active'`, [mPid]);
          if (r.rows.length > 0) { blocked = true; break; }
          await sleep(25);
        }
        expect(blocked).toBe(true); // the writer queued behind the migration's lock

        await m.query(installSql); // guards installed inside the still-locked window
        await m.query('COMMIT'); // lock released — the writer resumes against the NEW guard

        const res = await raceP;
        expect(res).toBeInstanceOf(Error); // refused by the freshly installed every-mutation guard
        expect((res as Error).message).toMatch(/LIVE distribution|C3E:CONFLICT/i);
        const bad = await m.query(
          `SELECT count(*)::int n FROM distribution d JOIN distribution_share s ON s.tenant_id=d.tenant_id AND s.distribution_id=d.distribution_id WHERE d.status='Revoked' AND s.payout_status='Paid'`,
        );
        expect(bad.rows[0].n).toBe(0); // nothing slipped through the window
      } finally {
        await m.end().catch(() => {}); await w.end().catch(() => {}); await obs.end().catch(() => {});
        const boot2 = new Client({ connectionString: maint() }); await boot2.connect();
        try { await boot2.query(`DROP DATABASE IF EXISTS ${name}`); } catch { /* temp DB */ } finally { await boot2.end(); }
      }
    }, 120_000);
  });
});

// R5-N04 → HARDEN-3.5 B: CLASS-SPECIFIC namespace discipline (round-6 §6 tail) + the machine's
// resolve edge (prepared → resolved, rowCount-enforced).
describe('HARDEN-3.5 B — compensation namespace matrix + prepared→resolved', () => {
  it('insertBlobTombstone enforces the CLASS namespace; resolveCompensationIntent is prepared→resolved (terminal, stamped)', async () => {
    await db.truncateAll();
    const a = await db.seedTenant({ slug: 'nsa' });
    const b = await db.seedTenant({ slug: 'nsb' });
    const p = createPersistence({ appConnectionString: db.appUrl });
    const actorA = ownerActor(a.tenantId, 'o@nsa.com');
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    const prep = { reason: 'compensation' as const, state: 'prepared' as const, preparedTtlMs: 60_000 };
    try {
      // A foreign-tenant key and a path-traversal escape are both refused…
      await expect(p.writes.transaction(actorA, (tx) => tx.insertBlobTombstone({ storageKey: `${b.tenantId}/x`, blobClass: 'document', ...prep }))).rejects.toThrow(/outside|namespace/i);
      await expect(p.writes.transaction(actorA, (tx) => tx.insertBlobTombstone({ storageKey: `${a.tenantId}/../${b.tenantId}/x`, blobClass: 'document', ...prep }))).rejects.toThrow(/outside|namespace/i);
      // …and so is a CLASS-prefix mismatch (round-6 §6: either-prefix acceptance is dead).
      await expect(p.writes.transaction(actorA, (tx) => tx.insertBlobTombstone({ storageKey: `intake/${a.tenantId}/x`, blobClass: 'document', ...prep }))).rejects.toThrow(/class namespace/i);
      await expect(p.writes.transaction(actorA, (tx) => tx.insertBlobTombstone({ storageKey: `${a.tenantId}/x`, blobClass: 'intake', ...prep }))).rejects.toThrow(/class namespace/i);
      // Class-correct keys are accepted, born PREPARED (invisible to the drain).
      await p.writes.transaction(actorA, (tx) => tx.insertBlobTombstone({ storageKey: `${a.tenantId}/ok`, blobClass: 'document', ...prep }));
      await p.writes.transaction(actorA, (tx) => tx.insertBlobTombstone({ storageKey: `intake/${a.tenantId}/ok`, blobClass: 'intake', ...prep }));
      expect((await admin.query(`SELECT state FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`, [a.tenantId, `${a.tenantId}/ok`])).rows[0].state).toBe('prepared');
      // A DUPLICATE prepare THROWS (the old ON CONFLICT DO NOTHING silently swallowed it).
      await expect(p.writes.transaction(actorA, (tx) => tx.insertBlobTombstone({ storageKey: `${a.tenantId}/ok`, blobClass: 'document', ...prep }))).rejects.toThrow();
      // Resolving (the owning tx's success edge) is prepared→resolved with the terminal stamp.
      await p.writes.transaction(actorA, (tx) => tx.resolveCompensationIntent(`${a.tenantId}/ok`));
      const done = (await admin.query(`SELECT state, deleted_at FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`, [a.tenantId, `${a.tenantId}/ok`])).rows[0];
      expect(done.state).toBe('resolved');
      expect(done.deleted_at).not.toBeNull();
      // Resolving it AGAIN (or a never-prepared key) THROWS — the zero-row no-op is dead.
      await expect(p.writes.transaction(actorA, (tx) => tx.resolveCompensationIntent(`${a.tenantId}/ok`))).rejects.toThrow(/expected 1 prepared row/i);
      await expect(p.writes.transaction(actorA, (tx) => tx.resolveCompensationIntent(`${a.tenantId}/never-prepared`))).rejects.toThrow(/expected 1 prepared row/i);
      // The intake intent stays prepared (its request never declared an outcome) — the drain
      // cannot see it; only the TTL or its owner may arm it.
      expect((await admin.query(`SELECT state FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`, [a.tenantId, `intake/${a.tenantId}/ok`])).rows[0].state).toBe('prepared');
    } finally {
      await admin.end();
      await p.close();
    }
  });
});

describe('HARDEN-3.6 T3 — state/timestamp coupling for every role', () => {
  it('refuses a timestamp-only write on live rows as c3_app in-tenant and as admin', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 't3coupling' });
    const actor = ownerActor(t.tenantId, 'owner@t3.test');
    const local = createPersistence({ appConnectionString: db.appUrl });
    const appClient = new Client({ connectionString: db.appUrl });
    const admin = new Client({ connectionString: db.adminUrl });
    await appClient.connect(); await admin.connect();
    try {
      for (const suffix of ['app', 'admin']) {
        await local.writes.transaction(actor, (tx) => tx.insertBlobTombstone({
          storageKey: `${t.tenantId}/${suffix}`,
          blobClass: 'document', reason: 'compensation', state: 'prepared', preparedTtlMs: 60_000,
        }));
      }
      await appClient.query('BEGIN');
      await appClient.query("SELECT set_config('app.tenant_id', $1, true)", [t.tenantId]);
      await expect(appClient.query(
        `UPDATE blob_tombstone SET deleted_at=now() WHERE tenant_ref=$1 AND storage_key=$2`,
        [t.tenantId, `${t.tenantId}/app`],
      )).rejects.toThrow(/deleted_at|check constraint|coupling/i);
      await appClient.query('ROLLBACK');
      await expect(admin.query(
        `UPDATE blob_tombstone SET deleted_at=now() WHERE tenant_ref=$1 AND storage_key=$2`,
        [t.tenantId, `${t.tenantId}/admin`],
      )).rejects.toThrow(/deleted_at|check constraint|coupling/i);
      const rows = await admin.query(`SELECT state, deleted_at FROM blob_tombstone WHERE tenant_ref=$1 ORDER BY storage_key`, [t.tenantId]);
      expect(rows.rows).toEqual([
        expect.objectContaining({ state: 'prepared', deleted_at: null }),
        expect.objectContaining({ state: 'prepared', deleted_at: null }),
      ]);
    } finally {
      await appClient.end().catch(() => {}); await admin.end().catch(() => {}); await local.close();
    }
  });
});

describe('HARDEN-3.6 T1 — c3_app zombie resolver last line of defense', () => {
  it('resolveCompensationIntent against an armed row throws the registration-aborted zombie message', async () => {
    const key = `${tenantA}/t1-zombie`;
    await p.writes.transaction(actorA, (tx) => tx.insertBlobTombstone({
      storageKey: key, blobClass: 'document', reason: 'compensation', state: 'prepared', preparedTtlMs: 60_000,
    }));
    await p.writes.transaction(actorA, (tx) => tx.armCompensationIntent(key));
    await expect(p.writes.transaction(actorA, (tx) => tx.resolveCompensationIntent(key)))
      .rejects.toThrow(/drain already armed\/swept.*registration aborted/i);
    const [row] = await db.adminQuery<{ state: string; deleted_at: Date | null }>(
      `SELECT state, deleted_at FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`,
      [tenantA, key],
    );
    expect(row).toEqual(expect.objectContaining({ state: 'armed', deleted_at: null }));
  });
});

// HARDEN-3.5 A-1: blob_tombstone.tenant_ref has NO FK (0046 — the ledger must survive erasure),
// so nothing serialized a compensation pre-register against finalize's check-then-delete. The
// 0076 interlock trigger (BEFORE INSERT, SECURITY DEFINER, tenant FOR SHARE) + finalize's tenant
// FOR UPDATE (before its unswept check) make the window atomic BOTH ways.
describe('HARDEN-3.5 A-1 — the finalize interlock closes the check-then-delete window', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('a pre-register racing INSIDE the window BLOCKS on the interlock and FAILS tenant-missing after finalize commits', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'fin1' });
    await db.adminQuery(`UPDATE tenant SET exit_state='Exiting' WHERE id=$1`, [t.tenantId]);
    const p = createPersistence({ appConnectionString: db.appUrl });
    const fin = new Client({ connectionString: db.adminUrl });
    const obs = new Client({ connectionString: db.adminUrl });
    await fin.connect(); await obs.connect();
    try {
      // Finalize's exact opening statements: pin the tenant FOR UPDATE, then the unswept check.
      await fin.query('BEGIN');
      const finPid = (await fin.query<{ pid: number }>('SELECT pg_backend_pid() pid')).rows[0]!.pid;
      await fin.query(`SELECT slug FROM tenant WHERE id = $1 AND exit_state = 'Exiting' FOR UPDATE`, [t.tenantId]);
      const unswept = await fin.query(`SELECT count(*)::int AS n FROM blob_tombstone WHERE tenant_ref = $1 AND deleted_at IS NULL`, [t.tenantId]);
      expect(Number(unswept.rows[0].n)).toBe(0); // the check passes — the window is OPEN

      // THE RACE: a staff pre-register fires inside the window. Its 0076 interlock trigger
      // reads the tenant row FOR SHARE → it must BLOCK behind finalize's FOR UPDATE.
      const key = `${t.tenantId}/window-race`;
      const raceP = p.writes
        .transaction(ownerActor(t.tenantId, 'o@fin1.com'), (tx) =>
          tx.insertBlobTombstone({ storageKey: key, blobClass: 'document', reason: 'compensation', state: 'prepared', preparedTtlMs: 600_000 }),
        )
        .then(() => 'committed' as const, (e: unknown) => e as Error);
      let blocked = false;
      for (let i = 0; i < 200; i++) {
        const r = await obs.query(`SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND pid <> $1 AND pid <> pg_backend_pid() AND state='active'`, [finPid]);
        if (r.rows.length > 0) { blocked = true; break; }
        await sleep(25);
      }
      expect(blocked).toBe(true); // the interlock FOR SHARE queued behind finalize's FOR UPDATE

      // Finalize proceeds to the point of no return and COMMITS (identity gone).
      await fin.query(`DELETE FROM tenant WHERE id = $1`, [t.tenantId]);
      await fin.query('COMMIT');

      // The pre-register resumes, re-reads the tenant row — GONE — and RAISES: the request
      // refuses BEFORE any byte could be stored under a finalized tenant's prefix.
      const res = await raceP;
      expect(res).toBeInstanceOf(Error);
      // Drizzle wraps the driver error — the interlock's RAISE lives on the cause chain.
      const chain = [res, (res as { cause?: unknown }).cause, ((res as { cause?: { cause?: unknown } }).cause)?.cause]
        .map((e) => String((e as Error | undefined)?.message ?? '')).join(' | ');
      expect(chain).toMatch(/no longer exists|finalized/i);
      const orphanRows = await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM blob_tombstone WHERE storage_key = $1`, [key]);
      expect(Number(orphanRows[0]!.n)).toBe(0); // nothing was recorded for the dead tenant
    } finally {
      await fin.end().catch(() => {}); await obs.end().catch(() => {}); await p.close();
    }
  }, 40_000);

  it('a prepared intent committed BEFORE finalize makes the REAL finalizeTenantExit REFUSE (unswept)', async () => {
    await db.truncateAll();
    const t = await db.seedTenant({ slug: 'fin2' });
    await db.adminQuery(`UPDATE tenant SET exit_state='Exiting' WHERE id=$1`, [t.tenantId]);
    const p = createPersistence({ appConnectionString: db.appUrl });
    const admin = new Client({ connectionString: db.adminUrl });
    await admin.connect();
    try {
      await p.writes.transaction(ownerActor(t.tenantId, 'o@fin2.com'), (tx) =>
        tx.insertBlobTombstone({ storageKey: `${t.tenantId}/pre-window`, blobClass: 'document', reason: 'compensation', state: 'prepared', preparedTtlMs: 600_000 }),
      );
      // prepared counts as UNSWEPT — the point of no return refuses while any live intent exists.
      await expect(finalizeTenantExit(admin, t.tenantId, { listKeys: async () => [] })).rejects.toThrow(/unswept/i);
      expect((await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM tenant WHERE id=$1`, [t.tenantId]))[0]!.n).toBe('1'); // identity intact
    } finally {
      await admin.end(); await p.close();
    }
  }, 40_000);
});
