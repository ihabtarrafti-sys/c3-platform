/**
 * rateLimit.test.ts — F-1 evidence: the per-client ceiling applies to every
 * /api/v1 request INCLUDING unauthenticated 401 spam (the limiter runs at
 * onRequest, before the preValidation auth hook), returns the structured
 * envelope on 429, and exempts platform health probes. No database is touched:
 * pools are constructed lazily and the 401/429 paths never query.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

const TID = 'aaaaaaaa-1111-2222-3333-444444444444';

let deps: Deps;
let app: FastifyInstance;

beforeAll(async () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'entra',
    ENTRA_TENANT_ID: TID,
    ENTRA_ISSUER: `https://login.microsoftonline.com/${TID}/v2.0`,
    ENTRA_AUDIENCE: 'api://c3web-test',
    ENTRA_JWKS_URI: 'https://unused.example/keys',
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    DATABASE_AUTH_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    RATE_LIMIT_MAX: '3',
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  app = buildApp(deps);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await deps?.close().catch(() => {});
});

describe('F-1 rate limiting', () => {
  it('unauthenticated requests are limited: 401 up to the ceiling, then a structured 429', async () => {
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({ method: 'GET', url: '/api/v1/people' });
      expect(res.statusCode).toBe(401); // counted by the limiter, denied by auth
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
    }
    const blocked = await app.inject({ method: 'GET', url: '/api/v1/people' });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json();
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.correlationId).toBeTruthy();
  });

  it('health and readiness probes are exempt from the ceiling', async () => {
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200); // above the ceiling, never limited
    }
  });

  it('production refuses a disabled rate limit (env fail-closed)', () => {
    expect(() =>
      loadEnv({
        NODE_ENV: 'production',
        AUTH_PROVIDER: 'entra',
        ENTRA_TENANT_ID: TID,
        ENTRA_ISSUER: `https://login.microsoftonline.com/${TID}/v2.0`,
        ENTRA_AUDIENCE: 'api://c3web-test',
        ENTRA_JWKS_URI: 'https://unused.example/keys',
        CORS_ORIGIN: 'https://staging.c3hq.org',
        DATABASE_URL: 'postgres://u:u@h:5432/db',
        DATABASE_AUTH_URL: 'postgres://u:u@h:5432/db',
        RATE_LIMIT_MAX: '0',
      } as NodeJS.ProcessEnv),
    ).toThrow(/RATE_LIMIT_MAX=0/);
  });
});
