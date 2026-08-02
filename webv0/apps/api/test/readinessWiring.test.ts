/**
 * readinessWiring.test.ts — the production outage, reproduced over a REAL
 * PostgreSQL.
 *
 * ⚖️ `readiness.test.ts` pins the CONTRACT (what the route reports). This pins
 * the WIRING — that `deps.ready()` genuinely exercises the identity credential
 * against a live database, and goes RED when that credential cannot
 * authenticate. Those are different claims, and only this one would have caught
 * the outage: `c3_auth`'s password never matched `DATABASE_AUTH_URL` from the
 * day production was built, every sign-in failed, and `/health` and `/ready`
 * stayed green throughout.
 *
 * ⛔ `/ready` HAD NO INTEGRATION TEST AT ALL BEFORE THIS FILE. That is not a
 * side note — it is part of why the gap survived: the endpoint that answers
 * "is the service working" was never itself asked.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
const built: Deps[] = [];
const apps: FastifyInstance[] = [];

function baseEnv(databaseUrl: string, adminUrl: string): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'readiness-test-secret-0123456789',
    DATABASE_URL: databaseUrl,
    DATABASE_ADMIN_URL: adminUrl,
  } as NodeJS.ProcessEnv;
}

async function appFor(databaseUrl: string, adminUrl: string): Promise<FastifyInstance> {
  const env = loadEnv(baseEnv(databaseUrl, adminUrl));
  const deps = buildDeps(env, createLogger(env));
  built.push(deps);
  const app = buildApp(deps);
  await app.ready();
  apps.push(app);
  return app;
}

/**
 * A WELL-FORMED url with the wrong password — the production shape exactly.
 * The pool is constructed lazily, so nothing fails at boot; it fails on the
 * first query, which is precisely why the API started happily and served a
 * green `/ready` while no one could sign in.
 */
function withWrongPassword(url: string): string {
  const u = new URL(url);
  u.password = 'not-the-password';
  return u.toString();
}

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  for (const app of apps) await app.close().catch(() => {});
  for (const deps of built) await deps.close().catch(() => {});
  await db?.stop();
});

describe('readiness against a real database', () => {
  it('reports ready when BOTH credentials genuinely work', async () => {
    const app = await appFor(db.appUrl, db.adminUrl);
    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ready');
    expect(body.checks).toEqual({ app: 'ok', directory: 'ok' });

    // The identity probe runs the REAL membership query, so this passing also
    // means the credential holds SELECT on all five identity tables. A revoked
    // grant on any of them fails here rather than at someone's first sign-in.
    expect(body.unchecked.length, 'the gap must be stated, not implied').toBeGreaterThan(0);
  });

  it('⛔ goes 503 when the IDENTITY credential cannot authenticate — the outage', async () => {
    // THE REPRODUCTION. App pool healthy, identity pool with a bad password:
    // exactly the state production was in, which the old boolean called `ready`.
    const app = await appFor(db.appUrl, withWrongPassword(db.adminUrl));
    const res = await app.inject({ method: 'GET', url: '/ready' });

    expect(res.statusCode, 'a service nobody can authenticate to is NOT ready').toBe(503);
    const body = res.json();
    expect(body.status).toBe('unavailable');
    expect(body.checks.directory).toBe('failed');

    // ⚖️ THE FALSIFICATION, ON REAL CONNECTIONS: the half that used to BE the
    // whole check is still green here. Judge on `app` alone — as the previous
    // implementation did — and this exact state returns 200 `{status:'ready'}`.
    expect(body.checks.app, 'the old check would have passed this').toBe('ok');
  });

  it('⛔ still discloses nothing on a real failure — the driver text stays in the log', async () => {
    // The pg error says `password authentication failed for user "..."`. That is
    // for the operator, via the log. This route is public and unauthenticated.
    const app = await appFor(db.appUrl, withWrongPassword(db.adminUrl));
    const raw = (await app.inject({ method: 'GET', url: '/ready' })).body;

    for (const leak of ['password', 'postgres://', 'authentication failed', '127.0.0.1']) {
      expect(raw, `must not disclose ${leak}`).not.toContain(leak);
    }
  });
});
