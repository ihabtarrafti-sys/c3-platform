/**
 * generate-contract.ts — S-03: (re)generate the FROZEN v1 contract artifact.
 *
 *   npm run contract -w @c3web/api            # refuses breaking changes
 *   npm run contract -w @c3web/api -- --allow-breaking   # v2 migrations only
 *
 * Builds the app (no DB connection required — same bootstrap as the OpenAPI
 * generator), collects every route's method/url/zod schemas via the S-03
 * route collector, canonicalizes them, and writes apps/api/contract/v1.json.
 * Against the existing artifact it CLASSIFIES the drift and REFUSES breaking
 * changes (removed routes, removed/retyped served fields) unless the
 * self-describing --allow-breaking flag is passed — the standing law is that
 * incompatible semantics take /api/v2, not a quiet rewrite of v1.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps } from '../src/deps';
import { buildApp } from '../src/app';
import { buildContract, diffContracts, type ApiContract, type CollectedRoute } from '../src/contractShape';

async function main(): Promise<void> {
  const allowBreaking = process.argv.includes('--allow-breaking');
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'contract-generation-only',
    DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
    DATABASE_ADMIN_URL: 'postgres://unused:unused@localhost:5432/unused',
  } as NodeJS.ProcessEnv);

  const collected: CollectedRoute[] = [];
  const deps = buildDeps(env, createLogger(env));
  deps.routeCollector = (r) => collected.push(r);
  const app = buildApp(deps);
  await app.ready();
  await app.close();
  await deps.close();

  const generated = buildContract(collected);
  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'contract');
  const outPath = join(outDir, 'v1.json');

  if (existsSync(outPath)) {
    const committed = JSON.parse(readFileSync(outPath, 'utf8')) as ApiContract;
    const diff = diffContracts(committed, generated);
    for (const line of diff.breaking) console.error(`BREAKING  ${line}`);
    for (const line of diff.additive) console.log(`additive  ${line}`);
    for (const line of diff.changed) console.log(`changed   ${line}`);
    if (diff.breaking.length > 0 && !allowBreaking) {
      console.error(
        `\nCONTRACT REFUSED: ${diff.breaking.length} BREAKING change(s) to the frozen v1 surface. ` +
          'Incompatible semantics take /api/v2. If this is a deliberate v2 migration step, rerun with --allow-breaking.',
      );
      process.exit(1);
    }
    if (diff.breaking.length === 0 && diff.additive.length === 0 && diff.changed.length === 0) {
      console.log('Contract unchanged — artifact already current.');
      return;
    }
  }

  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, JSON.stringify(generated, null, 2) + '\n', 'utf8');
  console.log(`Wrote apps/api/contract/v1.json (${generated.routes.length} routes).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
