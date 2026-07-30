/**
 * presenceControl.test.ts — the owner's ruling (2026-07-30): REMOVE the presence
 * control until the presence surface ships, and flip the default in BOTH places.
 *
 * WHY THE DEFAULT WAS BACKWARDS, recorded where the guard lives: 0094 carried
 * the lock-time ruling "ON by default, per-user disable" from RECEIPTS onto
 * PRESENCE. That is correct for receipts — a mutual social contract — and
 * exactly backwards for presence, which is telemetry about where a person is
 * and when they are at their desk. The standing monitoring boundary requires
 * `presence_enabled DEFAULT false` before any presence use. Today every row
 * reads *shared*, and nobody consented.
 *
 * ⚠️ THE TWO DEFAULTS ARE BOUND BY AN INVARIANT THE CODE DECLARES ABOUT ITSELF
 * (commsReceiptOps.ts): the absent-row defaults mirror the column defaults
 * EXACTLY. So the migration and the code default move as a PAIR — flipping
 * either alone silently breaks a stated law.
 *
 * House law: a guard that never failed proves nothing. Each guard below was
 * RED before its half of the fix.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;
let token = '';
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

const webv0 = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (rel: string): string => readFileSync(join(webv0, rel), 'utf8');

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'presence-ruling-secret-0123456789',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  app = buildApp(deps);
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await deps?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  await db.seedTenant({ slug: 'alpha' });
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/dev/login',
    payload: { email: 'ops@alpha.com', displayName: 'ops@alpha.com', role: 'operations', tenantSlug: 'alpha' },
  });
  token = (res.json() as { token: string }).token;
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant WHERE slug = 'alpha'
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
  );
});

const getPrefs = () => app.inject({ method: 'GET', url: '/api/v1/comms/prefs', headers: auth(token) });
const setPrefs = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/v1/comms/prefs', headers: auth(token), payload: body });

describe('GUARD 1 — the absent-row default (the one that governs TODAY)', () => {
  it('a user with NO preference row is served presenceEnabled: false', async () => {
    // ⚠️ This is the default that actually reaches users: the insert passes
    // explicit values, so the COLUMN default is never exercised on the app
    // path. RED before commsReceiptOps changed (it returned true).
    const res = await getPrefs();
    expect(res.statusCode, res.body).toBe(200);
    const prefs = res.json() as { presenceEnabled: boolean; receiptsEnabled: boolean };
    expect(prefs.presenceEnabled).toBe(false);
    // …and receipts are UNTOUCHED by this ruling: still ON by default, because
    // a mutual social contract is not telemetry.
    expect(prefs.receiptsEnabled).toBe(true);
  });
});

describe('GUARD 2 — the column default (the pair-half in SQL)', () => {
  it('information_schema reports presence_enabled DEFAULT false', async () => {
    const rows = await db.adminQuery<{ column_default: string | null }>(
      `SELECT column_default FROM information_schema.columns
        WHERE table_name = 'comms_user_preference' AND column_name = 'presence_enabled'`,
    );
    expect(rows[0]?.column_default).toMatch(/false/i);
  });

  it('receipts and the sound prefs keep THEIR defaults — the migration touched only presence', async () => {
    const rows = await db.adminQuery<{ column_name: string; column_default: string | null }>(
      `SELECT column_name, column_default FROM information_schema.columns
        WHERE table_name = 'comms_user_preference'
          AND column_name IN ('receipts_enabled','sound_direct_enabled','sound_thread_enabled')`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r.column_default ?? '']));
    expect(byName.receipts_enabled).toMatch(/true/i);
    expect(byName.sound_direct_enabled).toMatch(/true/i);
    expect(byName.sound_thread_enabled).toMatch(/false/i);
  });
});

describe('GUARD 3 — the control is GONE from the surface', () => {
  it('no presence toggle is emitted, and the receipts toggle STAYS', () => {
    const page = read('apps/web/src/pages/MissionCommsPage.tsx');
    expect(page).not.toMatch(/Presence:\s*\{/);
    expect(page).not.toMatch(/onTogglePrefs\(\{\s*presenceEnabled/);
    // The receipts control is explicitly kept — this ruling removed one button.
    expect(page).toContain('My read receipts:');
  });

  it('the FIELD stays on the wire — removing it would be a BREAKING v1 change for a field we intend to use again', () => {
    expect(read('packages/api-contracts/src/index.ts')).toContain('presenceEnabled: z.boolean()');
  });
});

describe('GUARD 4 — receipts are NOT in this state (do not touch them)', () => {
  it('the receipts contract still governs something real: the watermark predicate is intact', () => {
    // Receipts are enforced in SQL at the READ path with the anti-retroactive
    // watermark. That is the difference between a live contract and an inert
    // control, and it is why this ruling left receipts alone.
    const stores = read('packages/persistence/src/stores.ts');
    expect(stores).toContain('receipts_enabled_since');
    expect(read('packages/application/src/usecases/commsReceiptOps.ts')).toContain('stampReceiptsSince');
  });
});

describe('GUARD 5 — the pass-through: a REMOVED control must not start writing a value', () => {
  it('a receipts-only write leaves the stored presence value untouched', async () => {
    // Establish a row whose presence value is the OPPOSITE of the new default,
    // so a regression that "helpfully" writes the default would be visible.
    const first = await setPrefs({ receiptsEnabled: true, presenceEnabled: true, expectedVersion: null });
    expect(first.statusCode, first.body).toBe(200);
    const before = await db.adminQuery<{ presence_enabled: boolean }>(
      `SELECT presence_enabled FROM comms_user_preference`,
    );
    expect(before[0]?.presence_enabled).toBe(true);

    // The shape the page sends once the button is gone: the receipts value
    // changes, the presence value is passed through from what was read.
    const current = (await getPrefs()).json() as { presenceEnabled: boolean; version: number };
    const write = await setPrefs({
      receiptsEnabled: false,
      presenceEnabled: current.presenceEnabled,
      expectedVersion: current.version,
    });
    expect(write.statusCode, write.body).toBe(200);

    const after = await db.adminQuery<{ presence_enabled: boolean; receipts_enabled: boolean }>(
      `SELECT presence_enabled, receipts_enabled FROM comms_user_preference`,
    );
    expect(after[0]?.presence_enabled, 'presence must survive a receipts-only write').toBe(true);
    expect(after[0]?.receipts_enabled).toBe(false);
  });

  it('an explicit stored choice survives the read path unchanged (the value is served, not the default)', async () => {
    await setPrefs({ receiptsEnabled: true, presenceEnabled: true, expectedVersion: null });
    const prefs = (await getPrefs()).json() as { presenceEnabled: boolean };
    // A stored `true` is still reported as true — the flip changed the DEFAULT,
    // not the storage, and a person's recorded choice is not overwritten by it.
    expect(prefs.presenceEnabled).toBe(true);
  });
});
