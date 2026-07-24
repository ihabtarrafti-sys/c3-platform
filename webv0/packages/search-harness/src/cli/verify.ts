import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUNSET_COVERAGE_SURFACES,
  assertSearchSunsetPreflight,
} from '../registry/index.js';
import { runCommand } from './common.js';
import { runHarnessRedSelfTests } from './selfTestRunner.js';
import { runH0VerificationWorkflow } from './verifyWorkflow.js';

runCommand(() => {
  const webv0Root = join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
    '..',
  );
  const harnessRoot = join(
    webv0Root,
    'packages',
    'search-harness',
  );
  const vitest = join(webv0Root, 'node_modules', 'vitest', 'vitest.mjs');
  const harnessConfig = join(harnessRoot, 'vitest.config.ts');
  return runH0VerificationWorkflow(
    {
      assertSunsetPreflight: assertSearchSunsetPreflight,
      runRedSelfTests: () => {
        runHarnessRedSelfTests({
          executablePath: process.execPath,
          vitestPath: vitest,
          configPath: harnessConfig,
          harnessRoot,
        });
      },
    },
    SUNSET_COVERAGE_SURFACES.length,
  );
});
