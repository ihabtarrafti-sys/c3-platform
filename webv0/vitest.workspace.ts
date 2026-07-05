import { defineWorkspace } from 'vitest/config';

/**
 * C3 Web V0 test workspace. Backend/domain projects run in Node. The
 * `persistence` and `api` projects provision a real PostgreSQL (via
 * embedded-postgres when DATABASE_URL is unset) and therefore run in a single
 * fork with generous timeouts. The frozen SharePoint packages are NOT part of
 * this workspace and keep their own (untouched) test tooling.
 */
export default defineWorkspace([
  {
    test: {
      name: 'domain',
      root: './packages/domain',
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'authz',
      root: './packages/authz',
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'api-contracts',
      root: './packages/api-contracts',
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'application',
      root: './packages/application',
      environment: 'node',
      include: ['test/**/*.test.ts'],
    },
  },
  {
    test: {
      name: 'persistence',
      root: './packages/persistence',
      environment: 'node',
      include: ['test/**/*.test.ts'],
      testTimeout: 60_000,
      hookTimeout: 180_000,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
  {
    test: {
      name: 'api',
      root: './apps/api',
      environment: 'node',
      include: ['test/**/*.test.ts'],
      testTimeout: 60_000,
      hookTimeout: 180_000,
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  },
]);
