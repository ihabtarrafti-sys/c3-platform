/**
 * subscriptions.test.ts (api) — Track B: recurring subscriptions over HTTP.
 * Proves the split gate (view = finance; manage = owner/ops), the direct-audited
 * lifecycle (create → update version-guarded → cancel → reactivate), the
 * calendar renewal tie-in, and cross-tenant isolation.
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
const tokens = {} as { owner: string; ops: string; finance: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });
const get = (t: string, url: string) => app.inject({ method: 'GET', url, headers: auth(t) });
const inDays = (n: number): string => new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
const baseSub = { name: 'Adobe CC', vendorName: 'Adobe', amountMinor: 9900, currency: 'USD', cadence: 'Monthly', startedOn: '2026-01-01' };

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test', AUTH_PROVIDER: 'dev', DEV_AUTH_SECRET: 'subs-test-secret-00000000000000000',
    DATABASE_URL: db.appUrl, DATABASE_ADMIN_URL: db.adminUrl,
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
  await db.seedTenant({ slug: 'alpha', users: [
    { key: 'owner', email: 'owner@a.com', displayName: 'Owner A', role: 'owner' },
    { key: 'ops', email: 'ops@a.com', displayName: 'Ops A', role: 'operations' },
    { key: 'finance', email: 'fin@a.com', displayName: 'Fin A', role: 'finance' },
    { key: 'visitor', email: 'vis@a.com', displayName: 'Vis A', role: 'visitor' },
  ] });
  await db.seedTenant({ slug: 'bravo', users: [{ key: 'owner', email: 'owner@b.com', displayName: 'Owner B', role: 'owner' }] });
  tokens.owner = await login('owner@a.com', 'owner', 'alpha');
  tokens.ops = await login('ops@a.com', 'operations', 'alpha');
  tokens.finance = await login('fin@a.com', 'finance', 'alpha');
  tokens.visitor = await login('vis@a.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@b.com', 'owner', 'bravo');
});

describe('recurring subscriptions', () => {
  it('splits the gate: finance may VIEW but not MANAGE; visitor sees nothing', async () => {
    expect((await get(tokens.finance, '/api/v1/subscriptions')).statusCode).toBe(200);
    expect((await post(tokens.finance, '/api/v1/subscriptions', baseSub)).statusCode).toBe(403);
    expect((await get(tokens.visitor, '/api/v1/subscriptions')).statusCode).toBe(403);
    expect((await post(tokens.ops, '/api/v1/subscriptions', baseSub)).statusCode).toBe(201);
  });

  it('runs the direct-audited lifecycle: create → update (version-guarded) → cancel → reactivate', async () => {
    const created = await post(tokens.ops, '/api/v1/subscriptions', baseSub);
    const sub = created.json().subscription;
    expect(sub.subscriptionId).toMatch(/^SUB-\d{4,}$/);
    expect(sub.status).toBe('Active');

    // finance can see it
    expect((await get(tokens.finance, '/api/v1/subscriptions')).json().subscriptions).toHaveLength(1);

    // version-guarded update
    const upd = await post(tokens.ops, `/api/v1/subscriptions/${sub.subscriptionId}`, { expectedVersion: sub.version, amountMinor: 12000 });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(upd.json().subscription.amountMinor).toBe(12000);
    // stale version refused
    expect((await post(tokens.ops, `/api/v1/subscriptions/${sub.subscriptionId}`, { expectedVersion: sub.version, amountMinor: 1 })).statusCode).toBe(409);

    // cancel then reactivate
    const v = upd.json().subscription.version;
    const cancelled = await post(tokens.ops, `/api/v1/subscriptions/${sub.subscriptionId}/cancel`, { expectedVersion: v });
    expect(cancelled.json().subscription.status).toBe('Cancelled');
    const react = await post(tokens.ops, `/api/v1/subscriptions/${sub.subscriptionId}/reactivate`, { expectedVersion: cancelled.json().subscription.version });
    expect(react.json().subscription.status).toBe('Active');
  });

  it('an active subscription renewal shows on the ops calendar', async () => {
    await post(tokens.ops, '/api/v1/subscriptions', { ...baseSub, name: 'AWS', nextRenewalOn: inDays(30) });
    const cal = await get(tokens.owner, '/api/v1/calendar?horizon=90');
    const item = cal.json().items.find((i: { kind: string }) => i.kind === 'SubscriptionRenewal');
    expect(item, cal.body).toBeTruthy();
    expect(item.title).toContain('AWS renews');
    expect(item.route).toBe('/subscriptions');
  });

  it('is tenant-isolated', async () => {
    await post(tokens.ops, '/api/v1/subscriptions', baseSub);
    expect((await get(tokens.ownerB, '/api/v1/subscriptions')).json().subscriptions).toEqual([]);
  });
});
