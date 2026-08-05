/**
 * clusterBinding.test.ts — CR-035's classifier, and the ONE empirical fact the
 * fix stands on, measured rather than asserted.
 *
 * ⚖️ The classifier is pure because the drill script is hosted-only — the branch
 * that fires exactly when it runs must be provable before it runs (the
 * `classifyDropVerification` pattern, same file, same reason).
 *
 * ⛔ THE EMPIRICAL FACT: `pg_control_system()` must be executable by the
 * RESTRICTED `c3_backup` role — the drill reads the live side's fingerprint
 * through `DATABASE_URL`, which is c3_backup. Default PostgreSQL grants make
 * this PUBLIC-executable, but "default grants" is exactly the kind of claim this
 * lane has twice been burned asserting from memory (the `--skip-deploys`
 * incident; the `--set` incident). So it is MEASURED here against a real
 * cluster, as the restricted role. If PostgreSQL ever revokes it, this test —
 * not a production drill at 2am — is what goes red.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { classifyClusterBinding, type FingerprintObservation } from '../src/restore';

const ok = (id: string): FingerprintObservation => ({ ok: true, systemIdentifier: id });
const failed = (error: string): FingerprintObservation => ({ ok: false, error });

describe('⚖️ classifyClusterBinding — pure, every branch named', () => {
  it('matching identifiers bind, and the verdict carries the fingerprint', () => {
    expect(classifyClusterBinding(ok('7234'), ok('7234'))).toEqual({ ok: true, systemIdentifier: '7234' });
  });

  it('⛔ DIFFERENT identifiers refuse, naming BOTH clusters', () => {
    // The finding itself: cluster A's genuine counts certifying cluster B.
    const v = classifyClusterBinding(ok('cluster-b'), ok('cluster-a'));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.failure).toContain('cluster-b');
      expect(v.failure).toContain('cluster-a');
      expect(v.failure).toMatch(/DIFFERENT clusters/);
    }
  });

  it('⛔ an UNREADABLE admin fingerprint refuses — fail closed, not fail open (LAW 32)', () => {
    const v = classifyClusterBinding(failed('permission denied'), ok('7234'));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.failure).toMatch(/ADMIN credential/);
      expect(v.failure).toContain('permission denied');
    }
  });

  it('⛔ an UNREADABLE live fingerprint refuses, and says WHICH side', () => {
    // "Cannot prove same-cluster" and "proved different-cluster" have different
    // fixes; the two refusals must not read alike.
    const v = classifyClusterBinding(ok('7234'), failed('connection refused'));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.failure).toMatch(/LIVE-READ credential/);
      expect(v.failure).not.toMatch(/ADMIN credential/);
    }
  });

  it('an ok observation with an EMPTY identifier is not a proof', () => {
    const v = classifyClusterBinding({ ok: true, systemIdentifier: '' }, ok('7234'));
    expect(v.ok).toBe(false);
  });
});

describe('⛔ the fingerprint is readable by the restricted role — MEASURED', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('c3_backup (non-superuser) can read the cluster identity', async () => {
    const c = new Client({ connectionString: db.adminUrl });
    await c.connect();
    try {
      // SET ROLE makes the ACL question about c3_backup, not the admin.
      await c.query('SET ROLE c3_backup');
      const who = await c.query('SELECT current_user');
      expect(who.rows[0].current_user).toBe('c3_backup');
      const r = await c.query('SELECT system_identifier::text AS id FROM pg_control_system()');
      expect(typeof r.rows[0].id).toBe('string');
      expect(r.rows[0].id.length).toBeGreaterThan(0);
    } finally {
      await c.end();
    }
  });

  it('⛳ two connections to the SAME cluster observe the SAME identifier', async () => {
    // The equality property the whole check rests on, proven against a real
    // cluster rather than the mock: identity is a fact about the cluster, not
    // about which connection asked.
    const a = new Client({ connectionString: db.adminUrl });
    const b = new Client({ connectionString: db.adminUrl });
    await a.connect();
    await b.connect();
    try {
      const ra = await a.query('SELECT system_identifier::text AS id FROM pg_control_system()');
      const rb = await b.query('SELECT system_identifier::text AS id FROM pg_control_system()');
      expect(ra.rows[0].id).toBe(rb.rows[0].id);
      const v = classifyClusterBinding(
        { ok: true, systemIdentifier: ra.rows[0].id },
        { ok: true, systemIdentifier: rb.rows[0].id },
      );
      expect(v.ok).toBe(true);
    } finally {
      await a.end();
      await b.end();
    }
  });
});
