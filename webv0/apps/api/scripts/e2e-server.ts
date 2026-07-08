/**
 * e2e-server.ts — a standalone API backed by an ephemeral embedded PostgreSQL,
 * for Playwright end-to-end runs. Seeds tenant 'alpha' and listens on
 * E2E_API_PORT (default 4100). Torn down on SIGTERM/SIGINT by Playwright.
 */
import { startTestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps } from '../src/deps';
import { buildApp } from '../src/app';

const port = process.env.E2E_API_PORT ?? '4100';
const webOrigin = process.env.E2E_WEB_ORIGIN ?? 'http://localhost:5199';

const db = await startTestDatabase();
await db.seedTenant({ slug: 'alpha', name: 'Alpha Org' });

const env = loadEnv({
  NODE_ENV: 'test',
  AUTH_PROVIDER: 'dev',
  DEV_AUTH_SECRET: 'e2e-secret-0123456789',
  DATABASE_URL: db.appUrl,
  DATABASE_ADMIN_URL: db.adminUrl,
  CORS_ORIGIN: webOrigin,
  API_PORT: port,
  LOG_LEVEL: 'error',
  // The whole Playwright suite is ONE client IP; the production default
  // (300/min) intermittently 429s mid-suite as the spec count grows. The
  // limiter has its own certification (rateLimit.test + hosted headers) —
  // E2E must not exercise it implicitly.
  RATE_LIMIT_MAX: '100000',
} as NodeJS.ProcessEnv);

const deps = buildDeps(env, createLogger(env));
const app = buildApp(deps);

const shutdown = async () => {
  try {
    await app.close();
    await deps.close();
    await db.stop();
  } finally {
    process.exit(0);
  }
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

await app.listen({ port: env.port, host: '127.0.0.1' });
// eslint-disable-next-line no-console
console.log(`[e2e-server] API listening on http://127.0.0.1:${env.port} (tenant 'alpha' seeded)`);
