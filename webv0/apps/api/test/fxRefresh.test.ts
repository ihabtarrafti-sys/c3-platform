/**
 * fxRefresh.test.ts (api) — FX auto-fetch over HTTP (Track B). The outbound
 * source is stubbed via deps.fxProvider (no network under test), so we assert
 * the parts that matter: units-per-USD is inverted to the domain's usdPerUnit
 * pivot and upserted for every supported currency; a currency the source omits
 * is SKIPPED (left as-is, never blanked); the manage gate holds (a read-only
 * role is refused); and a source outage is a clean 502, not a corrupted rate.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';
import type { FxFetchResult } from '../src/fxProvider';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;

const tokens = {} as { owner: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Swap the FX source for this test (deps is the live object the app reads). */
function stubFx(result: FxFetchResult | (() => Promise<never>)) {
  deps.fxProvider = { fetchUsdRates: typeof result === 'function' ? result : async () => result };
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'fx-refresh-test-secret-0123456789',
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
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
});

describe('FX auto-fetch over HTTP (Track B)', () => {
  it('inverts units-per-USD to the usdPerUnit pivot and upserts every supported currency', async () => {
    stubFx({ source: 'stub.example', asOf: '2026-07-12T00:00:00.000Z', unitsPerUsd: { USD: 1, AED: 3.6725, SAR: 3.75, EUR: 0.92, GBP: 0.79 } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/fx-rates/refresh', headers: auth(tokens.owner) });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.refreshed.sort()).toEqual(['AED', 'EUR', 'GBP', 'SAR']);
    expect(body.skipped).toEqual([]);
    expect(body.source).toBe('stub.example');

    // Persisted + inverted: 1/usdPerUnit(AED) ≈ 3.6725 units per USD.
    const rates = (await app.inject({ method: 'GET', url: '/api/v1/fx-rates', headers: auth(tokens.owner) })).json().rates as { currency: string; usdPerUnit: number }[];
    const aed = rates.find((r) => r.currency === 'AED')!;
    expect(Math.abs(1 / aed.usdPerUnit - 3.6725)).toBeLessThan(0.001);
    // USD is the pivot and is never written by refresh.
    expect(body.refreshed).not.toContain('USD');
  });

  it('a currency the source omits is skipped (left as-is), not blanked', async () => {
    // First a full refresh so SAR has a value…
    stubFx({ source: 's', asOf: '2026-07-12T00:00:00.000Z', unitsPerUsd: { AED: 3.6725, SAR: 3.75, EUR: 0.92, GBP: 0.79 } });
    await app.inject({ method: 'POST', url: '/api/v1/fx-rates/refresh', headers: auth(tokens.owner) });
    const before = (await app.inject({ method: 'GET', url: '/api/v1/fx-rates', headers: auth(tokens.owner) })).json().rates.find((r: { currency: string }) => r.currency === 'SAR');

    // …then a refresh whose source omits SAR: it is reported skipped + untouched.
    stubFx({ source: 's', asOf: '2026-07-12T01:00:00.000Z', unitsPerUsd: { AED: 3.7, EUR: 0.9, GBP: 0.8 } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/fx-rates/refresh', headers: auth(tokens.owner) });
    expect(res.json().skipped).toEqual(['SAR']);
    const after = (await app.inject({ method: 'GET', url: '/api/v1/fx-rates', headers: auth(tokens.owner) })).json().rates.find((r: { currency: string }) => r.currency === 'SAR');
    expect(after.usdPerUnit).toBe(before.usdPerUnit); // untouched
  });

  it('a read-only role cannot refresh (403) and never triggers the source fetch', async () => {
    let fetched = false;
    stubFx(async () => {
      fetched = true;
      throw new Error('should not be called');
    });
    const res = await app.inject({ method: 'POST', url: '/api/v1/fx-rates/refresh', headers: auth(tokens.visitor) });
    expect(res.statusCode).toBe(403);
    expect(fetched).toBe(false); // gated BEFORE the outbound call
  });

  it('a source outage is a clean 502, not a corrupted rate', async () => {
    stubFx(async () => {
      throw new Error('source down');
    });
    const res = await app.inject({ method: 'POST', url: '/api/v1/fx-rates/refresh', headers: auth(tokens.owner) });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('UPSTREAM');
  });

  it('M-17: an out-of-bounds derived rate REJECTS the whole refresh (all-or-nothing, no partial write)', async () => {
    // AED inverts to a valid rate; SAR's tiny units invert to usdPerUnit = 1e7,
    // above the domain's 1,000,000 bound — so the whole refresh is refused (400).
    stubFx({ source: 's', asOf: '2026-07-12T00:00:00.000Z', unitsPerUsd: { AED: 3.6725, SAR: 0.0000001 } });
    const res = await app.inject({ method: 'POST', url: '/api/v1/fx-rates/refresh', headers: auth(tokens.owner) });
    expect(res.statusCode, res.body).toBe(400);
    // rolled back: even the otherwise-valid AED was not written.
    const rates = (await app.inject({ method: 'GET', url: '/api/v1/fx-rates', headers: auth(tokens.owner) })).json().rates as { currency: string }[];
    expect(rates.some((r) => r.currency === 'AED')).toBe(false);
  });

  it('M-17: a present non-positive rate and a malformed source timestamp are refused', async () => {
    stubFx({ source: 's', asOf: '2026-07-12T00:00:00.000Z', unitsPerUsd: { AED: -5 } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/fx-rates/refresh', headers: auth(tokens.owner) })).statusCode).toBe(400);
    stubFx({ source: 's', asOf: 'not-a-date', unitsPerUsd: { AED: 3.6 } });
    expect((await app.inject({ method: 'POST', url: '/api/v1/fx-rates/refresh', headers: auth(tokens.owner) })).statusCode).toBe(400);
  });
});
