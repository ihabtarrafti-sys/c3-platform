/**
 * webv0-typecheck.mts — run `tsc --noEmit` across every C3 Web V0 workspace.
 * Frozen SharePoint packages are intentionally excluded (they keep their own
 * untouched toolchain). Exits non-zero on the first failing project.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const PROJECTS = [
  'packages/domain',
  'packages/authz',
  'packages/api-contracts',
  'packages/application',
  'packages/persistence',
  'packages/test-support',
  'apps/api',
  'apps/web',
];

const tscBin = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
let failed = false;

for (const project of PROJECTS) {
  process.stdout.write(`▶ typecheck ${project} … `);
  const res = spawnSync(process.execPath, [tscBin, '--noEmit', '-p', join(repoRoot, project, 'tsconfig.json')], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (res.status === 0) {
    process.stdout.write('ok\n');
  } else {
    failed = true;
    process.stdout.write('FAIL\n');
    process.stdout.write((res.stdout || '') + (res.stderr || '') + '\n');
  }
}

if (failed) {
  console.error('\nwebv0 typecheck: FAILED');
  process.exit(1);
}
console.log('\nwebv0 typecheck: all projects passed');
