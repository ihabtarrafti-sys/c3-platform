/**
 * l05b.test.ts — the L-05b deferral contract, live (re-skin chapter Phase 1,
 * built BEFORE any engine-adjacent screen work per the chapter plan §5).
 *
 * Proves, against a REAL PostgreSQL and the REAL loaders:
 *  1. the query-count instrumentation works (the perf-budget mechanism) and
 *     records the full-load baseline the scoped loaders must beat;
 *  2. all three engine surfaces (Situation / Calendar / Departures) pass the
 *     output-equivalence harness — determinism + role-visibility (Q6) — on a
 *     fixture that gives every register material (asserted non-vacuous);
 *  3. the harness itself DISCRIMINATES (RED self-check): a scoped path with a
 *     mutated output and a role-divergent surface both throw.
 *
 * When a surface's SQL scoping lands, its change plugs `runScoped` into the
 * same surface definition — the identical assertion then gates the change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Actor } from '@c3web/domain';
import {
  getSituation,
  getSituationFullLoad,
  getCalendar,
  getCalendarFullLoad,
  listDepartures,
  listDeparturesFullLoad,
} from '@c3web/application';
import { startTestDatabase, instrumentPool, type TestDatabase, type QueryRecorder } from '@c3web/test-support';
import { createPersistence, type PersistenceHandle } from '../src/index';
import { withTenantTx, sql } from '../src/tenantContext';
import { assertSurfaceEquivalence, canonicalize, EquivalenceViolation, type EngineSurface } from './l05bHarness';

let db: TestDatabase;
let p: PersistenceHandle;
let recorder: QueryRecorder;
let owner: Actor;
let ops: Actor;

const CAL_HORIZON_DAYS = 60;

const isoDaysFromNow = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  db = await startTestDatabase();
  p = createPersistence({ appConnectionString: db.appUrl });
  recorder = instrumentPool(p.pool);

  const t = await db.seedTenant({
    slug: 'l05b',
    users: [
      { key: 'owner', email: 'owner@l05b.test', displayName: 'Owner L', role: 'owner' },
      { key: 'ops', email: 'ops@l05b.test', displayName: 'Ops L', role: 'operations' },
    ],
  });
  owner = { identity: 'owner@l05b.test', displayName: 'Owner L', role: 'owner', tenantId: t.tenantId };
  ops = { identity: 'ops@l05b.test', displayName: 'Ops L', role: 'operations', tenantId: t.tenantId };

  // ── the fixture: material in every register the three engines read ──
  const q = (text: string, params: unknown[] = []) => db.adminQuery(text, [t.tenantId, ...params]);

  await q(`INSERT INTO person (tenant_id, person_id, full_name, is_active) VALUES
    ($1, 'PER-L5A', 'Aria Star', true), ($1, 'PER-L5B', 'Bo Keeper', true), ($1, 'PER-L5C', 'Cato Left', false)`);

  await q(`INSERT INTO credential (tenant_id, credential_id, person_id, credential_type, issued_on, expires_on, is_active) VALUES
    ($1, 'CRED-L5A', 'PER-L5A', 'Visa', $2, $3, true),
    ($1, 'CRED-L5B', 'PER-L5B', 'Passport', $2, $4, true),
    ($1, 'CRED-L5C', 'PER-L5A', 'License', $2, $5, true)`,
    [isoDaysFromNow(-300), isoDaysFromNow(10), isoDaysFromNow(-5), isoDaysFromNow(400)]);

  await q(`INSERT INTO agreement (tenant_id, agreement_id, person_id, agreement_type, starts_on, ends_on, status) VALUES
    ($1, 'AGR-L5A', 'PER-L5A', 'Player', $2, $3, 'Active'),
    ($1, 'AGR-L5B', 'PER-L5B', 'Staff', $4, $5, 'Active')`,
    [isoDaysFromNow(-200), isoDaysFromNow(20), isoDaysFromNow(-400), isoDaysFromNow(45)]);

  await q(`INSERT INTO mission (tenant_id, mission_id, name, starts_on, ends_on, finance_stage, is_active) VALUES
    ($1, 'MSN-L5A', 'Desert Cup', $2, $3, 'Active', true),
    ($1, 'MSN-L5B', 'Winter Meet', $4, $5, 'Active', true)`,
    [isoDaysFromNow(-3), isoDaysFromNow(4), isoDaysFromNow(-90), isoDaysFromNow(-60)]);

  await q(`INSERT INTO mission_participant (tenant_id, mission_id, person_id, role, is_active, per_diem_amount_minor, per_diem_currency) VALUES
    ($1, 'MSN-L5A', 'PER-L5A', 'Player', true, 5000, 'USD'),
    ($1, 'MSN-L5B', 'PER-L5B', 'Coach', true, NULL, NULL)`);

  const addPersonPayload = (name: string) => JSON.stringify({ operationType: 'AddPerson', input: { fullName: name } });
  await q(`INSERT INTO approval (tenant_id, approval_id, operation_type, target_person_id, target_id, status, payload, submitted_by) VALUES
    ($1, 'APR-L5A', 'AddPerson', 'PER-L5X', NULL, 'Submitted', $2::jsonb, 'ops@l05b.test')`, [addPersonPayload('New Star')]);
  await q(`INSERT INTO approval (tenant_id, approval_id, operation_type, target_person_id, target_id, status, payload, submitted_by, reviewed_by, reviewed_at) VALUES
    ($1, 'APR-L5B', 'AddPerson', 'PER-L5A', 'PER-L5A', 'Approved', $2::jsonb, 'ops@l05b.test', 'owner@l05b.test', now())`, [addPersonPayload('Aria Star')]);

  await q(`INSERT INTO journey (tenant_id, journey_id, person_id, journey_type, started_on, status, created_by_approval_id) VALUES
    ($1, 'JRN-L5A', 'PER-L5A', 'Onboarding', $2, 'Active', 'APR-L5B')`, [isoDaysFromNow(-30)]);

  await q(`INSERT INTO mission_line (tenant_id, line_id, mission_id, direction, category, label, amount_minor, currency, payment_status) VALUES
    ($1, 'PNL-L5A', 'MSN-L5B', 'Income', 'PrizeMoney', 'Prize pool', 100000, 'USD', 'Expected'),
    ($1, 'PNL-L5B', 'MSN-L5A', 'Expense', 'Travel', 'Flights', 25000, 'USD', NULL)`);

  await q(`INSERT INTO entity (tenant_id, entity_id, name, jurisdiction, local_currency) VALUES
    ($1, 'ENT-L5A', 'Fictional Ops FZ', 'AE', 'USD')`);
  await q(`INSERT INTO invoice (tenant_id, invoice_id, invoice_number, entity_id, mission_id, line_id, billed_to_name, income_category, currency, subtotal_minor, vat_rate_bps, vat_minor, total_minor, status, issued_on, issued_by) VALUES
    ($1, 'INV-L5A', 'NL-2026-0001', 'ENT-L5A', 'MSN-L5B', 'PNL-L5A', 'Fictional Org', 'PrizeMoney', 'USD', 100000, 0, 0, 100000, 'Issued', $2, 'owner@l05b.test')`,
    [isoDaysFromNow(-40)]);

  await q(`INSERT INTO team (tenant_id, team_id, name, code, kind) VALUES
    ($1, 'TEAM-L5A', 'Alpha Blue', 'AB', 'GameDivision')`);
  await q(`INSERT INTO team_membership (tenant_id, team_id, person_id, role, is_active) VALUES
    ($1, 'TEAM-L5A', 'PER-L5A', 'Player', true)`);

  // The exact-sum invariant (0036) is INITIALLY DEFERRED — head + share must
  // land in ONE transaction, so this is a single multi-statement (paramless)
  // call: the simple-query protocol runs it as one implicit transaction.
  await db.adminQuery(`
    INSERT INTO distribution (tenant_id, distribution_id, mission_id, line_id, pool_minor, currency, org_share_bps, org_cut_minor, status, created_by) VALUES
      ('${t.tenantId}', 'DIST-L5A', 'MSN-L5B', 'PNL-L5A', 100000, 'USD', 0, 0, 'Live', 'owner@l05b.test');
    INSERT INTO distribution_share (tenant_id, distribution_id, person_id, share_bps, amount_minor, payout_status) VALUES
      ('${t.tenantId}', 'DIST-L5A', 'PER-L5A', 10000, 100000, 'Pending');
  `);

  await q(`INSERT INTO claim (tenant_id, claim_id, submitted_by, person_id, category, description, amount_minor, currency, expense_on, status) VALUES
    ($1, 'CLM-L5A', 'ops@l05b.test', 'PER-L5A', 'Travel', 'Taxi to venue', 3000, 'USD', $2, 'Submitted')`,
    [isoDaysFromNow(-2)]);

  await q(`INSERT INTO delegation (tenant_id, delegation_id, grantee_identity, granted_by, starts_on, ends_on, reason) VALUES
    ($1, 'DLG-L5A', 'ops@l05b.test', 'owner@l05b.test', $2, $3, 'Travel cover')`,
    [isoDaysFromNow(-1), isoDaysFromNow(30)]);

  await q(`INSERT INTO departure (tenant_id, departure_id, person_id, reason, status, initiated_by, initiated_on) VALUES
    ($1, 'DEP-L5A', 'PER-L5B', 'Contract end', 'InProgress', 'owner@l05b.test', $2)`,
    [isoDaysFromNow(-7)]);

  await q(`INSERT INTO subscription (tenant_id, subscription_id, name, vendor_name, amount_minor, currency, cadence, status, started_on, next_renewal_on) VALUES
    ($1, 'SUB-L5A', 'HQ Internet', 'FiberCo', 5000, 'USD', 'Monthly', 'Active', $2, $3)`,
    [isoDaysFromNow(-100), isoDaysFromNow(15)]);

  await q(`INSERT INTO kit (tenant_id, kit_id, name, category, assigned_person_id) VALUES
    ($1, 'KIT-L5A', 'Practice PC', 'Hardware', 'PER-L5B')`);
  await q(`INSERT INTO apparel (tenant_id, apparel_id, name, category, assigned_person_id) VALUES
    ($1, 'APP-L5A', 'Team Jacket', 'Outerwear', 'PER-L5B')`);
}, 180_000);

afterAll(async () => {
  await p?.close();
  await db?.stop();
});

// ── the three engine surfaces: FullLoad = the truth oracle; the production
//    functions are the SCOPED paths (Phase 2) gated by the harness ──
const situationSurface: EngineSurface = {
  name: 'situation',
  run: (actor) => getSituationFullLoad(p, actor),
  runScoped: (actor) => getSituation(p, actor),
};
const calendarSurface: EngineSurface = {
  name: 'calendar',
  run: (actor) => getCalendarFullLoad(p, actor, CAL_HORIZON_DAYS),
  runScoped: (actor) => getCalendar(p, actor, CAL_HORIZON_DAYS),
};
const departuresSurface: EngineSurface = {
  name: 'departures',
  run: (actor) => listDeparturesFullLoad(p, actor),
  runScoped: (actor) => listDepartures(p, actor),
};

describe('L-05b — query-count instrumentation (the perf-budget mechanism)', () => {
  it('tallies statements and rows for the situation full-load path, recording the baseline', async () => {
    recorder.reset();
    const view = await getSituationFullLoad(p, owner);
    const baseline = recorder.snapshot();

    // 16 parallel register reads, each inside its own tenant tx → at least one
    // statement per register plus tx overhead; rows cover the whole fixture.
    expect(baseline.statements).toBeGreaterThanOrEqual(16);
    expect(baseline.rows).toBeGreaterThan(20);
    expect(view.signals.length).toBeGreaterThan(0);

    // The number the scoped loader must beat — printed into the record.
    // eslint-disable-next-line no-console
    console.log(`[L-05b baseline] situation full-load: ${baseline.statements} statements, ${baseline.rows} rows`);
  });

  it('resets cleanly between measurements', async () => {
    recorder.reset();
    expect(recorder.snapshot()).toEqual({ statements: 0, rows: 0 });
    await getCalendarFullLoad(p, owner, CAL_HORIZON_DAYS);
    const cal = recorder.snapshot();
    expect(cal.statements).toBeGreaterThanOrEqual(6); // 6 register reads + tx overhead
    // eslint-disable-next-line no-console
    console.log(`[L-05b baseline] calendar full-load: ${cal.statements} statements, ${cal.rows} rows`);
    recorder.reset();
    await listDeparturesFullLoad(p, owner);
    const dep = recorder.snapshot();
    expect(dep.statements).toBeGreaterThanOrEqual(7); // 7 register reads + tx overhead
    // eslint-disable-next-line no-console
    console.log(`[L-05b baseline] departures full-load: ${dep.statements} statements, ${dep.rows} rows`);
  });
});

describe('Phase 2 — the scoped loaders beat their full-load baselines', () => {
  it('situation: one coherent transaction, strictly fewer round trips', async () => {
    // Warm-up first: getSituation sweeps signal notifications (idempotent by
    // key); one prior full-load call makes both measured runs sweep-neutral,
    // so the comparison is loaders-only, not dedupe noise.
    await getSituationFullLoad(p, owner);

    recorder.reset();
    await getSituationFullLoad(p, owner);
    const full = recorder.snapshot();
    recorder.reset();
    await getSituation(p, owner);
    const scoped = recorder.snapshot();

    // eslint-disable-next-line no-console
    console.log(`[L-05b phase 2] situation: full ${full.statements} → scoped ${scoped.statements} statements`);
    expect(scoped.statements).toBeLessThan(full.statements);
    // Identical queries — only the transacting changed. The row delta is
    // EXACTLY the per-transaction `SELECT set_config` row (1 each) from the
    // 15 retired transactions (16 → 1); a scoped path that dropped or added
    // a register would shift this by that register's row count and fail.
    expect(full.rows - scoped.rows).toBe(15);
  });

  it('calendar: one coherent transaction, strictly fewer round trips', async () => {
    recorder.reset();
    await getCalendarFullLoad(p, owner, CAL_HORIZON_DAYS);
    const full = recorder.snapshot();
    recorder.reset();
    await getCalendar(p, owner, CAL_HORIZON_DAYS);
    const scoped = recorder.snapshot();
    // eslint-disable-next-line no-console
    console.log(`[L-05b phase 2] calendar: full ${full.statements} → scoped ${scoped.statements} statements`);
    expect(scoped.statements).toBeLessThan(full.statements);
    expect(scoped.statements).toBeLessThanOrEqual(12); // BEGIN + set_config + 6 SELECT + COMMIT + headroom
    expect(full.rows - scoped.rows).toBe(5); // the set_config row from each of the 5 retired txs (6 → 1)
  });

  it('departures: one coherent transaction, strictly fewer round trips', async () => {
    recorder.reset();
    await listDeparturesFullLoad(p, owner);
    const full = recorder.snapshot();
    recorder.reset();
    await listDepartures(p, owner);
    const scoped = recorder.snapshot();
    // eslint-disable-next-line no-console
    console.log(`[L-05b phase 2] departures: full ${full.statements} → scoped ${scoped.statements} statements`);
    expect(scoped.statements).toBeLessThan(full.statements);
    expect(scoped.statements).toBeLessThanOrEqual(13); // BEGIN + set_config + 7 SELECT + COMMIT + headroom
    expect(full.rows - scoped.rows).toBe(6); // the set_config row from each of the 6 retired txs (7 → 1)
  });
});

describe('L-05b — output-equivalence harness (determinism + Q6 role visibility)', () => {
  it('the fixture is material: every engine produces real output (non-vacuous equivalence)', async () => {
    const situation = await getSituation(p, owner);
    expect(situation.signals.length).toBeGreaterThan(0);
    expect(situation.counts.activeMissions).toBeGreaterThan(0);
    expect(situation.counts.openApprovals).toBeGreaterThan(0);

    const calendar = await getCalendar(p, owner, CAL_HORIZON_DAYS);
    expect(calendar.length).toBeGreaterThan(0);

    const departures = await listDepartures(p, owner);
    expect(departures.length).toBeGreaterThan(0);
    expect(departures[0]!.openItems.length).toBeGreaterThan(0); // readiness engine engaged
  });

  it('situation passes: deterministic + owner/operations byte-identical', async () => {
    await assertSurfaceEquivalence(situationSurface, [owner, ops]);
  });

  it('calendar passes: deterministic + owner/operations byte-identical', async () => {
    await assertSurfaceEquivalence(calendarSurface, [owner, ops]);
  });

  it('departures passes: deterministic + owner/operations byte-identical', async () => {
    await assertSurfaceEquivalence(departuresSurface, [owner, ops]);
  });
});

describe('L-05b — the harness itself discriminates (RED self-check)', () => {
  it('a scoped path whose output drops one signal is REFUSED', async () => {
    const lying: EngineSurface = {
      name: 'situation-lying-scope',
      run: (actor) => getSituation(p, actor),
      // The "scoped" path silently loses the last signal — exactly the class
      // of failure the harness exists to catch.
      runScoped: async (actor) => {
        const view = await getSituation(p, actor);
        return { ...view, signals: view.signals.slice(0, -1) };
      },
    };
    await expect(assertSurfaceEquivalence(lying, [owner, ops])).rejects.toThrow(EquivalenceViolation);
    await expect(assertSurfaceEquivalence(lying, [owner, ops])).rejects.toThrow(/SCOPED-OUTPUT/);
  });

  it('a surface whose output diverges per role is REFUSED (Q6)', async () => {
    const roleLeaky: EngineSurface = {
      name: 'situation-role-leaky',
      run: async (actor) => {
        const view = await getSituation(p, actor);
        // Simulate role-divergent visibility: operations loses a count.
        return actor.role === 'operations' ? { ...view, counts: { ...view.counts, openApprovals: 0 } } : view;
      },
    };
    await expect(assertSurfaceEquivalence(roleLeaky, [owner, ops])).rejects.toThrow(/ROLE-VISIBILITY/);
  });

  it('canonicalize is field-order independent (byte-identity is semantic, not incidental)', () => {
    expect(canonicalize({ b: 1, a: [{ y: 2, x: 3 }] })).toBe(canonicalize({ a: [{ x: 3, y: 2 }], b: 1 }));
    expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
  });

  it('canonicalize REFUSES non-plain values (two different Dates must never silently compare equal)', () => {
    // Adversarial-review fix: Date/Map/Set have no enumerable keys and would
    // all canonicalize to {} — a false-negative class in the gate itself.
    expect(() => canonicalize({ ts: new Date() })).toThrow(/non-canonical/);
    expect(() => canonicalize({ m: new Map([['k', 1]]) })).toThrow(/non-canonical/);
    expect(() => canonicalize({ s: new Set([1]) })).toThrow(/non-canonical/);
  });
});

describe('Phase 2 — the coherent snapshot is REAL (adversarial-review fixes)', () => {
  // These run LAST: the torn-read probe commits a person row mid-test, and
  // every fixture-shaped expectation above must see the original fixture.

  it('withTenantTx honors REPEATABLE READ READ ONLY for a batched read', async () => {
    const row = await withTenantTx(
      p.pool,
      owner,
      'read',
      async (db) => {
        const res = await db.execute(
          sql`SELECT current_setting('transaction_isolation') AS iso, current_setting('transaction_read_only') AS ro`,
        );
        return res.rows[0] as { iso: string; ro: string };
      },
      'REPEATABLE READ',
    );
    expect(row.iso).toBe('repeatable read');
    expect(row.ro).toBe('on');
  });

  it('a mid-batch commit is INVISIBLE inside the batch, and a nested batch shares the SAME snapshot', async () => {
    // The marquee property, end-to-end through the REAL reads.forActor().batch
    // path: under the old per-read READ COMMITTED transacting (or a silently
    // ignored isolation argument) the second and nested reads WOULD see the
    // committed insert and this test fails — it discriminates the isolation.
    const reads = p.reads.forActor(owner);
    await reads.batch(async (r) => {
      const first = (await r.listPeople()).map((x) => x.personId);
      await db.adminQuery(`INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1, 'PER-L5RR', 'Torn Read Probe')`, [
        owner.tenantId,
      ]);
      const second = (await r.listPeople()).map((x) => x.personId);
      expect(second).toEqual(first);
      // Reentrant batch: the ports.ts contract says it reuses the open
      // transaction — proven here because a NEW transaction (at any isolation)
      // would see the committed row.
      const nested = (await r.batch((r2) => r2.listPeople())).map((x) => x.personId);
      expect(nested).toEqual(first);
      return null;
    });
    // A fresh per-call transaction afterwards sees the committed row.
    const after = await reads.listPeople();
    expect(after.some((x) => x.personId === 'PER-L5RR')).toBe(true);
  });
});
