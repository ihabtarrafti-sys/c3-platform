import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import workspaceDefinition from '../vitest.workspace.js';
import {
  TEST_PROJECT_PLANS,
  assertVitestProjectReconciliation,
  configuredVitestProjectNames,
  executedVitestProjectNames,
  type VitestTestMode,
} from './vitestProjects.js';

const webv0Root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsx = join(webv0Root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const vitest = join(webv0Root, 'node_modules', 'vitest', 'vitest.mjs');
const rootConfig = join(webv0Root, 'vitest.config.ts');
const workspace = join(webv0Root, 'vitest.workspace.ts');
const sunsetPreflight = join(
  webv0Root,
  'packages',
  'search-harness',
  'src',
  'cli',
  'sunsetPreflight.ts',
);
const harnessVerify = join(
  webv0Root,
  'packages',
  'search-harness',
  'src',
  'cli',
  'verify.ts',
);

const configuredProjects = configuredVitestProjectNames(workspaceDefinition);
for (const [plannedMode, plannedExecution] of Object.entries(
  TEST_PROJECT_PLANS,
)) {
  assertVitestProjectReconciliation({
    context: `webv0 test mode ${plannedMode}`,
    configuredProjects,
    executedProjects: executedVitestProjectNames(plannedExecution),
    deliberateExclusions: plannedExecution.deliberateExclusions,
  });
}

const mode = process.argv[2] ?? 'all';
if (!Object.hasOwn(TEST_PROJECT_PLANS, mode)) {
  console.error('webv0 tests: unknown test mode');
  process.exit(2);
}
const plan = TEST_PROJECT_PLANS[mode as VitestTestMode];

function step(label: string, args: readonly string[]): void {
  console.log(`\n═══ ${label} ═══`);
  const result = spawnSync(process.execPath, [...args], {
    cwd: webv0Root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    console.error(`\nwebv0 tests FAILED at: ${label}`);
    process.exit(result.status ?? 1);
  }
}

step('search harness sunset preflight', [tsx, sunsetPreflight]);
step(`${mode} tests`, [
  vitest,
  'run',
  '--config',
  rootConfig,
  '--workspace',
  workspace,
  ...plan.workspaceVitestProjects.flatMap((project) => ['--project', project]),
]);
for (const execution of plan.dedicatedProjects) {
  if (execution.runner !== 'harness-verify') {
    throw new Error(`Unsupported dedicated Vitest runner: ${execution.runner}`);
  }
  step(execution.label, [tsx, harnessVerify]);
}
