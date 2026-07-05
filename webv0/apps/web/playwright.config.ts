import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const webDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(webDir, '..', '..');

const API_PORT = 4100;
const WEB_PORT = 5199;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

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
  use: { baseURL: WEB_ORIGIN, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node node_modules/tsx/dist/cli.mjs apps/api/scripts/e2e-server.ts',
      cwd: repoRoot,
      url: `http://127.0.0.1:${API_PORT}/health`,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { E2E_API_PORT: String(API_PORT), E2E_WEB_ORIGIN: WEB_ORIGIN },
    },
    {
      command: `node node_modules/vite/bin/vite.js --port ${WEB_PORT} --strictPort`,
      cwd: webDir,
      url: WEB_ORIGIN,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_API_BASE_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
