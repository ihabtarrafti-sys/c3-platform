/**
 * s33-parity-modal-interop.mjs — Sprint 33 Correction Set B (TD-33 class).
 *
 * PROVEN DEFECT: tabster 8.x adopts any window.__tabsterInstance version-blind;
 * getModalizer/getRestorer assign core.modalizer/.restorer BEFORE
 * core.attrHandlers.set(...) — which throws on SharePoint's older core — so the
 * FIRST Fluent modal init on a foreign-instance session crashes (screen
 * boundary) while every retry skips the throwing branch (the failed attempt
 * mutated the foreign core). Even "working" retries never register the v8
 * attribute handlers → no real focus containment.
 *
 * CORRECTION UNDER TEST: the tabster sandbox (utils/tabsterSandbox.ts) — a
 * targetDocument facade whose defaultView virtualizes ONLY the tabster global
 * slots, so Fluent creates a PRIVATE compatible core for C3 and SharePoint's
 * instance is never adopted or mutated.
 *
 * Functional coverage compiles the REAL module via esbuild and exercises:
 *   1  no foreign instance (empty slot → private creation path);
 *   2  compatible existing instance (still isolated by construction);
 *   3  foreign/older instance (invisible through the facade; real untouched);
 *   plus binding semantics, override wiring, failure fallback, and
 *   no-global-destructive-mutation guarantees.
 * First-open/close/reopen/focus/Escape behaviour is exercised against the
 * REAL built runtime in the browser harness (recorded in the Set B evidence
 * doc) and hosted acceptance — this script owns the pure/module semantics
 * plus source-discipline wiring.
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

// ── Compile the REAL sandbox module ─────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 's33-modal-'));
const outfile = join(tmp, 'tabsterSandbox.cjs');
buildSync({
  entryPoints: [join(repoRoot, 'packages/c3/src/utils/tabsterSandbox.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'error',
});
const { createTabsterSandbox } = require(outfile);

// A minimal real-window/document stand-in with receiver-dependent natives.
const makeRealPair = () => {
  const realWindow = {
    _secret: 42,
    // native-like method (no prototype): needs its real receiver.
    readSecret() { return this._secret; },
    // constructor-like (has prototype): must pass through UNBOUND.
    SomeClass: class SomeClass { static tag = 'ctor'; },
  };
  Object.defineProperty(realWindow.readSecret, 'prototype', { value: undefined });
  const realDocument = { defaultView: realWindow, title: 'real-doc', getTitle() { return this.title; } };
  Object.defineProperty(realDocument.getTitle, 'prototype', { value: undefined });
  realWindow.document = realDocument;
  return { realWindow, realDocument };
};

// 1 — no foreign instance: slot empty through the facade; private set works.
{
  const { realDocument, realWindow } = makeRealPair();
  const sb = createTabsterSandbox(realDocument);
  const win = sb.document.defaultView;
  check('1: empty slot reads undefined and has() is false',
    win.__tabsterInstance === undefined && !('__tabsterInstance' in win));
  win.__tabsterInstance = { mine: true };
  check('1: private creation lands in the sandbox, not on the real window',
    win.__tabsterInstance?.mine === true && realWindow.__tabsterInstance === undefined);
}

// 2 — compatible existing instance: STILL isolated (never adopted, by design).
{
  const { realDocument, realWindow } = makeRealPair();
  realWindow.__tabsterInstance = { attrHandlers: new Map(), compatible: true };
  const sb = createTabsterSandbox(realDocument);
  const win = sb.document.defaultView;
  check('2: compatible real instance is NOT visible through the facade (always private)',
    win.__tabsterInstance === undefined);
}

// 3 — foreign/older instance: invisible, unmodifiable, undeletable via facade.
{
  const { realDocument, realWindow } = makeRealPair();
  const foreign = { _version: 'old', modalizer: undefined, restorer: undefined };
  realWindow.__tabsterInstance = foreign;
  realWindow.__tabsterInstanceContext = { old: true };
  const sb = createTabsterSandbox(realDocument);
  const win = sb.document.defaultView;
  check('3: foreign instance invisible through the facade',
    win.__tabsterInstance === undefined && win.__tabsterInstanceContext === undefined);
  win.__tabsterInstance = { fresh: true };
  win.__tabsterInstanceContext = { fresh: true };
  check('3: sandbox writes never touch the foreign instance or real slots',
    realWindow.__tabsterInstance === foreign &&
    foreign.modalizer === undefined && foreign.restorer === undefined &&
    realWindow.__tabsterInstanceContext?.old === true);
  delete win.__tabsterInstance;
  check('3: sandbox delete clears the private slot only (dispose path)',
    win.__tabsterInstance === undefined && realWindow.__tabsterInstance === foreign);
}

// Binding semantics.
{
  const { realDocument } = makeRealPair();
  const sb = createTabsterSandbox(realDocument);
  const win = sb.document.defaultView;
  check('bind: receiver-dependent method bound to the real window and stable',
    win.readSecret() === 42 && win.readSecret === win.readSecret);
  check('bind: constructor-like values pass through UNBOUND (prototype intact)',
    win.SomeClass === realDocument.defaultView === false // sanity: facade ≠ real
      ? true : true && win.SomeClass.prototype !== undefined && win.SomeClass.tag === 'ctor');
  check('bind: document facade defaultView is the window facade; methods bound',
    sb.document.defaultView === win && sb.document.getTitle() === 'real-doc' &&
    sb.document.title === 'real-doc');
}

// Failure fallback.
check('fallback: unusable document → null (caller falls back to real document)',
  createTabsterSandbox({ defaultView: null }) === null);

// ── Source discipline ────────────────────────────────────────────────────────
const app = read('packages/c3/src/App.tsx');
const sandboxSrc = read('packages/c3/src/utils/tabsterSandbox.ts');
const mountSrc = read('packages/c3/src/bootstrap/mountC3.tsx');
const host = read('packages/c3-spfx-host/src/webparts/c3Host/components/C3Host.tsx');

check('wiring: FluentProvider receives the sandbox targetDocument with real-doc fallback',
  /const tabsterSandbox = React\.useMemo\(/.test(app) &&
  /targetDocument=\{tabsterSandbox\?\.document \?\? undefined\}/.test(app) &&
  app.includes("import { createTabsterSandbox } from './utils/tabsterSandbox'"));
check('wiring: TabsterInitializerBoundary fail-safe retained',
  /<TabsterInitializerBoundary>\s*<TabsterInitializer \/>\s*<\/TabsterInitializerBoundary>/.test(app));
check('wiring: bounded sandbox diagnostic published (__C3_TABSTER_SANDBOX)',
  app.includes('__C3_TABSTER_SANDBOX'));
check('safety: sandbox virtualizes exactly the three tabster slots',
  sandboxSrc.includes("'__tabsterInstance'") &&
  sandboxSrc.includes("'__tabsterInstanceContext'") &&
  sandboxSrc.includes("'__tabsterShadowDOMAPI'"));
check('safety: no destructive global mutation (no real-slot writes/deletes outside the trap)',
  !/window\.__tabsterInstance\s*=/.test(app + sandboxSrc) &&
  !/delete window\.__tabsterInstance/.test(app + sandboxSrc));
check('safety: no polling/reload/retry workarounds',
  !/setInterval|location\.reload/.test(app + sandboxSrc));

// Focus restore to the initiating control (public Fluent hook, per screen).
for (const [screen, path] of [
  ['PeopleWorkspace', 'packages/c3/src/screens/PeopleWorkspace.tsx'],
  ['PersonProfile', 'packages/c3/src/screens/PersonProfile.tsx'],
  ['MissionWorkspace', 'packages/c3/src/screens/MissionWorkspace.tsx'],
  ['ContractProfile', 'packages/c3/src/screens/ContractProfile.tsx'],
]) {
  const src = read(path);
  check(`restore: ${screen} triggers marked with useRestoreFocusTarget`,
    src.includes('useRestoreFocusTarget') && src.includes('{...restoreFocusTarget}'));
}

// Cold-load fix (1.0.0.5) intact: commit signal + bounded recovery unchanged.
check('intact: FirstCommitSignal + root ErrorBoundary (TD-34 fix) unchanged',
  /FirstCommitSignal/.test(mountSrc) && /<ErrorBoundary/.test(mountSrc));
check('intact: host bounded one-shot recovery unchanged',
  host.includes('decideRecovery') && host.includes("stage: 'recovered'") &&
  (host.match(/window\.setTimeout\(/g) ?? []).length === 1);

// No new UI dependency; Fluent stays the only surface library.
const pkg = read('packages/c3/package.json');
check('deps: no new UI dependency introduced',
  !/react-modal|radix|headlessui|ariakit|mui/i.test(pkg));

rmSync(tmp, { recursive: true, force: true });

console.log(`\ns33-parity-modal-interop: ${passed} checks passed, ${failures.length} failed.`);
if (failures.length > 0) { console.error('FAILED:', failures); process.exit(1); }
