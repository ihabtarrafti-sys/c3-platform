/**
 * contract.test.ts (api) — S-03: the FROZEN v1 contract, enforced in the gate.
 *
 * Rebuilds the canonical route contract from the live route table (no DB —
 * the same bootstrap as the OpenAPI generator) and demands byte-equality with
 * the COMMITTED artifact apps/api/contract/v1.json. Any drift fails with a
 * classification: breaking changes (removed routes, removed/retyped served
 * fields) are refused by the standing law — incompatible semantics take
 * /api/v2; additive growth is legal after a deliberate regeneration
 * (npm run contract -w @c3web/api) reviewed in the diff.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';
import { buildContract, diffContracts, type ApiContract, type CollectedRoute } from '../src/contractShape';

let deps: Deps;
let app: FastifyInstance;
const collected: CollectedRoute[] = [];

beforeAll(async () => {
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'contract-test-secret-000000000000',
    DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
    DATABASE_ADMIN_URL: 'postgres://unused:unused@localhost:5432/unused',
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  deps.routeCollector = (r) => collected.push(r);
  app = buildApp(deps);
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await deps?.close();
});

describe('S-03 — the frozen /api/v1 contract', () => {
  it('the live route table matches the committed artifact EXACTLY (any drift is classified)', () => {
    const committedPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'contract', 'v1.json');
    const committed = JSON.parse(readFileSync(committedPath, 'utf8')) as ApiContract;
    const generated = buildContract(collected);

    if (JSON.stringify(committed) !== JSON.stringify(generated)) {
      const diff = diffContracts(committed, generated);
      const lines = [
        ...diff.breaking.map((l) => `  BREAKING  ${l}`),
        ...diff.additive.map((l) => `  additive  ${l}`),
        ...diff.changed.map((l) => `  changed   ${l}`),
      ];
      expect.fail(
        `The API surface drifted from the committed v1 contract:\n${lines.join('\n') || '  (structural difference)'}\n\n` +
          (diff.breaking.length > 0
            ? 'BREAKING changes are refused by the v1 freeze — served fields/routes never vanish; use /api/v2.\n'
            : '') +
          'If this change is deliberate, regenerate the artifact (npm run contract -w @c3web/api) and review its diff.',
      );
    }
    expect(generated.routes.length).toBeGreaterThan(50); // the surface is real, not an empty accident
  });

  it('the classifier enforces the law: removals/retypes are BREAKING, growth is additive', () => {
    const base: ApiContract = {
      schema: 'c3-api-contract/1',
      law: 'x',
      routes: [
        {
          method: 'GET',
          url: '/api/v1/things',
          response: { '200': { t: 'object', keys: { id: { t: 'string' }, name: { t: 'string' } } } },
        },
      ],
    };
    const clone = (c: ApiContract): ApiContract => JSON.parse(JSON.stringify(c));

    // removed route → breaking
    expect(diffContracts(base, { ...clone(base), routes: [] }).breaking[0]).toMatch(/route REMOVED/);

    // removed served field → breaking
    const dropped = clone(base);
    delete (dropped.routes[0]!.response!['200'] as { t: 'object'; keys: Record<string, unknown> }).keys.name;
    expect(diffContracts(base, dropped).breaking[0]).toMatch(/REMOVED\/RETYPED/);

    // retyped served field → breaking
    const retyped = clone(base);
    (retyped.routes[0]!.response!['200'] as { t: 'object'; keys: Record<string, { t: string }> }).keys.name = { t: 'number' };
    expect(diffContracts(base, retyped).breaking[0]).toMatch(/REMOVED\/RETYPED/);

    // new field + new route → additive, never breaking
    const grown = clone(base);
    (grown.routes[0]!.response!['200'] as { t: 'object'; keys: Record<string, { t: string }> }).keys.extra = { t: 'string' };
    grown.routes.push({ method: 'GET', url: '/api/v1/more', response: { '200': { t: 'object', keys: {} } } });
    const d = diffContracts(base, grown);
    expect(d.breaking).toEqual([]);
    expect(d.additive.length).toBe(2);
  });

  it('every /api/v1 route declares a response contract (no undocumented surface)', () => {
    const generated = buildContract(collected);
    const undocumented = generated.routes.filter(
      (r) => r.url.startsWith('/api/v1') && !r.url.includes('/content') && !r.url.includes('/pdf') && !r.url.includes('bank-form') && !r.url.includes('/export') && !r.url.includes('/imports') && !r.url.includes('/documents') && !r.url.includes('/uploads/') && !r.url.includes('payroll-export') && !r.url.includes('/photo') && (!r.response || Object.keys(r.response).length === 0),
    );
    expect(undocumented.map((r) => `${r.method} ${r.url}`)).toEqual([]);
  });
});
