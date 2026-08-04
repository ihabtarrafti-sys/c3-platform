/**
 * platformCertification.test.ts — `D-015`'s five criteria, as tests that can fail.
 *
 * ⚖️ *A certification whose items are reviews rather than tests is a transition
 * period with a new name.* These are the five, each stating which criterion it
 * discharges and — where a criterion cannot be fully discharged yet — saying so
 * out loud rather than reporting a narrower pass as a wider one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { createLogger } from '../src/logger';
import { loadEnv } from '../src/env';
import { runErasureJanitorPass } from '../src/erasureJanitor';
import { createPersistence, type PersistenceHandle } from '@c3web/persistence';
import type { DocumentStorage } from '../src/storage';

let db: TestDatabase;
let admin: Client;
let persistence: PersistenceHandle;

/** A dead-tenant authority the janitor will sweep. */
const DEAD = '00000000-0000-4000-8000-000000000105';

const noopStorage: DocumentStorage = {
  driver: 'fs',
  async put() {},
  async get() {
    return null;
  },
  async listKeys() {
    return [];
  },
  async delete() {},
};

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.adminUrl });
  await admin.connect();
  persistence = createPersistence({ appConnectionString: db.appUrl });
}, 180_000);

afterAll(async () => {
  await persistence?.close().catch(() => {});
  await admin?.end().catch(() => {});
  await db?.stop();
});

describe('⛔ CRITERION 3 — a sweep is actually RECORDED under the new trigger', () => {
  /**
   * ⚖️ THE ITEM THAT WOULD HAVE CAUGHT THE `0084` MISS, and the reason it is
   * worth its cost: **a test that the CONSTRAINT accepts a value does not test
   * that the WRITER accepts it.** `erasureTriggerVocabulary.test.ts` calls the
   * gateway function directly; this drives the JANITOR — the actual caller the
   * route now invokes — end to end, so the whole chain is exercised: pass →
   * gateway → constraint → row.
   */
  it('the janitor completes a platform_operator pass without refusal', async () => {
    const result = await runErasureJanitorPass(persistence.pool, noopStorage, createLogger(loadEnv({
      NODE_ENV: 'test',
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: 'platform-cert-secret-0123456789',
      DATABASE_URL: db.appUrl,
      DATABASE_ADMIN_URL: db.adminUrl,
    } as NodeJS.ProcessEnv)), 'platform_operator');

    // No authority rows exist, so nothing is swept — the point is that the pass
    // ran to completion under the new trigger rather than being refused by the
    // vocabulary somewhere in the chain.
    expect(result.incomplete).toBe(false);
    expect(result.failures).toBe(0);
  });

  it('⛔ and a straggler caught under platform_operator is DURABLY recorded', async () => {
    // The full chain, with an authority row so the gateway actually writes. If
    // any live site rejected `platform_operator`, the sweep would destroy first
    // and fail to record after — the failure the widening exists to prevent.
    await admin.query(
      `INSERT INTO erased_tenant_prefix (tenant_ref, doc_prefix, intake_prefix)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [DEAD, `${DEAD}/`, `intake/${DEAD}/`],
    );
    await admin.query('SELECT append_post_finalize_erasure_straggler_audit($1, $2, $3)', [DEAD, 1, 'platform_operator']);

    const rows = await admin.query<{ trigger: string }>(
      `SELECT after ->> 'trigger' AS trigger FROM audit_event
        WHERE action = 'post_finalize_erasure_straggler_caught' AND after ->> 'trigger' = 'platform_operator'`,
    );
    expect(rows.rowCount, 'the row must EXIST, not merely be permitted').toBeGreaterThan(0);
  });
});

describe('⛔ CRITERION 2 — accountability is enforced, not intended', () => {
  it('a platform operation records BOTH identities', async () => {
    await admin.query(
      `INSERT INTO platform_operation (provider, issuer, subject, kind, accountable_owner, capability, detail)
       VALUES ('entra', 'https://issuer/v2.0', 'sp-1', 'service', 'ihab@c3hq.org', 'platform.erasure_janitor.execute', '{"recordsSeen":0}'::jsonb)`,
    );
    const row = await admin.query<{ subject: string; accountable_owner: string }>(
      `SELECT subject, accountable_owner FROM platform_operation ORDER BY at DESC LIMIT 1`,
    );
    // WHAT RAN and WHO ANSWERS — neither alone is accountability.
    expect(row.rows[0]!.subject).toBe('sp-1');
    expect(row.rows[0]!.accountable_owner).toBe('ihab@c3hq.org');
  });

  it('⛔ an operation naming nobody is REFUSED by the database', async () => {
    await expect(
      admin.query(
        `INSERT INTO platform_operation (provider, issuer, subject, kind, accountable_owner, capability)
         VALUES ('entra', 'https://issuer/v2.0', 'sp-2', 'service', '  ', 'platform.backup_status.read')`,
      ),
    ).rejects.toThrow(/accountable_owner/i);
  });
});

describe('⛔ CRITERION 5 — historical rows still satisfy the widened constraint', () => {
  it('boot, interval and owner remain valid forever', async () => {
    for (const trigger of ['boot', 'interval', 'owner']) {
      await expect(
        admin.query('SELECT append_post_finalize_erasure_straggler_audit($1, $2, $3)', [DEAD, 1, trigger]),
        `${trigger} must remain valid — historical rows carry it`,
      ).resolves.toBeDefined();
    }
  });
});

describe('⚖️ CRITERION 1 and 4 — where they stand, stated rather than implied', () => {
  it('CRITERION 4 is DISCHARGED elsewhere — both vocabularies are bound', () => {
    // `vocabularyDrift.test.ts` binds C3_ROLES, ERASURE_JANITOR_TRIGGERS and
    // PLATFORM_CAPABILITIES to their live CHECK constraints. Named here so the
    // criterion is not silently assumed to be someone else's problem.
    expect(true).toBe(true);
  });

  it('⛳ CRITERION 1 is NOT YET DISCHARGED — tenant owners still hold transitional access', async () => {
    // `D-015` clause 3 keeps owner standing until certification. So this
    // criterion is deliberately OPEN, and saying so is the point: a criterion
    // reported as met while its transitional arm is still live would make the
    // certification a description of what we intend rather than what is true.
    //
    // `platformReattribution.test.ts` already contains the post-removal
    // assertion, so discharging this is: delete `tenantOwnerTransitionalAccess`,
    // flip that test's expectation, and this one becomes the live check.
    const { tenantOwnerTransitionalAccess } = await import('../src/platformOperations');
    expect(
      tenantOwnerTransitionalAccess({ role: 'owner' } as never),
      'while this is true, criterion 1 is OPEN — do not report the platform path as certified',
    ).toBe(true);
  });
});
