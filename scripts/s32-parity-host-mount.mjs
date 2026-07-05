/**
 * s32-parity-host-mount.mjs — TD-34 SPFx host mount-lifecycle parity.
 *
 * Compiles the REAL pure host-mount helpers (packages/c3-spfx-host/.../hostMount.ts)
 * via esbuild and exercises them, and statically verifies the hardened C3Host
 * boundary (explicit await, export validation, late/duplicate/detached guards,
 * sync+async error handling, visible fail-closed render, bounded diagnostics,
 * cleanup-once). Also confirms the Part 19.4 identity fix and TD-31/32/33
 * corrections remain intact, and that no SharePoint write/schema/ACL/provision
 * change is present.
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

// ── Compile the pure helpers ─────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 's32-hostmount-'));
const outfile = join(tmp, 'hostMount.cjs');
buildSync({
  entryPoints: [join(repoRoot, 'packages/c3-spfx-host/src/webparts/c3Host/components/hostMount.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'error',
});
const { validateRuntimeModule, decideMount } = require(outfile);

// ── 1/2/3/4: validateRuntimeModule + decideMount behaviour ───────────────────
const goodApp = { runtime: { mount: () => {}, unmount: () => {} } };
check('validate: valid runtime export accepted', validateRuntimeModule(goodApp).ok === true && validateRuntimeModule(goodApp).app === goodApp.runtime);
check('validate: null/undefined module rejected with reason', validateRuntimeModule(null).ok === false && /runtime object/.test(validateRuntimeModule(undefined).reason));
check('validate: missing runtime export rejected', validateRuntimeModule({}).ok === false && /runtime object/.test(validateRuntimeModule({}).reason));
check('validate: missing mount() rejected', validateRuntimeModule({ runtime: { unmount: () => {} } }).ok === false && /mount\(\)/.test(validateRuntimeModule({ runtime: { unmount: () => {} } }).reason));
check('validate: missing unmount() rejected', validateRuntimeModule({ runtime: { mount: () => {} } }).ok === false && /unmount\(\)/.test(validateRuntimeModule({ runtime: { mount: () => {} } }).reason));
check('decide: mounts when live, not-disposed, not-mounted, connected', decideMount({ disposed: false, alreadyMounted: false, targetConnected: true }).mount === true);
check('decide: disposed host never mounts', decideMount({ disposed: true, alreadyMounted: false, targetConnected: true }).mount === false && decideMount({ disposed: true, alreadyMounted: false, targetConnected: true }).reason === 'disposed');
check('decide: duplicate mount prevented', decideMount({ disposed: false, alreadyMounted: true, targetConnected: true }).mount === false && decideMount({ disposed: false, alreadyMounted: true, targetConnected: true }).reason === 'duplicate');
check('decide: detached container never mounted into', decideMount({ disposed: false, alreadyMounted: false, targetConnected: false }).mount === false && decideMount({ disposed: false, alreadyMounted: false, targetConnected: false }).reason === 'detached');
check('decide: disposed takes precedence over duplicate/detached', decideMount({ disposed: true, alreadyMounted: true, targetConnected: false }).reason === 'disposed');

// ── 5/6/7: hardened C3Host source discipline ─────────────────────────────────
const host = read('packages/c3-spfx-host/src/webparts/c3Host/components/C3Host.tsx');
check('host: awaits the runtime import explicitly inside try/catch', /try \{[\s\S]{0,200}await import\(/.test(host) && host.includes("importStatus: 'rejected'"));
check('host: validates the runtime export before mounting', host.includes('validateRuntimeModule(runtimeModule)') && host.includes('if (!validation.ok)'));
check('host: guards late mount via decideMount (disposed/duplicate/detached)', host.includes('decideMount({') && host.includes('this.disposed') && host.includes('targetConnected'));
check('host: checks the mount target is connected', host.includes('.isConnected'));
// S33: the mount invocation moved into mountRuntimeOnce (shared by the
// initial mount and the single bounded recovery) — the try/catch + visible
// fail-closed contract is unchanged.
check('host: catches a thrown mount() (async rejection) and fails closed', /mountRuntimeOnce\(validation\.app, target as HTMLDivElement, 'initial'\)/.test(host) && host.includes('app.mount(target, {') && host.includes('C3 runtime mount failed:') && /} catch \(err\) \{[\s\S]{0,260}failClosed\(`C3 runtime mount failed/.test(host));
check('host: prevents mounting after unmount (disposed flag set in componentWillUnmount)', /componentWillUnmount\(\)[\s\S]{0,120}this\.disposed = true/.test(host));
check('host: avoids duplicate mounts (mountedRuntime guard)', host.includes('this.mountedRuntime') && host.includes("stage: 'skipped-duplicate'"));
check('host: calls runtime cleanup exactly once on unmount', /if \(this\.mountedRuntime && this\.application[\s\S]{0,160}\.unmount\(this\.containerRef\.current\)/.test(host) && /componentWillUnmount[\s\S]{0,400}this\.mountedRuntime = false/.test(host));
check('host: renders a VISIBLE fail-closed error instead of a blank div', host.includes('this.state.hostError') && host.includes("role=\"alert\"") && host.includes('could not start'));
check('host: publishes bounded diagnostics with lifecycle stages', host.includes('__C3_HOST_DIAGNOSTICS') && host.includes("stage: 'mount-complete'") && host.includes("stage: 'importing'") && host.includes("stage: 'error'"));
check('host: diagnostics are non-sensitive (no tokens/digest/response bodies)', !/RequestDigest|Authorization|Bearer|access_token|response\.text\(\)/i.test(host));

// ── 8/9: prior fixes intact ──────────────────────────────────────────────────
{
  const cl = read('packages/c3/src/screens/ContractsList.tsx');
  const pp = read('packages/c3/src/screens/PersonProfile.tsx');
  const mock = read('packages/c3/src/services/mock/MockContractService.ts');
  check('intact: Part 19.4 — register navigates by canonical ContractID', cl.includes('contractId: contract.ContractID'));
  check('intact: Part 19.4 — People profile navigates by canonical ContractID', pp.includes('id: \'contract-profile\', contractId: contract.ContractID'));
  check('intact: Part 19.4 — mock getContract looks up by ContractID (not numeric Id)', mock.includes('item.ContractID === contractId') && !mock.includes('String(item.Id) === contractId'));
  check('intact: TD-31 — no inert New Contract control', !/<Button[^>]*>New Contract<\/Button>/.test(cl));
  check('intact: TD-32 — no stored TotalContracts displayed', !read('packages/c3/src/screens/PeopleWorkspace.tsx').includes('person.TotalContracts') && !pp.includes('value={person.TotalContracts}'));
  check('intact: TD-33 — root modalizer pre-init + deferred panels', read('packages/c3/src/App.tsx').includes('useModalAttributes({ trapFocus: true })') && read('packages/c3/src/hooks/useDeferredMount.ts').includes('useDeferredMount'));
}
// ── 10: no SharePoint write/schema/ACL/provision introduced by the host fix ──
check('boundary: host fix introduces no SP write/provision/ACL surface', !/_api\/|roleassignment|createfieldasxml|X-HTTP-Method|getbytitle|tenantappcatalog/i.test(host + read('packages/c3-spfx-host/src/webparts/c3Host/components/hostMount.ts')));

rmSync(tmp, { recursive: true, force: true });
const total = passed + failures.length;
if (failures.length) { console.error(`s32-parity-host-mount: ${passed}/${total} — FAILURES: ${failures.length}`); process.exit(1); }
console.log(`s32-parity-host-mount: ${passed}/${total} PASS`);
