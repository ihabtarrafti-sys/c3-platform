/**
 * openapiParity.test.ts (api) — NEO-OAS-01: the committed OpenAPI artifact
 * must be SEMANTICALLY IDENTICAL to the document the live route schemas
 * generate (disclosure chapter Block 3; instance 25).
 *
 * The defect this seals: the generator writes openapi.{json,yaml} only when
 * invoked, and nothing verified the committed artifact — it had silently
 * fallen 60 non-hidden operations behind the live contract, making the spec
 * read as complete when it was not. This test builds the swagger document
 * IN MEMORY from the same zod route schemas the runtime enforces (no DB
 * connection — the generator's own trick) and compares semantic JSON with
 * the committed file. It never writes an artifact (per the ruling: the audit
 * must not mutate what it audits) — on drift it fails with the operation
 * delta and names `npm run openapi` as the remedy.
 *
 * RED-proven: written BEFORE the regeneration, this failed against the stale
 * committed artifact with the 60-operation delta; green after `npm run
 * openapi` refreshed it. YAML is deliberately NOT semantically compared here
 * (serialization noise must not weaken the JSON parity decision, per the
 * disposition); it is regenerated alongside and staleness in it shows up as
 * a git diff at the next regeneration.
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

let deps: Deps;
let app: FastifyInstance;

beforeAll(async () => {
  // The generator's own no-DB trick: the app builds and readies without a
  // database connection; only route registration matters here.
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'openapi-parity-check-000000000000',
    DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
    DATABASE_ADMIN_URL: 'postgres://unused:unused@localhost:5432/unused',
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  app = buildApp(deps);
  await app.ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await deps?.close();
});

const apiDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** method/path pairs of every operation in an OpenAPI document. */
function operations(doc: { paths?: Record<string, Record<string, unknown>> }): string[] {
  const out: string[] = [];
  for (const [path, methods] of Object.entries(doc.paths ?? {})) {
    for (const method of Object.keys(methods)) out.push(`${method.toUpperCase()} ${path}`);
  }
  return out.sort();
}

describe('NEO-OAS-01 — committed OpenAPI parity with the live route schemas', () => {
  it('the committed openapi.json is semantically identical to the generated document', () => {
    const live = JSON.parse(JSON.stringify(app.swagger())) as Record<string, unknown>;
    const committed = JSON.parse(readFileSync(join(apiDir, 'openapi.json'), 'utf8')) as Record<string, unknown>;

    // The operation delta FIRST — on drift this names exactly what is missing
    // or extra, which is the actionable failure (instance 25 was 60 missing
    // operations reading as a complete spec).
    const liveOps = operations(live as never);
    const committedOps = operations(committed as never);
    const missing = liveOps.filter((o) => !committedOps.includes(o));
    const extra = committedOps.filter((o) => !liveOps.includes(o));
    expect(missing, `committed OpenAPI is MISSING live operations — run \`npm run openapi\` and commit the result`).toEqual([]);
    expect(extra, `committed OpenAPI carries operations the live app does not serve`).toEqual([]);

    // POSITIVE CONTROL on the instrument: the live document is not degenerate.
    expect(liveOps.length).toBeGreaterThan(100);

    // Then FULL semantic parity — schemas, parameters, everything. Serialized
    // through JSON on both sides so only semantic content compares.
    expect(live, 'openapi.json drifted from the live route schemas — run `npm run openapi` and commit the result').toEqual(committed);
  });
});
