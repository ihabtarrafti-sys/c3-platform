/**
 * roleIsolationPosture.test.ts — `c3_app` and `c3_auth` NEVER bypass RLS.
 *
 * ⚖️ WHY THIS EXISTS WHEN THE PROPERTY IS ALREADY COVERED. `db.test.ts:2207`
 * asserts the SET of non-superuser BYPASSRLS roles equals `['c3_backup']`, so a
 * loosening of either role does fail today. **This is not a hole being plugged;
 * it is a legibility fix**, and the distinction is worth stating rather than
 * over-claiming:
 *
 *   - that assertion lives inside `describe('c3_backup role posture')`, so
 *     someone auditing `c3_app` will not find it by searching;
 *   - it fails as a LIST mismatch, naming the wrong subject — the failure says
 *     "the bypass set changed", not "c3_app can now read every tenant".
 *
 * ⛔ WHY THESE TWO ROLES SPECIFICALLY. A superuser — and any BYPASSRLS role —
 * ignores row-level security **including FORCE**. `c3_app` is the API's own
 * connection and `c3_auth` resolves membership, so **their NOBYPASSRLS posture
 * IS the tenant-isolation story**: with it, the 34 FORCE policies are load
 * bearing; without it they are decorative and every screen still works. That is
 * the failure mode with no symptom, and it is why the property deserves to fail
 * by name.
 *
 * ⚠️ The property is currently maintained by `ensureRestrictedRole`
 * (persistence/src/migrate.ts:138), which re-clamps `NOSUPERUSER NOBYPASSRLS` on
 * EVERY migration run. That is a strong mechanism — and a mechanism nobody was
 * asserting is still there.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

/** The two roles whose NOBYPASSRLS posture carries tenant isolation. */
const SUBJECT_TO_RLS = ['c3_app', 'c3_auth'] as const;

describe('tenant isolation depends on these roles being SUBJECT to RLS', () => {
  for (const role of SUBJECT_TO_RLS) {
    it(`${role} is NOSUPERUSER and NOBYPASSRLS — it must never read another tenant`, async () => {
      const client = new Client({ connectionString: db.adminUrl });
      await client.connect();
      try {
        const r = await client.query<{
          rolsuper: boolean;
          rolbypassrls: boolean;
          rolcanlogin: boolean;
        }>(`SELECT rolsuper, rolbypassrls, rolcanlogin FROM pg_roles WHERE rolname = $1`, [role]);

        // POSITIVE CONTROL: a typo in the role name would otherwise pass vacuously.
        expect(r.rowCount, `role '${role}' does not exist — the bootstrap did not run`).toBe(1);

        expect(r.rows[0]!.rolsuper, `${role} must not be a superuser: a superuser ignores RLS entirely`).toBe(false);
        expect(
          r.rows[0]!.rolbypassrls,
          `${role} must NOT have BYPASSRLS — with it, all 34 FORCE policies become decorative and every screen still works`,
        ).toBe(false);
        expect(r.rows[0]!.rolcanlogin, `${role} is a connection identity and must be able to log in`).toBe(true);
      } finally {
        await client.end();
      }
    });
  }

  it('and the ONLY non-superuser that may bypass RLS is the backup role', async () => {
    // Complements the per-role pins above: they catch a loosening of a known
    // role, this catches a NEW role arriving with the exception.
    const client = new Client({ connectionString: db.adminUrl });
    await client.connect();
    try {
      const r = await client.query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolbypassrls AND NOT rolsuper ORDER BY rolname`,
      );
      expect(r.rows.map((x) => x.rolname)).toEqual(['c3_backup']);
    } finally {
      await client.end();
    }
  });
});
