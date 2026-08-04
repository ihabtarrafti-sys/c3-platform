/**
 * webv0-typecheck.mts — run `tsc --noEmit` across every C3 Web V0 workspace.
 * Frozen SharePoint packages are intentionally excluded (they live outside this
 * npm root and keep their own untouched toolchain). Exits non-zero on failure.
 *
 * ⛔ CR-024. The project list was HAND-WRITTEN while the header claimed "every
 * workspace" — and today's ten entries matched the ten workspaces, so it was
 * right by COINCIDENCE (LAW 29): every green run testified to the inputs, not
 * the logic. ⚖️ LAW 27 says which side that falls on — a hand list that must
 * EQUAL reality is a seal, but this one claimed "every", so a subset was a HOLE:
 * an eleventh workspace would have shipped untypechecked forever, under a
 * banner saying it was covered.
 *
 * ⇒ The list is now DERIVED from `package.json.workspaces` — the declaration
 * npm itself installs from, so it cannot drift from what exists. A glob entry
 * is REFUSED rather than silently skipped, because "I did not understand this
 * entry" must never read as "I checked it".
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const workspaces = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { workspaces?: string[] })
  .workspaces;
if (!Array.isArray(workspaces) || workspaces.length === 0) {
  console.error('typecheck: package.json declares no workspaces — nothing to check is a FAILURE, not a pass.');
  process.exit(1);
}
const globEntries = workspaces.filter((w) => /[*?[\]{}]/.test(w));
if (globEntries.length > 0) {
  console.error(
    `typecheck: workspace globs are not supported here: ${globEntries.join(', ')}\n` +
      '  Expand them in this script deliberately — a pattern this tool cannot enumerate\n' +
      '  must fail loudly rather than be skipped under a banner claiming full coverage.',
  );
  process.exit(1);
}
const PROJECTS = workspaces;

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
