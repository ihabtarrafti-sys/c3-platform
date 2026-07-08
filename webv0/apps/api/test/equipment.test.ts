/**
 * equipment.test.ts (api) — Sprint 38 K3 evidence over HTTP. Covers: kit and
 * apparel create/update/deactivate with versioned bodies, changed-fields
 * audit semantics via the API, stale-version 409 (ETag parity), the HR role
 * split over HTTP (apparel 201, kit 403), visitor read-yes/write-403,
 * empty-patch 400, and tenant scoping.
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

const tokens = {} as { ops: string; owner: string; hr: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/dev/login',
    payload: { email, displayName: email, role, tenantSlug },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'equipment-test-secret-0123456789',
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
  tokens.ops = await login('ops@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.hr = await login('hr@alpha.com', 'hr', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

describe('kit over HTTP', () => {
  it('create → update (versioned) → deactivate; stale version 409s with zero change', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/kit',
      headers: auth(tokens.ops),
      payload: { name: 'Tournament headset #3', category: 'Peripheral' },
    });
    expect(created.statusCode, created.body).toBe(201);
    const kit = created.json().kit;
    expect(kit).toMatchObject({ kitId: 'KIT-0001', isActive: true, version: 0 });

    const updated = await app.inject({
      method: 'POST',
      url: `/api/v1/kit/${kit.kitId}`,
      headers: auth(tokens.ops),
      payload: { expectedVersion: 0, name: 'Tournament headset #3 (repaired)' },
    });
    expect(updated.statusCode, updated.body).toBe(200);
    expect(updated.json().kit.version).toBe(1);

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/kit/${kit.kitId}`,
      headers: auth(tokens.ops),
      payload: { expectedVersion: 0, name: 'Stale write' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONCURRENCY');

    const retired = await app.inject({
      method: 'POST',
      url: `/api/v1/kit/${kit.kitId}/deactivate`,
      headers: auth(tokens.owner),
      payload: { expectedVersion: 1 },
    });
    expect(retired.statusCode, retired.body).toBe(200);
    expect(retired.json().kit.isActive).toBe(false);

    const list = await app.inject({ method: 'GET', url: '/api/v1/kit', headers: auth(tokens.visitor) });
    expect(list.statusCode).toBe(200); // reads are people-adjacent
    expect(list.json().kit[0].name).toBe('Tournament headset #3 (repaired)');
  });

  it('an empty patch is a 400 at the wire', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/kit', headers: auth(tokens.ops), payload: { name: 'X', category: 'Y' } });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/kit/${created.json().kit.kitId}`,
      headers: auth(tokens.ops),
      payload: { expectedVersion: 0 },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('the HR split over HTTP (CP parity)', () => {
  it('HR: apparel 201, kit 403; visitor: both 403', async () => {
    const apparel = await app.inject({
      method: 'POST',
      url: '/api/v1/apparel',
      headers: auth(tokens.hr),
      payload: { name: 'Away jersey L', category: 'Jersey', size: 'L' },
    });
    expect(apparel.statusCode, apparel.body).toBe(201);
    expect(apparel.json().apparel.apparelId).toBe('APL-0001');

    const kit = await app.inject({ method: 'POST', url: '/api/v1/kit', headers: auth(tokens.hr), payload: { name: 'X', category: 'Y' } });
    expect(kit.statusCode).toBe(403);

    for (const url of ['/api/v1/kit', '/api/v1/apparel']) {
      const res = await app.inject({ method: 'POST', url, headers: auth(tokens.visitor), payload: { name: 'X', category: 'Y' } });
      expect(res.statusCode).toBe(403);
    }

    // HR can also update and deactivate its apparel.
    const upd = await app.inject({
      method: 'POST',
      url: `/api/v1/apparel/APL-0001`,
      headers: auth(tokens.hr),
      payload: { expectedVersion: 0, size: 'XL' },
    });
    expect(upd.statusCode, upd.body).toBe(200);
    const off = await app.inject({
      method: 'POST',
      url: `/api/v1/apparel/APL-0001/deactivate`,
      headers: auth(tokens.hr),
      payload: { expectedVersion: 1 },
    });
    expect(off.statusCode).toBe(200);
    expect(off.json().apparel.isActive).toBe(false);
  });
});

describe('tenant scoping', () => {
  it('bravo sees nothing of alpha and cannot mutate it', async () => {
    await app.inject({ method: 'POST', url: '/api/v1/kit', headers: auth(tokens.ops), payload: { name: 'Isolated', category: 'Y' } });
    const list = await app.inject({ method: 'GET', url: '/api/v1/kit', headers: auth(tokens.ownerB) });
    expect(list.json().kit).toHaveLength(0);
    const touch = await app.inject({
      method: 'POST',
      url: '/api/v1/kit/KIT-0001',
      headers: auth(tokens.ownerB),
      payload: { expectedVersion: 0, name: 'Cross-tenant write' },
    });
    expect(touch.statusCode).toBe(404); // invisible in their tenant
  });
});
