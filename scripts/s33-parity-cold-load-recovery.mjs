/**
 * s33-parity-cold-load-recovery.mjs — TD-34 normal-use cold-load blank hotfix.
 *
 * Sprint 33 Defect A. Covers the ten mandated scenarios:
 *   1  normal first mount commits without recovery;
 *   2  first mount returns but commits no DOM → recovery permitted;
 *   3  one bounded recovery remount succeeds;
 *   4  recovery occurs at most once;
 *   5  detached target prevents recovery;
 *   6  disposed host prevents recovery;
 *   7  first root is cleaned before recovery;
 *   8  failed recovery produces a visible error;
 *   9  no duplicate runtime/application instance remains;
 *   10 host diagnostics distinguish normal mount, recovery, and failure.
 *
 * The recovery DECISION is a pure function (hostMount.decideRecovery) —
 * compiled from the REAL source via esbuild and exercised functionally.
 * The host/runtime WIRING is verified by static source discipline checks,
 * the same proven pattern as s32-parity-host-mount.
 */
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');

let passed = 0; const failures = [];
const check = (name, cond) => { if (cond) { passed++; } else { failures.push(name); console.error(`✖ ${name}`); } };

// ── Compile the REAL pure recovery decision ─────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 's33-recovery-'));
const outfile = join(tmp, 'hostMount.cjs');
buildSync({
  entryPoints: [join(repoRoot, 'packages/c3-spfx-host/src/webparts/c3Host/components/hostMount.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'error',
});
const { decideRecovery, decideMount } = require(outfile);

const base = { mountCompleted: true, committed: false, disposed: false, targetConnected: true, recoveryUsed: false };

// 1 — normal path: committed tree never triggers recovery.
check('1: committed first mount → no recovery (reason committed)',
  decideRecovery({ ...base, committed: true }).recover === false &&
  decideRecovery({ ...base, committed: true }).reason === 'committed');

// 2 — mount returned, nothing committed → the single recovery is permitted.
check('2: mount returned + no commit + live target → recovery permitted',
  decideRecovery(base).recover === true);

// 4 — at most once, ever.
check('4: recovery already used → never recovers again (reason already-recovered)',
  decideRecovery({ ...base, recoveryUsed: true }).recover === false &&
  decideRecovery({ ...base, recoveryUsed: true }).reason === 'already-recovered');

// 5 — detached target blocks recovery.
check('5: detached target → no recovery (reason detached)',
  decideRecovery({ ...base, targetConnected: false }).recover === false &&
  decideRecovery({ ...base, targetConnected: false }).reason === 'detached');

// 6 — disposed host blocks recovery, silently, with precedence.
check('6: disposed host → no recovery (reason disposed), precedence over used/detached',
  decideRecovery({ ...base, disposed: true }).reason === 'disposed' &&
  decideRecovery({ ...base, disposed: true, recoveryUsed: true, targetConnected: false }).reason === 'disposed');

// guard-rail: a mount that never completed is owned by the fail-closed
// import/mount error paths, not by recovery.
check('x: not-mounted state is not recoverable',
  decideRecovery({ ...base, mountCompleted: false }).reason === 'not-mounted');

// original mount decision unchanged (single normal mount preserved).
check('x: decideMount normal path unchanged (single mount)',
  decideMount({ disposed: false, alreadyMounted: false, targetConnected: true }).mount === true &&
  decideMount({ disposed: false, alreadyMounted: true, targetConnected: true }).reason === 'duplicate');

// ── Host wiring (static source discipline) ──────────────────────────────────
const host = read('packages/c3-spfx-host/src/webparts/c3Host/components/C3Host.tsx');

// 1 — commit signal clears the deadline; normal path records runtime-committed.
check('1: first-commit signal clears the deadline and records runtime-committed',
  /handleFirstCommit[\s\S]{0,220}this\.committed = true;[\s\S]{0,120}this\.clearCommitDeadline\(\)/.test(host) &&
  host.includes("stage: 'runtime-committed', committedFirstMount: true"));

// 2 — the deadline is a SINGLE bounded one-shot timer, armed only after mount-complete.
check('2: single bounded deadline (setTimeout once, cleared, no polling/reload)',
  (host.match(/window\.setTimeout\(/g) ?? []).length === 1 &&
  host.includes('clearCommitDeadline') &&
  !/setInterval|location\.reload/.test(host) &&
  /stage: 'mount-complete', mountCompleted: true[\s\S]{0,120}armCommitDeadline/.test(host));

// 3 — the recovery path remounts exactly once via the shared mount helper.
check('3: recovery remounts once via mountRuntimeOnce(recovery) + re-arms final deadline',
  /this\.recoveryUsed = true;[\s\S]{0,700}mountRuntimeOnce\(app, target, 'recovery'\)[\s\S]{0,120}armCommitDeadline\(target\)/.test(host) &&
  host.includes("stage: 'recovered', commitAfterRecovery: true"));

// 4 — recoveryUsed is set BEFORE the remount so a re-entry can never recover twice.
check('4: recoveryUsed set before the remount (at-most-once enforced in wiring too)',
  /this\.recoveryUsed = true;[\s\S]{0,200}stage: 'recovering'/.test(host));

// 5 — detached at deadline fails closed VISIBLY.
check('5: detached at deadline → visible fail-closed error',
  /reason === 'detached'[\s\S]{0,240}failClosed\('C3 host container was detached before the runtime rendered\.'\)/.test(host));

// 6 — disposal clears the deadline (silent, no recovery on disposed host).
check('6: componentWillUnmount clears the deadline',
  /componentWillUnmount\(\)[\s\S]{0,160}clearCommitDeadline\(\)/.test(host));

// 7 — the first root is cleanly unmounted before the recovery remount.
check('7: first root unmounted (app.unmount) before recovery remount',
  /app\.unmount\(target\);[\s\S]{0,400}mountRuntimeOnce\(app, target, 'recovery'\)/.test(host));

// 8 — a spent recovery that still has no commit fails closed with a visible error.
check('8: failed recovery → visible fail-closed error (both deadline and throw paths)',
  /reason === 'already-recovered'[\s\S]{0,600}failClosed\(\s*'C3 loaded but did not render, and one bounded recovery attempt also did not render\.'/.test(host) &&
  /stage: 'recovery-failed'[\s\S]{0,300}C3 recovery remount failed/.test(host));

// 9 — no duplicate application instance: one application handle, duplicate mount
//     still guarded, recovery cleans before remounting.
check('9: single application handle + duplicate-mount guard intact',
  host.includes('private application?: PlatformApplication') &&
  host.includes("stage: 'skipped-duplicate'") &&
  host.includes('decideMount({'));

// 10 — diagnostics distinguish normal, recovery, and failure states.
check('10: diagnostics stages + fields distinguish normal/recovery/failure',
  ["'runtime-committed'", "'recovering'", "'recovered'", "'recovery-failed'", "'runtime-error'"]
    .every(s => host.includes(s)) &&
  ['committedFirstMount', 'recoveryUsed', 'commitAfterRecovery', 'timeToCommitMs', 'runtimeErrorName']
    .every(f => host.includes(f)));

// diagnostics stay non-sensitive.
check('x: diagnostics remain non-sensitive (no tokens/digests/bodies)',
  !/RequestDigest|Authorization|Bearer|access_token|response\.text\(\)/i.test(host));

// ── Runtime wiring (static source discipline) ───────────────────────────────
const mountSrc = read('packages/c3/src/bootstrap/mountC3.tsx');
const hostRuntimeSrc = read('packages/c3/src/bootstrap/HostRuntime.ts');
const boundarySrc = read('packages/c3/src/components/ErrorBoundary.tsx');
const loaderSrc = read('packages/c3-spfx-host/src/webparts/c3Host/runtime/C3RuntimeLoader.ts');

// commit signal: layout effect fires once, post-commit only.
check('runtime: FirstCommitSignal uses a once-guarded layout effect',
  /FirstCommitSignal[\s\S]{0,400}useLayoutEffect[\s\S]{0,200}fired\.current = true;[\s\S]{0,80}onFirstCommit\?\.\(\)/.test(mountSrc));

// root boundary wraps the ENTIRE tree (providers included) and reports errors.
check('runtime: root ErrorBoundary wraps providers and reports via onRuntimeError',
  /<ErrorBoundary[\s\S]{0,200}onRuntimeError\?\.\(error\.name, error\.message\)[\s\S]{0,400}<HostContextProvider/.test(mountSrc));

// 7/9 — runtime keys roots by container and unmounts any existing root first:
//        duplicate roots per container are impossible.
check('runtime: existing root unmounted before createRoot (no duplicate roots)',
  /const existingRoot = roots\.get\(container\);[\s\S]{0,120}existingRoot\.unmount\(\);[\s\S]{0,200}createRoot\(container\)/.test(mountSrc) &&
  mountSrc.includes('roots.delete(container)'));

// contract: optional callbacks on both sides; boundary sink cannot break the boundary.
check('contract: HostRuntime + PlatformMountOptions expose onFirstCommit/onRuntimeError',
  hostRuntimeSrc.includes('onFirstCommit?:') && hostRuntimeSrc.includes('onRuntimeError?:') &&
  loaderSrc.includes('onFirstCommit?:') && loaderSrc.includes('onRuntimeError?:'));
check('boundary: onError sink is optional and cannot break the fallback',
  boundarySrc.includes('onError?: (error: Error) => void') &&
  /try \{\s*this\.props\.onError\?\.\(error\);\s*\} catch/.test(boundarySrc));

// ── Hosted-proven root cause containment (1.0.0.5) ─────────────────────────
// SP shell's FOREIGN older tabster instance is adopted by tabster 8.x on
// race-lost cold loads; useModalAttributes then crashes the first render.
// The pre-registration is an optimization and must be NON-FATAL.
const appSrc = read('packages/c3/src/App.tsx');
check('root-cause: TabsterInitializer isolated by a non-fatal boundary',
  /class TabsterInitializerBoundary[\s\S]{0,600}getDerivedStateFromError/.test(appSrc) &&
  /<TabsterInitializerBoundary>\s*<TabsterInitializer \/>\s*<\/TabsterInitializerBoundary>/.test(appSrc) &&
  /this\.state\.failed \? null : this\.props\.children/.test(appSrc));
check('root-cause: boundary failure is silent + sanitized (no rethrow, no PII)',
  /componentDidCatch\(error: Error\): void \{[\s\S]{0,400}console\.warn/.test(appSrc) &&
  !/throw error/.test(appSrc.slice(appSrc.indexOf('class TabsterInitializerBoundary'), appSrc.indexOf('export const C3App'))));
check('root-cause: mountC3 publishes the bounded foreign-tabster probe',
  mountSrc.includes('__C3_TABSTER_PROBE') &&
  mountSrc.includes("!('attrHandlers' in existing)") &&
  /try \{[\s\S]{0,700}__C3_TABSTER_PROBE[\s\S]{0,300}\} catch \{/.test(mountSrc));

// forbidden approaches stay absent from runtime too.
check('x: no reload/polling/edit-mode automation anywhere in the fix',
  !/setInterval|location\.reload|MSOLayout|displayMode/i.test(mountSrc + host));

// boundary: host fix introduces no SP write/provision/ACL surface.
check('x: no SP write/provision/ACL surface in host or runtime bootstrap',
  !/_api\/|roleassignment|createfieldasxml|X-HTTP-Method|getbytitle|tenantappcatalog/i.test(host + mountSrc + hostRuntimeSrc + loaderSrc));

rmSync(tmp, { recursive: true, force: true });

console.log(`\ns33-parity-cold-load-recovery: ${passed} checks passed, ${failures.length} failed.`);
if (failures.length > 0) { console.error('FAILED:', failures); process.exit(1); }
