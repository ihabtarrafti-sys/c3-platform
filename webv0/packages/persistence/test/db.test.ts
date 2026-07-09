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
      expect(migs.rows.map((r) => r.id)).toEqual(['0001_schema.sql', '0002_rls.sql', '0003_grants.sql', '0004_auth_role_grants.sql', '0005_external_identity.sql', '0006_backup_role_grants.sql', '0007_access_events.sql', '0008_member_admin.sql', '0009_credentials.sql', '0010_journeys.sql', '0011_kit_apparel.sql', '0012_missions.sql', '0013_agreements.sql', '0014_withdrawn_status.sql', '0015_equipment_status.sql', '0016_entities.sql', '0017_money_foundation.sql']);
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

  it('the approval payload is immutable after submission (trigger-enforced)', async () => {
    const { approvalId } = await submitApprovalIn(actorA);
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]); // not needed for owner but harmless
      await expect(
        client.query(`UPDATE approval SET payload = '{"operationType":"AddPerson","input":{"fullName":"HACKED"}}'::jsonb WHERE approval_id=$1`, [approvalId]),
      ).rejects.toThrow(/immutable/i);
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
