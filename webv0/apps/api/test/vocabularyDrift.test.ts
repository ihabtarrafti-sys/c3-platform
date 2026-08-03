/**
 * vocabularyDrift.test.ts — bind every TypeScript vocabulary to the PostgreSQL
 * constraint that enforces it. `D-015`, item 4 of the certification criterion.
 *
 * ⚖️ WHY THIS READS THE LIVE SCHEMA AND NOT THE MIGRATION FILES (LAW 23). A
 * migrations directory is an APPEND-ONLY LOG OF INTENTIONS, not a description of
 * the current schema. Grepping `migrations/*.sql` answers *"which files MENTION
 * this vocabulary"* — a historical question — while the question that matters is
 * *"which definitions are LIVE"*. That distinction is not academic: the erasure
 * trigger vocabulary appears in four migrations, and **two of those sites are
 * dead** — `0085` drops and re-adds the constraint `0080` created, and `0084` is
 * a `CREATE OR REPLACE` of `0080`'s function. A list built from the text named
 * both dead sites and missed the live one.
 *
 * ⇒ So this test asks `pg_constraint` and `pg_proc` on a database with every
 * migration applied. Whatever wrote the current definition, this sees it.
 *
 * ⛔ IT ALSO CATCHES A SHAPE THE TEXT CANNOT. PostgreSQL normalises `x IN (…)`
 * into `x = ANY (ARRAY[…])`, so a reader matching `IN\s*\(` against the LIVE
 * constraint finds nothing at all. The stored form is not the written form.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { C3_ROLES } from '@c3web/domain';
import { PLATFORM_CAPABILITIES } from '@c3web/authz';
import { ERASURE_JANITOR_TRIGGERS } from '../src/erasureJanitor';

let db: TestDatabase;
let sql: Client;

beforeAll(async () => {
  db = await startTestDatabase();
  sql = new Client({ connectionString: db.adminUrl });
  await sql.connect();
}, 180_000);

afterAll(async () => {
  await sql?.end().catch(() => {});
  await db?.stop();
});

/** Quoted literals inside the first `ARRAY[…]` following `anchor`. */
function anyArrayAfter(definition: string, anchor: string): string[] {
  const at = definition.indexOf(anchor);
  if (at < 0) throw new Error(`anchor ${JSON.stringify(anchor)} not found in constraint definition`);
  const open = definition.indexOf('ARRAY[', at);
  if (open < 0) throw new Error(`no ARRAY[…] after ${JSON.stringify(anchor)}`);
  const close = definition.indexOf(']', open);
  return [...definition.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

/** Quoted literals inside the `NOT IN (…)` guarding `column` in a function body. */
function notInValues(source: string, column: string): string[] {
  const match = new RegExp(`${column}\\s+NOT\\s+IN\\s*\\(([^)]*)\\)`, 'i').exec(source);
  if (!match?.[1]) throw new Error(`no "${column} NOT IN (…)" guard found in function body`);
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string);
}

async function constraintDef(name: string): Promise<string> {
  const r = await sql.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`,
    [name],
  );
  expect(r.rowCount, `constraint ${name} must exist in the live schema`).toBe(1);
  return r.rows[0]!.def;
}

async function functionSource(name: string): Promise<string> {
  const r = await sql.query<{ prosrc: string }>(`SELECT prosrc FROM pg_proc WHERE proname = $1`, [name]);
  // ⛔ Exactly one. `CREATE OR REPLACE` with a DIFFERING argument list creates an
  // OVERLOAD rather than replacing, leaving the old body live — so two rows here
  // would mean two enforcement points, one of them invisible to whoever last
  // edited "the" function.
  expect(r.rowCount, `expected exactly one ${name}; more than one means an overload survived`).toBe(1);
  return r.rows[0]!.prosrc;
}

describe('the role vocabulary is bound to PostgreSQL', () => {
  it('C3_ROLES equals role_assignment_role_check, exactly and in order-independent fashion', async () => {
    // ⚖️ THE POINT: adding a role in TypeScript alone produces a value the
    // database rejects at INSERT — and `Actor.role` is typed, so nothing upstream
    // complains. This is the test that makes "adding a role is a migration, not
    // an enum edit" enforceable rather than remembered.
    const sqlRoles = anyArrayAfter(await constraintDef('role_assignment_role_check'), 'role = ANY');
    expect([...sqlRoles].sort()).toEqual([...C3_ROLES].sort());
  });
});

describe('the erasure trigger vocabulary is bound in BOTH live places', () => {
  // ⛔ TWO SITES, AND THE SECOND IS THE ONE THAT BITES. The constraint accepts or
  // rejects the audit ROW; the function guards the WRITE. Widening only the
  // constraint yields a janitor that completes its destructive sweep and THEN
  // fails to record it — the audit trail loses exactly the pass that mattered.
  it('the audit-shape CONSTRAINT accepts precisely ERASURE_JANITOR_TRIGGERS', async () => {
    const def = await constraintDef('audit_event_platform_erasure_shape_chk');
    const values = anyArrayAfter(def, `'trigger'::text) = ANY`);
    expect([...values].sort()).toEqual([...ERASURE_JANITOR_TRIGGERS].sort());
  });

  it('the audit WRITER function guards on precisely ERASURE_JANITOR_TRIGGERS', async () => {
    const src = await functionSource('append_post_finalize_erasure_straggler_audit');
    const values = notInValues(src, 'p_trigger');
    expect([...values].sort()).toEqual([...ERASURE_JANITOR_TRIGGERS].sort());
  });

  it('⚖️ and the two SQL sites agree with each other', async () => {
    // Stated separately because they can drift from each other without either
    // drifting from TypeScript — a migration that widens one and not the other
    // passes both tests above only if TypeScript was widened too. This one fails
    // the moment the pair diverges, whatever TypeScript says.
    const fromConstraint = anyArrayAfter(
      await constraintDef('audit_event_platform_erasure_shape_chk'),
      `'trigger'::text) = ANY`,
    );
    const fromFunction = notInValues(
      await functionSource('append_post_finalize_erasure_straggler_audit'),
      'p_trigger',
    );
    expect([...fromConstraint].sort()).toEqual([...fromFunction].sort());
  });
});

describe('the platform capability vocabulary is bound too', () => {
  // ⛳ BOUND ON ARRIVAL, not after it bites. The erasure trigger taught this the
  // expensive way: a vocabulary enforced in both TypeScript and PostgreSQL drifts
  // silently until something destructive fails halfway. `platform_principal`
  // (0104) constrains its `capabilities` column, so it joins the same binding the
  // day it is created.
  it('PLATFORM_CAPABILITIES equals the platform_principal capabilities CHECK', async () => {
    const r = await sql.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'platform_principal'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%capabilities%'`,
    );
    expect(r.rowCount, 'the capabilities CHECK must exist in the live schema').toBe(1);

    // Stored as `capabilities <@ ARRAY['…'::text, …]`, so the literals are read
    // the same way as any other ARRAY form.
    const values = anyArrayAfter(r.rows[0]!.def, 'ARRAY[');
    expect([...values].sort()).toEqual([...PLATFORM_CAPABILITIES].sort());
  });
});

describe('the extractors themselves are trustworthy', () => {
  // A drift test that silently finds nothing reports agreement. These pin that
  // the extractors REFUSE rather than return an empty set — the failure mode
  // that would make every assertion above vacuously true.
  it('refuses a missing anchor instead of returning nothing', () => {
    expect(() => anyArrayAfter("CHECK ((role = ANY (ARRAY['owner'::text])))", 'nope = ANY')).toThrow(/not found/);
    expect(() => notInValues('IF p_other NOT IN (1) THEN', 'p_trigger')).toThrow(/no "p_trigger NOT IN/);
  });

  it('reads the live ARRAY form, which is NOT the written IN form', () => {
    // Regression pin for the shape that makes migration-text matching fail:
    // PostgreSQL stores `IN (…)` as `= ANY (ARRAY[…])`.
    const stored = "CHECK (((after ->> 'trigger'::text) = ANY (ARRAY['boot'::text, 'interval'::text])))";
    expect(anyArrayAfter(stored, `'trigger'::text) = ANY`)).toEqual(['boot', 'interval']);
    expect(/\bIN\s*\(/.test(stored), 'the stored form contains no bare IN(…) to match').toBe(false);
  });
});
