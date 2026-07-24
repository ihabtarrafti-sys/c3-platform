import { defineConfig } from 'vitest/config';

/**
 * Explicit root config used together with vitest.workspace.ts. Commands pin
 * both paths so alternate auto-discovered config/workspace files cannot narrow
 * the executed project set.
 */
export default defineConfig({
  test: {
    passWithNoTests: false,
  },
});
