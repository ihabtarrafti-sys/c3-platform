/**
 * server.ts — the API entrypoint. Loads .env (if present), validates the
 * environment (fail-closed), wires dependencies, and starts listening. Shuts
 * down gracefully.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from './env';
import { createLogger } from './logger';
import { buildDeps } from './deps';
import { buildApp } from './app';
import { createErasureJanitorScheduler } from './erasureJanitor';

function loadDotenvIfPresent(): void {
  const path = join(process.cwd(), '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let value = m[2]!;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotenvIfPresent();
  const env = loadEnv();
  const logger = createLogger(env);
  const deps = buildDeps(env, logger);
  const app = buildApp(deps);
  const janitorScheduler = createErasureJanitorScheduler(deps.erasureJanitor, logger, {
    bootReadinessBudgetMs: env.erasureJanitorBootReadinessBudgetMs,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    await janitorScheduler.close();
    await app.close();
    await deps.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // J′/H6: start the safety pass before accepting traffic. Readiness waits only
  // its configured budget; an over-budget pass remains observed and continues
  // in the background. The daily-or-faster cadence remains armed until shutdown.
  await janitorScheduler.start();
  await app.listen({ port: env.port, host: '0.0.0.0' });
  logger.info({ port: env.port, authProvider: env.authProvider }, 'C3 Web V0 API listening');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
