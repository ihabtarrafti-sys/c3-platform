/**
 * gate.mts — the C3 Web V0 CI gate (run from the webv0 npm root). Audits,
 * typechecks every workspace, then runs the full test suite (unit + DB
 * integration + API). The DB/API projects provision a real PostgreSQL via
 * embedded-postgres when DATABASE_URL is unset, so this gate is self-contained
 * and needs no Docker.
 *
 * This gate is SEPARATE from the frozen SharePoint `npm run gate` at the
 * repository root; it never touches the frozen packages.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { sweepStaleEmbeddedPg } from '@c3web/test-support';

const webv0Root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Windows embedded-PG teardown occasionally leaks processes/data dirs; piled
// up across runs they degrade the machine until tests flake on timeouts. The
// sweep is age-gated (≥60min), kills only postgres.exe whose cmdline names a
// c3web-pg-* dir, and logs everything it touches (see test-support).
await sweepStaleEmbeddedPg();

function step(label: string, args: string[]): void {
  console.log(`\n═══ ${label} ═══`);
  const res = spawnSync(process.execPath, args, { cwd: webv0Root, stdio: 'inherit' });
  if (res.status !== 0) {
    console.error(`\nwebv0 gate FAILED at: ${label}`);
    process.exit(res.status ?? 1);
  }
}

const tsx = join(webv0Root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const vitest = join(webv0Root, 'node_modules', 'vitest', 'vitest.mjs');

step('nul/truncation audit', [tsx, join(webv0Root, 'scripts', 'nul-audit.mts')]);
step('typecheck', [tsx, join(webv0Root, 'scripts', 'typecheck.mts')]);
step('test (unit + db + api)', [vitest, 'run']);
step('entra production bundle excludes dev auth', [tsx, join(webv0Root, 'scripts', 'verify-entra-bundle.mts')]);

console.log('\nwebv0 gate: PASSED');
