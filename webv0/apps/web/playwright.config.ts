import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  E2E_API_ORIGIN,
  E2E_API_PORT,
  E2E_WEB_ORIGIN,
  E2E_WEB_PORT,
} from './e2e/support/ports';

const webDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(webDir, '..', '..');

/**
 * Two web servers: the API (with an embedded PostgreSQL) and the Vite dev
 * server (SPA fallback, so deep links/refresh work). A single worker keeps the
 * fresh-DB state deterministic (APR-0001 / PER-0001).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: E2E_WEB_ORIGIN, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs apps/api/scripts/e2e-server.ts',
      cwd: repoRoot,
      url: `${E2E_API_ORIGIN}/health`,
      timeout: 180_000,
      /**
       * ⛔ THE CORRECTNESS FLOOR — do not restore the `!process.env.CI` default
       * (instance 57, 2026-07-31).
       *
       * The invariant: **a test run must never silently adopt a server it did
       * not start.** With reuse enabled, an `e2e-server` that outlived its
       * Playwright parent kept listening here, and the next run skipped its own
       * startup and tested against that run's DATABASE. It did not error — it
       * reported 38/38. A green run in that state is a verification lying about
       * what it verified, and a pass is the dangerous direction.
       *
       * `false` converts silent-wrong into loud-fail. `e2e/support/preflight.ts`
       * then makes the loud failure legible — naming who holds the port — so
       * nobody learns to retry through a bare EADDRINUSE.
       */
      reuseExistingServer: false,
      env: { E2E_API_PORT: String(E2E_API_PORT), E2E_WEB_ORIGIN },
    },
    {
      command: `node node_modules/vite/bin/vite.js --port ${E2E_WEB_PORT} --strictPort`,
      cwd: webDir,
      url: E2E_WEB_ORIGIN,
      timeout: 120_000,
      reuseExistingServer: false, // see above — same invariant
      env: { VITE_API_BASE_URL: E2E_API_ORIGIN },
    },
  ],
});
