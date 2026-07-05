/**
 * validate-gate.mjs — TD-30 canonical fail-fast validation gate (Sprint 32).
 *
 * Run: npm run gate            (or: node scripts/validate-gate.mjs)
 * Self-test: npm run gate -- --self-test-failure
 *   (documented gate self-test: injects a failing child as step 1 and proves
 *    nonzero propagation without running later steps; NOT a product seam)
 *
 * Contract (TD-30, final spec):
 *   - Explicit ordered step list — no directory globbing.
 *   - Every child spawned SHELL-FREE: spawnSync(exe, args, { shell:false,
 *     stdio:'inherit' }). No pipelines, chaining, tail, redirection, or output
 *     filters sit between the gate and any required command.
 *   - Node-direct invocation wherever possible (parity scripts, tsc,
 *     verify-runtime all run under process.execPath). npm scripts run as
 *     process.execPath + npm's own cli.js (npm_execpath / install-dir
 *     resolution) — the verified shell-free method on Windows Node with
 *     batch-file hardening. NEVER shell:true.
 *   - After every child: inspect result.error (spawn failure), result.signal
 *     (signal termination), result.status (null/abnormal/nonzero) — first
 *     failure aborts and the gate exits with that status (or 1).
 *   - Changed-file NUL/truncation audit (modified + staged + untracked).
 *   - Unchanged-runtime-SHA warning: if the committed asset SHA is identical
 *     before/after the strict build while packages/<pkg>/src changes exist,
 *     print a prominent investigation-trigger warning (NOT an automatic
 *     failure — type-only changes can legitimately erase from runtime bytes).
 *   - Final summary table + runtime SHA.
 *
 * See: docs/architecture/C3 Tech Debt Register.md (TD-30)
 */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require_ = createRequire(import.meta.url);
const ASSET = path.join(
  repoRoot,
  'packages', 'c3-spfx-host', 'src', 'webparts', 'c3Host', 'assets', 'c3-runtime', 'c3-runtime.js',
);

// ── Tool resolution (fail closed if anything cannot be located) ─────────────
function resolveTsc() {
  const candidates = [
    () => require_.resolve('typescript/lib/tsc.js'),
    () => require_.resolve('typescript/lib/tsc.js', { paths: [path.join(repoRoot, 'packages', 'c3')] }),
  ];
  for (const c of candidates) { try { return c(); } catch { /* next */ } }
  console.error('✖ GATE: cannot resolve typescript/lib/tsc.js'); process.exit(1);
}
function resolveNpmCli() {
  const candidates = [
    process.env.npm_execpath, // set when invoked via `npm run gate`
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'index.js'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  console.error('✖ GATE: cannot resolve npm cli.js for shell-free npm invocation. Run via `npm run gate`.');
  process.exit(1);
}
const TSC = resolveTsc();
const NPM = resolveNpmCli();

const sha256 = (file) => existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;

// ── Shell-free runner with full error/status/signal inspection ──────────────
const results = [];
function run(name, exe, args) {
  const started = Date.now();
  process.stdout.write(`\n══ GATE STEP: ${name} ══\n`);
  const r = spawnSync(exe, args, { cwd: repoRoot, shell: false, stdio: 'inherit' });
  const ms = Date.now() - started;
  if (r.error) {
    results.push({ step: name, status: `SPAWN ERROR: ${r.error.message}`, ms });
    finish(1, `spawn error in "${name}": ${r.error.message}`);
  }
  if (r.signal) {
    results.push({ step: name, status: `KILLED (${r.signal})`, ms });
    finish(1, `"${name}" terminated by signal ${r.signal}`);
  }
  if (r.status === null || r.status !== 0) {
    results.push({ step: name, status: `EXIT ${r.status ?? 'null'}`, ms });
    finish(r.status ?? 1, `"${name}" failed with exit ${r.status ?? 'null'}`);
  }
  results.push({ step: name, status: 'OK', ms });
}

let warnings = [];
function finish(code, reason) {
  console.log('\n══════════ GATE SUMMARY ══════════');
  console.table(results);
  for (const w of warnings) console.warn(w);
  const sha = sha256(ASSET);
  console.log(`Runtime asset SHA-256: ${sha ?? '(asset missing)'}`);
  if (code === 0) console.log('══════════ GATE: PASS ══════════');
  else console.error(`══════════ GATE: FAIL — ${reason} ══════════`);
  process.exit(code);
}

// ── git helpers (git is a real executable — shell-free safe on Windows) ────
function gitPorcelain() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, shell: false, encoding: 'utf8' });
  if (r.error || r.status !== 0) { console.error('✖ GATE: git status failed'); process.exit(1); }
  return r.stdout.split('\n').filter(Boolean);
}

// ── Steps ────────────────────────────────────────────────────────────────────
const PARITY = [
  's18-parity-approvals', 's17-parity-journeys', 's15-parity-test', 's16-parity-people',
  's27-parity-participants', 's28-parity-logistics', 's29-parity-kit-lifecycle',
  's29b-parity-participant-writes', 's30-parity-readiness', 's31-parity-approval-queries',
  's32-parity-contract-integrity', 's32-parity-acl-phase3d', 's32-parity-nav-activation',
  's32-parity-host-mount',
];

if (process.argv.includes('--self-test-failure')) {
  // Documented self-test: a failing child MUST abort the gate before any later step.
  run('self-test failing child (expected: gate aborts with exit 42)', process.execPath, ['-e', 'process.exit(42)']);
  run('UNREACHABLE — if this ran, failure propagation is broken', process.execPath, ['-e', 'process.exit(0)']);
  finish(1, 'self-test failure was not propagated');
}

const shaBefore = sha256(ASSET);
const srcChanged = gitPorcelain().some(l => /packages[\\/].*[\\/]src[\\/]/.test(l.slice(3)));

for (const s of PARITY) run(`parity ${s}`, process.execPath, [path.join(repoRoot, 'scripts', `${s}.mjs`)]);
run('tsc --noEmit packages/c3', process.execPath, [TSC, '--noEmit', '-p', path.join(repoRoot, 'packages', 'c3', 'tsconfig.json')]);
run('tsc --noEmit packages/c3-spfx-host', process.execPath, [TSC, '--noEmit', '-p', path.join(repoRoot, 'packages', 'c3-spfx-host', 'tsconfig.json')]);
run('strict build (beta:runtime, unpiped)', process.execPath, [NPM, 'run', 'beta:runtime']);
run('verify:runtime', process.execPath, [path.join(repoRoot, 'scripts', 'verify-c3-runtime.mjs')]);

// ── Changed-file NUL/truncation audit ───────────────────────────────────────
{
  process.stdout.write('\n══ GATE STEP: NUL/truncation audit ══\n');
  const started = Date.now();
  const files = gitPorcelain()
    .map(l => l.slice(3).trim().replace(/^"|"$/g, ''))
    .filter(f => f && !f.endsWith('/'))
    .map(f => path.join(repoRoot, f))
    .filter(f => existsSync(f) && statSync(f).isFile());
  let bad = 0;
  for (const f of files) {
    const b = readFileSync(f);
    if (b.length === 0) { console.error(`✖ EMPTY FILE: ${f}`); bad++; }
    else if (b.includes(0)) { console.error(`✖ NUL BYTE: ${f}`); bad++; }
  }
  console.log(`Audited ${files.length} changed file(s); ${bad} defect(s).`);
  results.push({ step: 'NUL/truncation audit', status: bad === 0 ? 'OK' : `${bad} DEFECTS`, ms: Date.now() - started });
  if (bad > 0) finish(1, 'NUL/truncation audit failed');
}

// ── Unchanged-SHA sentinel (warning + investigation trigger, never auto-fail) ─
const shaAfter = sha256(ASSET);
if (srcChanged && shaBefore !== null && shaBefore === shaAfter) {
  warnings.push(
    '\n⚠⚠⚠ WARNING: runtime asset SHA is UNCHANGED although packages/*/src has ' +
    'modifications. Verify the strict build actually ran and rebuilt the bundle ' +
    '(TD-30: verify:runtime proves dist/asset CONSISTENCY, not freshness). ' +
    'Type-only changes can legitimately erase from runtime output — investigate ' +
    'before trusting this gate result. ⚠⚠⚠',
  );
}

finish(0, '');
