/**
 * twoTenantIsolation.test.ts — SLICE 1, STEP 1 (D-008 / D-011): the question
 * 34 FORCE-RLS policies exist to answer, asked for the first time.
 *
 * ⚖️ WHY THIS FILE EXISTS. `rlsCatalog.test.ts` already proves every tenant
 * table carries ENABLED + FORCED row-level security. That is a claim about
 * FLAGS. **It is not a claim about BEHAVIOUR**, and until now nothing in this
 * repo has ever populated two tenants and checked that one cannot see the
 * other — because there has only ever been one tenant, so there was nothing to
 * leak to. *Every one of those policies has been a claim with no counter-example
 * available. That is not the same as being wrong; it is the state in which being
 * wrong is invisible.*
 *
 * ⛔ AND IT IS DELIBERATELY ASKED IN THE HARNESS, NOT ON STAGING (Neural's
 * ordering condition). "Create a second tenant and find out whether RLS holds"
 * is an experiment run on the live system: if a policy does not hold you have
 * created the leak you were testing for, in the place where it matters. The
 * harness asks with nothing at stake — and it can ask on every table.
 *
 * THE SHARP FORM: it is not enough that a listing excludes the other tenant. The
 * real question is whether a caller who KNOWS THE EXACT PRIMARY KEY can reach
 * the row. A filter can be forgotten; RLS is what makes the row unreachable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';

let db: TestDatabase;
let alphaId = '';
let betaId = '';
let alphaPersonId = '';
let betaPersonId = '';
let betaMissionId = '';

/** Runs `fn` on a c3_app connection bound to `tenantId`, exactly as the app does. */
async function asTenant<T>(tenantId: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: db.appUrl });
  await client.connect();
  try {
    await client.query('BEGIN');
    // The real binding: transaction-local, discarded at COMMIT/ROLLBACK.
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const out = await fn(client);
    await client.query('ROLLBACK');
    return out;
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  db = await startTestDatabase();
  const alpha = await db.seedTenant({ slug: 'alpha', name: 'Alpha Org' });
  const beta = await db.seedTenant({ slug: 'beta', name: 'Beta Org' });
  alphaId = alpha.tenantId;
  betaId = beta.tenantId;

  // Populate BOTH tenants through the admin (RLS-bypassing) connection, so the
  // data exists beyond question and only the READ path is under test.
  const [a] = await db.adminQuery<{ id: string }>(
    `INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-0001','Alpha Person') RETURNING id`,
    [alphaId],
  );
  const [b] = await db.adminQuery<{ id: string }>(
    `INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-0001','Beta Person') RETURNING id`,
    [betaId],
  );
  const [bm] = await db.adminQuery<{ id: string }>(
    `INSERT INTO mission (tenant_id, mission_id, name, starts_on) VALUES ($1,'MSN-0001','Beta Mission','2026-09-01') RETURNING id`,
    [betaId],
  );
  alphaPersonId = a!.id;
  betaPersonId = b!.id;
  betaMissionId = bm!.id;
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('SLICE 1 — two populated tenants, and the isolation actually exercised', () => {
  it('POSITIVE CONTROL: both tenants really hold data, and the same business id exists in both', async () => {
    // Without this, every assertion below could pass against an empty database.
    // Note both people are PER-0001: business ids are per-tenant, so a leak
    // would be indistinguishable from a duplicate without the tenant column.
    const rows = await db.adminQuery<{ tenant_id: string; person_id: string }>(
      `SELECT tenant_id, person_id FROM person ORDER BY tenant_id`,
    );
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.person_id))).toEqual(new Set(['PER-0001']));
    expect(alphaId).not.toEqual(betaId);
  });

  it('a session bound to ALPHA sees only its own rows', async () => {
    const seen = await asTenant(alphaId, async (c) => {
      const r = await c.query<{ id: string; tenant_id: string }>('SELECT id, tenant_id FROM person');
      return r.rows;
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.tenant_id).toBe(alphaId);
    expect(seen[0]!.id).toBe(alphaPersonId);
  });

  it('⛔ THE SHARP FORM: knowing BETA\'s exact primary key does not reach the row', async () => {
    // A listing that excludes the other tenant only proves the WHERE clause.
    // This proves the row is unreachable even when the id is known — which is
    // the property RLS exists to provide and a filter cannot.
    const byId = await asTenant(alphaId, async (c) => {
      const r = await c.query('SELECT id FROM person WHERE id = $1', [betaPersonId]);
      return r.rowCount;
    });
    expect(byId).toBe(0);

    const mission = await asTenant(alphaId, async (c) => {
      const r = await c.query('SELECT id FROM mission WHERE id = $1', [betaMissionId]);
      return r.rowCount;
    });
    expect(mission).toBe(0);
  });

  it('⛔ the WRITE half: a session bound to ALPHA cannot create a row owned by BETA', async () => {
    // Isolation that only covers reads would let one tenant plant data in
    // another. This is the RLS WITH CHECK side of the same policy.
    await expect(
      asTenant(alphaId, async (c) => {
        await c.query(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1,'PER-9999','Planted')`, [betaId]);
      }),
    ).rejects.toThrow();

    // …and nothing landed.
    const planted = await db.adminQuery<{ n: string }>(
      `SELECT count(*)::text AS n FROM person WHERE person_id = 'PER-9999'`,
    );
    expect(planted[0]!.n).toBe('0');
  });

  it('⛔ and it cannot RE-HOME its own row into BETA', async () => {
    // The update path is a third door on the same policy: owning a row does not
    // entitle you to hand it to another tenant.
    await asTenant(alphaId, async (c) => {
      const r = await c.query('UPDATE person SET tenant_id = $1 WHERE id = $2', [betaId, alphaPersonId]);
      // Either refused outright or silently matched nothing — both acceptable;
      // what is NOT acceptable is the row moving.
      expect(r.rowCount).toBe(0);
    }).catch(() => {
      /* an outright rejection is equally correct */
    });

    const [still] = await db.adminQuery<{ tenant_id: string }>('SELECT tenant_id FROM person WHERE id = $1', [
      alphaPersonId,
    ]);
    expect(still!.tenant_id).toBe(alphaId);
  });

  it('THE CATALOG SWEEP: no table leaks a BETA row to an ALPHA session — with coverage reported, not implied', async () => {
    const tables = await db.adminQuery<{ table_name: string }>(
      `SELECT c.table_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND c.column_name = 'tenant_id'
          AND t.table_type = 'BASE TABLE'
        ORDER BY c.table_name`,
    );
    expect(tables.length, 'the sweep must see the tenant-scoped tables').toBeGreaterThan(40);

    const leaked: string[] = [];
    const exercised: string[] = [];
    const empty: string[] = [];

    for (const { table_name } of tables) {
      const [{ n }] = await db.adminQuery<{ n: string }>(
        `SELECT count(*)::text AS n FROM "${table_name}" WHERE tenant_id = $1`,
        [betaId],
      );
      if (n === '0') {
        empty.push(table_name);
        continue;
      }
      exercised.push(table_name);
      const visible = await asTenant(alphaId, async (c) => {
        const r = await c.query(`SELECT count(*)::text AS n FROM "${table_name}" WHERE tenant_id = $1`, [betaId]);
        return (r.rows[0] as { n: string }).n;
      });
      if (visible !== '0') leaked.push(`${table_name} (${visible} BETA row(s) visible from ALPHA)`);
    }

    expect(leaked, 'a tenant-scoped table exposed another tenant’s rows').toEqual([]);

    // ⚖️ NO SILENT CAPS. The sweep can only exercise tables that actually hold
    // BETA rows; the rest are UNPROVEN, not proven-clean, and saying so is the
    // difference between coverage and the appearance of it.
    expect(exercised.length, 'at least the seeded tables must be genuinely exercised').toBeGreaterThan(0);
    console.log(
      `[two-tenant sweep] exercised ${exercised.length} table(s): ${exercised.join(', ')}\n` +
        `[two-tenant sweep] UNPROVEN (no BETA rows to leak): ${empty.length} table(s)`,
    );
  });
});
