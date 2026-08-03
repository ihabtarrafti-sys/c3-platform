/**
 * erasureTriggerVocabulary.test.ts — migration 0103, proven end to end.
 *
 * ⚖️ THIS IS CERTIFICATION ITEM 3 OF `D-015`, AND IT EARNS ITS COST FOR ONE
 * REASON: **a test that the CONSTRAINT accepts a value does not test that the
 * WRITER accepts it.** The trigger vocabulary is enforced twice — the CHECK on
 * `audit_event` decides whether the row is acceptable, and the guard inside
 * `append_post_finalize_erasure_straggler_audit` decides whether the write is
 * even attempted. They are different questions.
 *
 * ⛔ THE FAILURE THIS FORECLOSES. A widening applied to the constraint alone
 * yields a janitor that DESTROYS BYTES, then raises
 * `C3E:INVALID_ERASURE_AUDIT` on its own audit write. The destruction has
 * already happened; only the record of it is lost. That is strictly worse than
 * refusing to start, and it is exactly what a site-list assembled from migration
 * TEXT would have produced — the live function guard lives in `0084`, while the
 * two obvious `0080` sites are both dead.
 *
 * ⇒ So this calls the real gateway against a real dead-tenant authority and reads
 * the row back. Nothing here inspects a definition; it exercises the path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';

let db: TestDatabase;
let admin: Client;

/** A tenant that never existed — the gateway refuses a ref that is still live. */
const DEAD = '00000000-0000-4000-8000-000000000103';

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.adminUrl });
  await admin.connect();
  await admin.query(
    `INSERT INTO erased_tenant_prefix (tenant_ref, doc_prefix, intake_prefix)
     VALUES ($1, $2, $3)`,
    [DEAD, `${DEAD}/`, `intake/${DEAD}/`],
  );
}, 180_000);

afterAll(async () => {
  await admin?.end().catch(() => {});
  await db?.stop();
});

const sweep = (trigger: string) =>
  admin.query('SELECT append_post_finalize_erasure_straggler_audit($1, $2, $3)', [DEAD, 1, trigger]);

const recordedTriggers = async (): Promise<string[]> => {
  const r = await admin.query<{ trigger: string }>(
    `SELECT after ->> 'trigger' AS trigger
       FROM audit_event
      WHERE action = 'post_finalize_erasure_straggler_caught'
      ORDER BY id`,
  );
  return r.rows.map((row) => row.trigger);
};

describe('0103 — the widened trigger vocabulary, exercised rather than inspected', () => {
  it('⛔ a sweep attributed to platform_operator COMPLETES AND IS RECORDED', async () => {
    // THE ONE THAT MATTERS. Both live sites must accept: the function to attempt
    // the write, the constraint to admit the row. A widening that reached only
    // one of them fails HERE and nowhere else.
    await expect(sweep('platform_operator')).resolves.toBeDefined();
    expect(await recordedTriggers(), 'the audit row must exist, not merely be permitted').toContain(
      'platform_operator',
    );
  });

  it('⚖️ and the three historical values remain valid — the widening was ADDITIVE', async () => {
    // `D-015` clause 1. Historical audit rows carry these; if a widening had
    // REPLACED the vocabulary the trail would stop being readable backwards,
    // losing exactly the passes nobody can re-derive.
    for (const trigger of ['boot', 'interval', 'owner']) {
      await expect(sweep(trigger), `${trigger} must remain valid forever`).resolves.toBeDefined();
    }
    const recorded = await recordedTriggers();
    for (const trigger of ['boot', 'interval', 'owner', 'platform_operator']) {
      expect(recorded).toContain(trigger);
    }
  });

  it('⛔ and the guard did NOT become permissive — an unknown trigger is still refused', async () => {
    // The widening must add a value, not remove a check. Without this, deleting
    // the IN-list entirely would satisfy every assertion above.
    await expect(sweep('sudo')).rejects.toThrow(/INVALID_ERASURE_AUDIT/);
    await expect(sweep('')).rejects.toThrow(/INVALID_ERASURE_AUDIT/);
    expect(await recordedTriggers(), 'a refused trigger must leave no row').not.toContain('sudo');
  });

  it('the refusal names the whole vocabulary, so an operator learns what IS allowed', async () => {
    // A rejection that says only "not that" makes the reader go read the
    // migration to find out what would work.
    await expect(sweep('nope')).rejects.toThrow(/boot, interval, owner, or platform_operator/);
  });
});
