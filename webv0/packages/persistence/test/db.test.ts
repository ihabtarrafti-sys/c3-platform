/**
 * db.test.ts — DB integration evidence against a REAL PostgreSQL (embedded when
 * DATABASE_URL is unset). Covers: migrations, constraints, RLS, transaction
 * rollback, optimistic concurrency, execution idempotency, append-only event
 * enforcement, tenant isolation, connection-pool tenant-context isolation, and
 * admin/app connection (role) separation.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import type { Actor } from '@c3web/domain';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';
import { runMigrations } from '../src/migrate';
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
      expect(migs.rows.map((r) => r.id)).toEqual(['0001_schema.sql', '0002_rls.sql', '0003_grants.sql', '0004_auth_role_grants.sql', '0005_external_identity.sql', '0006_backup_role_grants.sql', '0007_access_events.sql', '0008_member_admin.sql', '0009_credentials.sql', '0010_journeys.sql', '0011_kit_apparel.sql', '0012_missions.sql', '0013_agreements.sql', '0014_withdrawn_status.sql', '0015_equipment_status.sql', '0016_entities.sql', '0017_money_foundation.sql', '0018_per_diem.sql', '0019_agreement_terms.sql', '0020_governed_agreement_terms.sql', '0021_mission_lines.sql', '0022_entity_level_agreements.sql', '0023_mission_finance_upgrade.sql', '0024_documents.sql', '0025_import_batches.sql', '0026_invoices.sql', '0027_teams.sql', '0028_distributions.sql', '0029_claims.sql', '0030_notifications.sql', '0031_delegations.sql', '0032_people_v2.sql', '0033_credentials_v2_beneficiaries.sql', '0034_harden1.sql', '0035_beneficiary_payee_anchor.sql', '0036_harden2_closure.sql', '0037_tenant_settings.sql', '0038_request_corrections.sql', '0039_comments.sql', '0040_guest_intake.sql', '0041_subscriptions.sql', '0042_departures.sql', '0043_person_photo.sql', '0044_saved_views.sql', '0045_scrub_intake_pii.sql', '0046_blob_tombstone.sql', '0047_reactivate_credential_op.sql', '0048_finance_check_hardening.sql', '0049_settlement_race_guards.sql', '0050_provision_identity_lock.sql']);
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
