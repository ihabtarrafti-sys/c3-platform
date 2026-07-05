/**
 * generate-openapi.ts — build the app (no DB connection required) and emit the
 * generated OpenAPI contract to apps/api/openapi.{json,yaml}. The document is
 * generated FROM the same zod route schemas used for runtime validation, so
 * the contract and the enforcement never drift.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps } from '../src/deps';
import { buildApp } from '../src/app';

async function main(): Promise<void> {
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'openapi-generation-only',
    DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
  } as NodeJS.ProcessEnv);

  const deps = buildDeps(env, createLogger(env));
  const app = buildApp(deps);
  await app.ready();

  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const doc = app.swagger();
  writeFileSync(join(outDir, 'openapi.json'), JSON.stringify(doc, null, 2));
  const yaml = app.swagger({ yaml: true }) as unknown as string;
  writeFileSync(join(outDir, 'openapi.yaml'), yaml);

  await app.close();
  await deps.close();
  // eslint-disable-next-line no-console
  console.log('Wrote apps/api/openapi.json and openapi.yaml');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
