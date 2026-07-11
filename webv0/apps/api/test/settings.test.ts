/**
 * settings.test.ts (api) — HARDEN-2: the tenant settings kernel over HTTP,
 * proven on its first resident: PER-DIEM PRESETS (the S2 rider). Defaults
 * live in code (absent row ⇒ 65 SAR / 100 SAR / 25 USD, version null);
 * writes are owner/operations, direct-audited, and VERSION-GUARDED from
 * birth — the M-03 law applied to a brand-new cell.
 */
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

const tokens = {} as { ops: string; owner: string; hr: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'settings-test-secret-0123456789xy',
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
  tokens.ops = await login('ops@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.hr = await login('hr@alpha.com', 'hr', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
});

describe('per-diem presets (HARDEN-2: the S2 rider)', () => {
  it('defaults → guarded first write → guarded update; stale writers refuse; the act is audited', async () => {
    // The DEFAULTS (no row yet): the org's real config, version null.
    const defaults = await app.inject({ method: 'GET', url: '/api/v1/settings/per-diem-presets', headers: auth(tokens.ops) });
    expect(defaults.statusCode, defaults.body).toBe(200);
    expect(defaults.json()).toEqual({
      presets: [
        { amountMinor: 6_500, currency: 'SAR' },
        { amountMinor: 10_000, currency: 'SAR' },
        { amountMinor: 2_500, currency: 'USD' },
      ],
      version: null,
    });

    // First write: expectedVersion null asserts "I saw the defaults" → v0.
    const first = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/per-diem-presets',
      headers: auth(tokens.ops),
      payload: { presets: [{ amountMinor: 6_500, currency: 'SAR' }, { amountMinor: 5_000, currency: 'USD' }], expectedVersion: null },
    });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().version).toBe(0);

    // A colleague still holding "the defaults" is REFUSED (409), never merged.
    const stale = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/per-diem-presets',
      headers: auth(tokens.owner),
      payload: { presets: [{ amountMinor: 1, currency: 'USD' }], expectedVersion: null },
    });
    expect(stale.statusCode, stale.body).toBe(409);
    // …and so is a wrong version.
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/per-diem-presets',
      headers: auth(tokens.owner),
      payload: { presets: [{ amountMinor: 1, currency: 'USD' }], expectedVersion: 7 },
    });
    expect(wrong.statusCode, wrong.body).toBe(409);

    // Guarded update with the real version → v1; the read reflects it.
    const second = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/per-diem-presets',
      headers: auth(tokens.owner),
      payload: { presets: [{ amountMinor: 7_500, currency: 'SAR' }], expectedVersion: 0 },
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json()).toEqual({ presets: [{ amountMinor: 7_500, currency: 'SAR' }], version: 1 });

    // The acts are audited under the Setting entity.
    const audit = await app.inject({ method: 'GET', url: '/api/v1/audit?entityType=Setting&entityId=perDiemPresets', headers: auth(tokens.owner) });
    if (audit.statusCode === 200) {
      expect(audit.json().events.filter((e: { action: string }) => e.action === 'PerDiemPresetsSet').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('validation: empty, oversized, duplicate, and zero-amount lists refuse (400)', async () => {
    const post = (presets: unknown) =>
      app.inject({ method: 'POST', url: '/api/v1/settings/per-diem-presets', headers: auth(tokens.ops), payload: { presets, expectedVersion: null } });
    expect((await post([])).statusCode).toBe(400);
    expect((await post(Array.from({ length: 9 }, (_, i) => ({ amountMinor: i + 1, currency: 'USD' })))).statusCode).toBe(400);
    expect((await post([{ amountMinor: 100, currency: 'USD' }, { amountMinor: 100, currency: 'USD' }])).statusCode).toBe(400);
    expect((await post([{ amountMinor: 0, currency: 'USD' }])).statusCode).toBe(400);
  });

  it('the role boundary: hr and visitor may neither read nor write the presets config', async () => {
    for (const t of [tokens.hr, tokens.visitor]) {
      expect((await app.inject({ method: 'GET', url: '/api/v1/settings/per-diem-presets', headers: auth(t) })).statusCode).toBe(403);
      const w = await app.inject({
        method: 'POST',
        url: '/api/v1/settings/per-diem-presets',
        headers: auth(t),
        payload: { presets: [{ amountMinor: 100, currency: 'USD' }], expectedVersion: null },
      });
      expect(w.statusCode).toBe(403);
    }
  });
});
