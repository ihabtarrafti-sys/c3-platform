/**
 * activity.test.ts (api) — Track B3: the activity feed over HTTP. Proves the
 * feed projects the audit stream newest-first, paginates by keyset cursor, and
 * is owner/operations only.
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
const tokens = {} as { ops: string; owner: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });
const get = (t: string, url: string) => app.inject({ method: 'GET', url, headers: auth(t) });

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'activity-test-secret-0000000000000',
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
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
});

describe('Track B3 — activity feed', () => {
  it('projects the audit stream newest-first with human headlines, and keyset-paginates', async () => {
    // Generate a handful of audited actions (entity create + a couple of edits).
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const ent = await post(tokens.ops, '/api/v1/entities', { name: `Co ${i}`, code: `C${i}`, jurisdiction: 'UAE', localCurrency: 'AED' });
      expect(ent.statusCode, ent.body).toBe(201);
      created.push(ent.json().entity.entityId);
    }

    const page1 = (await get(tokens.owner, '/api/v1/activity?limit=3')).json();
    expect(page1.items.length).toBe(3);
    expect(page1.nextCursor).toBeTruthy();
    // newest first: the last entity created leads
    expect(page1.items[0]).toMatchObject({ entityType: 'Entity', headline: 'Entity created', actor: 'ops@alpha.com' });
    // strictly descending timestamps
    for (let i = 1; i < page1.items.length; i++) {
      expect(page1.items[i - 1].at >= page1.items[i].at).toBe(true);
    }

    const page2 = (await get(tokens.owner, `/api/v1/activity?limit=3&cursor=${encodeURIComponent(page1.nextCursor)}`)).json();
    expect(page2.items.length).toBeGreaterThanOrEqual(2);
    // no overlap between the pages
    const ids1 = new Set(page1.items.map((i: { id: string }) => i.id));
    expect(page2.items.some((i: { id: string }) => ids1.has(i.id))).toBe(false);
  });

  it('is owner/operations only', async () => {
    expect((await get(tokens.visitor, '/api/v1/activity')).statusCode).toBe(403);
    expect((await get(tokens.ops, '/api/v1/activity')).statusCode).toBe(200);
    expect((await get(tokens.owner, '/api/v1/activity')).statusCode).toBe(200);
  });
});
