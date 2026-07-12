/**
 * savedViews.test.ts (api) — personal saved views over HTTP (Track B). Covers
 * the lifecycle (create → list → rename/re-save → soft remove → gone), and the
 * invariants that make them safe: OWNER isolation (a second user in the same
 * tenant never sees or can touch the first's views), TENANT isolation, register
 * scoping, the one-active-name-per-register conflict (409), the opaque-state
 * round-trip + size ceiling (400), and that ANY authenticated role — including
 * a read-only one — may keep its own views (no capability gate).
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

const tokens = {} as { opsA: string; opsB: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });
const get = (t: string, url: string) => app.inject({ method: 'GET', url, headers: auth(t) });

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'saved-views-test-secret-0123456789',
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
  await db.seedTenant({ slug: 'bravo' });
  tokens.opsA = await login('a@alpha.com', 'operations', 'alpha');
  tokens.opsB = await login('b@alpha.com', 'operations', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

const STATE = { q: 'lol', team: 'LoL', status: 'active', sort: 'name' };

describe('saved views over HTTP (Track B)', () => {
  it('create → list → rename/re-save → remove; owner + tenant isolation, register scope, conflict', async () => {
    // Create a people view.
    const created = await post(tokens.opsA, '/api/v1/saved-views', { register: 'people', name: 'LoL roster', state: STATE });
    expect(created.statusCode, created.body).toBe(201);
    const view = created.json().view;
    expect(view).toMatchObject({ register: 'people', name: 'LoL roster', state: STATE });
    expect(typeof view.id).toBe('string');
    const id = view.id as string;

    // It lists for its owner + register — and the opaque state round-trips.
    const mine = await get(tokens.opsA, '/api/v1/saved-views?register=people');
    expect(mine.json().views).toHaveLength(1);
    expect(mine.json().views[0].state).toEqual(STATE);

    // Register scoping: not visible under another register.
    expect((await get(tokens.opsA, '/api/v1/saved-views?register=agreements')).json().views).toHaveLength(0);

    // OWNER isolation: a second user in the SAME tenant sees nothing…
    expect((await get(tokens.opsB, '/api/v1/saved-views?register=people')).json().views).toHaveLength(0);
    // …and cannot rename or remove the first user's view (404, not 403 — it
    // simply does not exist for them).
    expect((await post(tokens.opsB, `/api/v1/saved-views/${id}`, { name: 'hijack' })).statusCode).toBe(404);
    expect((await post(tokens.opsB, `/api/v1/saved-views/${id}/remove`)).statusCode).toBe(404);

    // TENANT isolation: bravo reaches nothing.
    expect((await post(tokens.ownerB, `/api/v1/saved-views/${id}/remove`)).statusCode).toBe(404);

    // The one-active-name-per-register conflict (409).
    const dup = await post(tokens.opsA, '/api/v1/saved-views', { register: 'people', name: 'LoL roster', state: STATE });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('CONFLICT');

    // Rename + re-save state (last-write-wins, version bumps).
    const newState = { ...STATE, q: 'valorant' };
    const upd = await post(tokens.opsA, `/api/v1/saved-views/${id}`, { name: 'Valorant roster', state: newState });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(upd.json().view).toMatchObject({ name: 'Valorant roster', state: newState });
    expect(upd.json().view.version).toBeGreaterThan(view.version);

    // Freed name: another view may now take the old name.
    expect((await post(tokens.opsA, '/api/v1/saved-views', { register: 'people', name: 'LoL roster', state: STATE })).statusCode).toBe(201);

    // Soft remove: the view disappears from the list; a second remove 404s.
    expect((await post(tokens.opsA, `/api/v1/saved-views/${id}/remove`)).statusCode).toBe(200);
    const after = await get(tokens.opsA, '/api/v1/saved-views?register=people');
    expect(after.json().views.map((v: { id: string }) => v.id)).not.toContain(id);
    expect((await post(tokens.opsA, `/api/v1/saved-views/${id}/remove`)).statusCode).toBe(404);
  });

  it('any authenticated role keeps its own views — even read-only (no capability gate)', async () => {
    const res = await post(tokens.visitor, '/api/v1/saved-views', { register: 'people', name: 'My people', state: STATE });
    expect(res.statusCode, res.body).toBe(201);
    expect((await get(tokens.visitor, '/api/v1/saved-views?register=people')).json().views).toHaveLength(1);
  });

  it('bounds the opaque state (oversized → 400) and rejects an unknown register', async () => {
    const huge = { blob: 'x'.repeat(5000) };
    expect((await post(tokens.opsA, '/api/v1/saved-views', { register: 'people', name: 'big', state: huge })).statusCode).toBe(400);
    expect((await post(tokens.opsA, '/api/v1/saved-views', { register: 'nonsense', name: 'x', state: STATE })).statusCode).toBe(400);
    expect((await get(tokens.opsA, '/api/v1/saved-views?register=nonsense')).statusCode).toBe(400);
  });
});
