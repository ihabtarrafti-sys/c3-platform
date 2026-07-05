/**
 * webv0-gate.mts — the C3 Web V0 CI gate. Typechecks every workspace, then
 * runs the full test suite (unit + DB integration + API). The DB/API projects
 * provision a real PostgreSQL via embedded-postgres when DATABASE_URL is unset,
 * so this gate is self-contained and needs no Docker.
 *
 * This gate is SEPARATE from the frozen SharePoint `npm run gate`; it never
 * touches the frozen packages.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function step(label: string, cmd: string, args: string[]): void {
  console.log(`\n═══ ${label} ═══`);
  const res = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\nwebv0 gate FAILED at: ${label}`);
    process.exit(res.status ?? 1);
  }
}

const tsx = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const vitest = join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');

step('nul/truncation audit', 'tsx', [tsx, join(repoRoot, 'scripts', 'webv0-nul-audit.mts')]);
step('typecheck', 'tsx', [tsx, join(repoRoot, 'scripts', 'webv0-typecheck.mts')]);
step('test (unit + db + api)', 'vitest', [vitest, 'run']);

console.log('\nwebv0 gate: PASSED');
