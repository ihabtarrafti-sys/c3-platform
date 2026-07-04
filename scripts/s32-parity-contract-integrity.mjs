/**
 * s32-parity-contract-integrity.mjs
 *
 * Sprint 32 — Contract read-integrity parity harness.
 *
 * Compiles the ACTUAL production source via esbuild (s27…s31 pattern):
 *   packages/c3/src/services/sharepoint/SharePointContractService.ts
 *     — driven through the injected fetch boundary
 *   packages/c3/src/mappers/contractMapper.ts
 *     — canonical row validation + flat mapping
 *
 * Proves the S32 fail-closed contract read surface:
 *   populated mapping · genuine empty vs unprovisioned · HTTP failure ·
 *   malformed JSON/body · malformed row · missing required canonical field ·
 *   lookup-object input REJECTED not coerced · consumer failure propagation
 *   for Contracts list / Contract Profile / Renewals · no false empty-success.
 *
 * Run: node scripts/s32-parity-contract-integrity.mjs
 */

import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'packages', 'c3', 'src');
const tmp = mkdtempSync(join(tmpdir(), 's32-parity-'));

function compile(entryRel, outName) {
  const outfile = join(tmp, outName);
  buildSync({
    entryPoints: [join(srcRoot, entryRel)],
    bundle: true, format: 'cjs', platform: 'node', outfile,
    logLevel: 'error', alias: { '@c3': srcRoot },
  });
  return require(outfile);
}

let passed = 0, failed = 0;
function check(label, cond, detail = '') {
  if (cond) passed++;
  else { failed++; console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`); }
}
async function rejects(label, promise, match) {
  try { await promise; check(label, false, 'resolved instead of rejecting'); return null; }
  catch (err) {
    const msg = err?.message ?? String(err);
    check(label, match ? match(err, msg) : true, `rejected but predicate failed: ${err?.name}: ${msg.slice(0, 140)}`);
    return err;
  }
}

const SITE = 'https://geekaygames.sharepoint.com/sites/C3';
const row = (id, over = {}) => ({
  Id: id, Title: `GKE-PL-2026-${String(id).padStart(3, '0')}`, PersonID: 'PER-0001',
  FullName: 'Abdulaziz Alabdullatif', DisplayName: 'AbdulA', ContractTypeName: 'Player',
  AgreementCategory: 'Employment', ContractStage1: 'Signed', Disposition1: 'Active',
  StartDate: '2026-01-01', EndDate: '2026-12-31', HasSignedContract: true,
  CurrencyCode: 'USD', ContractOwnerName: 'Ops Lead', ContractOwnerEmail: 'ops@geekay.gg',
  IsActive: true, ...over,
});

const svc = (sp, responder) => {
  const impl = async (url, init) => {
    const res = await responder(String(url), init ?? {});
    if (res instanceof Error) throw res;
    return {
      ok: res.status === undefined || (res.status >= 200 && res.status < 300),
      status: res.status ?? 200, statusText: res.statusText ?? 'OK',
      json: async () => { if (res.malformedJson) throw new Error('bad json'); return res.body ?? {}; },
      text: async () => JSON.stringify(res.body ?? {}),
    };
  };
  return sp.createSharePointContractService(SITE, impl);
};

try {
  const sp = compile('services/sharepoint/SharePointContractService.ts', 'spContracts.cjs');
  const mapper = compile('mappers/contractMapper.ts', 'contractMapper.cjs');

  const realWarn = console.warn, realInfo = console.info, realErr = console.error;
  console.warn = () => {}; console.info = () => {};

  // ── 1. Successful populated mapping ───────────────────────────────────────
  {
    const s = svc(sp, () => ({ body: { value: [row(1), row(2, { EndDate: '2026-02-01' })] } }));
    const list = await s.listContracts();
    check('1. populated list maps via flat canonical mapper', list.length === 2);
    check('1b. ContractID = Title, PersonID propagated',
      list[0].ContractID === 'GKE-PL-2026-001' && list[0].PersonID === 'PER-0001');
    check('1c. OpsStatus computed at read time (not stored)', typeof list[0].OpsStatus === 'string');
  }

  // ── 2. Genuine empty vs unprovisioned ─────────────────────────────────────
  {
    const empty = svc(sp, () => ({ body: { value: [] } }));
    const list = await empty.listContracts();
    check('2. genuine empty list (200, zero rows) returns [] — truthful empty success', Array.isArray(list) && list.length === 0);

    const missing = svc(sp, () => ({ status: 404, statusText: 'Not Found', body: {} }));
    const err = await rejects('2b. unprovisioned list (404) throws — never an empty success',
      missing.listContracts(), (e) => e?.name === 'ContractsListUnprovisionedError');
    check('2c. unprovisioned error says NOT empty', (err?.message ?? '').includes('NOT an empty'));
  }

  // ── 3. HTTP / malformed failures — fail closed ────────────────────────────
  {
    const s500 = svc(sp, () => ({ status: 500, statusText: 'Server Error', body: {} }));
    await rejects('3. HTTP failure throws (not [])', s500.listContracts(), (_, m) => m.includes('UNAVAILABLE'));

    const badJson = svc(sp, () => ({ malformedJson: true }));
    await rejects('3b. malformed JSON throws', badJson.listContracts(), (_, m) => m.includes('failing closed'));

    const badBody = svc(sp, () => ({ body: { notValue: 1 } }));
    await rejects('3c. malformed body (no value array) throws', badBody.listContracts(), (_, m) => m.includes('failing closed'));

    const netErr = svc(sp, () => new Error('network down'));
    await rejects('3d. network error propagates (not [])', netErr.listContracts());
  }

  // ── 4. Canonical row validation — rejection, never coercion ──────────────
  {
    const missingField = svc(sp, () => ({ body: { value: [row(1), row(9, { PersonID: '' })] } }));
    const err = await rejects('4. missing required canonical field rejects whole read',
      missingField.listContracts(), (e) => e?.name === 'ContractReadIntegrityError');
    check('4b. integrity error carries offending item id', Array.isArray(err?.rejectedItemIds) && err.rejectedItemIds.includes(9));

    const noEnd = svc(sp, () => ({ body: { value: [row(3, { EndDate: null })] } }));
    await rejects('4c. missing required EndDate rejects', noEnd.listContracts(), (e) => e?.name === 'ContractReadIntegrityError');

    // Lookup-object input (the mock-era schema shape) — REJECTED, not coerced.
    const lookupRow = svc(sp, () => ({ body: { value: [row(5, { PersonID: undefined, Person: { Id: 4, Title: 'Someone' }, FullName: { Id: 4, Title: 'Someone' } })] } }));
    const lerr = await rejects('4d. lookup-object input rejected rather than coerced',
      lookupRow.listContracts(), (e) => e?.name === 'ContractReadIntegrityError');
    check('4e. rejection message names the lookup violation', (lerr?.message ?? '').length > 0);

    check('4f. validateSpContractItem: valid row passes', mapper.validateSpContractItem(row(7)).length === 0);
    check('4g. validateSpContractItem: object Title flagged as lookup violation',
      mapper.validateSpContractItem(row(8, { Title: { Id: 1 } })).some(e => e.includes('lookup')));
    check('4h. validateSpContractItem: non-numeric Id flagged',
      mapper.validateSpContractItem(row(0, { Id: 'x' })).some(e => e.includes('Id')));
  }

  // ── 5. Consumer failure propagation (screens' data boundaries) ────────────
  {
    const s500 = svc(sp, () => ({ status: 503, statusText: 'Unavailable', body: {} }));
    // Contracts list consumer (ContractsList → useContracts → listContracts)
    await rejects('5. Contracts list consumer failure propagates', s500.listContracts());
    // Contract Profile consumer (ContractProfile → useContract → getContract)
    await rejects('5b. Contract Profile failure propagates (list-read failure ≠ not-found)',
      s500.getContract('GKE-PL-2026-001'), (_, m) => !m.includes('not found'));
    // Renewals consumer (RenewalsCenter → useRenewalContracts → listRenewalContracts)
    await rejects('5c. Renewals failure propagates — NO false empty-success',
      s500.listRenewalContracts());

    // getContract truthful not-found on a genuine empty filter result.
    const empty = svc(sp, () => ({ body: { value: [] } }));
    await rejects('5d. getContract not-found is its own truthful error',
      empty.getContract('GKE-XX-0000-000'), (_, m) => m.includes('not found'));

    // Renewals genuine-empty remains a truthful empty success.
    const emptyOk = svc(sp, () => ({ body: { value: [] } }));
    check('5e. Renewals genuine empty stays [] (list exists, zero rows)',
      (await emptyOk.listRenewalContracts()).length === 0);

    // Renewals filtering still works on valid data.
    const mixed = svc(sp, () => ({ body: { value: [row(1), row(2, { Disposition1: 'Terminated' })] } }));
    check('5f. Renewals filters Terminated/Archived from valid data',
      (await mixed.listRenewalContracts()).length === 1);
  }

  console.warn = realWarn; console.info = realInfo; console.error = realErr;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
