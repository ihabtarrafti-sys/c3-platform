/**
 * s32-parity-nav-activation.mjs — Sprint 32 NavRail Contracts activation parity.
 *
 * Source-level proofs that the activation is exactly what was approved:
 *   - Contracts is present in the NavRail manifest and UNGUARDED (the S24-P1
 *     SP-DSM visibleWhen guard no longer controls the item);
 *   - route resolution reaches the existing Contracts workspace (AppShell renders
 *     ContractsList / ContractProfile for the existing screen ids);
 *   - contract-profile roots to the Contracts nav item;
 *   - unrelated workspaces and their guards are UNCHANGED (Amendments and
 *     Intelligence remain SP-DSM-hidden; Renewals/Inbox/Approvals remain
 *     non-visitor; Settings remains capability-gated; Missions unguarded);
 *   - no Contracts mutation/write surface exists or was enabled (read-only
 *     4-method interface; the SP contract service issues no mutating request);
 *   - navigation code contains no SharePoint provisioning or ACL logic.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

let passed = 0; const failures = [];
const check = (name, cond) => { if (cond) { passed++; } else { failures.push(name); console.error(`✖ ${name}`); } };

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const nav = read('packages/c3/src/components/layout/NavRail.tsx');
const shell = read('packages/c3/src/components/layout/AppShell.tsx');
const iface = read('packages/c3/src/services/interfaces/IContractService.ts');
const spSvc = read('packages/c3/src/services/sharepoint/SharePointContractService.ts');
const mockIdx = read('packages/c3/src/services/mock/index.ts');
const spIdx = read('packages/c3/src/services/sharepoint/index.ts');

// ── 1. Contracts present and unguarded in the NavRail manifest ────────────────
const navItemLine = (id) => {
  // CRLF-safe: the working tree may use \r\n (repo autocrlf).
  const m = nav.match(new RegExp(`\\{ id: '${id}',[^\\r\\n]*\\},?\\r?\\n`));
  return m ? m[0] : null;
};
const contractsLine = navItemLine('contracts');
check('nav: Contracts item present in NAV_ITEMS', contractsLine !== null && contractsLine.includes("label: 'Contracts'"));
check('nav: Contracts item has NO visibleWhen guard (S24-P1 guard removed)', contractsLine !== null && !contractsLine.includes('visibleWhen'));
check("nav: the old SP-DSM guard no longer controls Contracts", !/id: 'contracts'[^\n]*mode !== 'sharepoint'/.test(nav));

// ── 2. Route resolution reaches the existing Contracts workspace ─────────────
check("route: 'contracts' renders the existing ContractsList workspace", /case 'contracts':\s*\n\s*return <ContractsList/.test(shell));
check("route: 'contract-profile' renders the existing ContractProfile screen", /case 'contract-profile':\s*\n\s*return <ContractProfile/.test(shell));
check("route: contract-profile roots to the Contracts nav item", /case 'contract-profile':\s*return \{ id: 'contracts' \};/.test(nav));
check('route: no data-source-mode gating in AppShell screen rendering for contracts', !/case 'contracts':[^]{0,200}sharepoint/.test(shell));

// ── 3. Unrelated workspaces and guards UNCHANGED ──────────────────────────────
check('guards: Amendments remains SP-DSM-hidden (stub adapter, S20-P0-3)', /id: 'amendments',[^\n]*mode !== 'sharepoint'/.test(nav));
check('guards: Intelligence remains SP-DSM-hidden (TD-23)', /id: 'intelligence',[^\n]*mode !== 'sharepoint'/.test(nav));
check('guards: Renewals remains non-visitor', /id: 'renewals',[^\n]*role !== 'visitor'/.test(nav));
check('guards: Inbox remains non-visitor', /id: 'inbox',[^\n]*role !== 'visitor'/.test(nav));
check('guards: Approvals remains non-visitor', /id: 'approvals',[^\n]*role !== 'visitor'/.test(nav));
check('guards: Settings remains capability-gated', /id: 'settings',[^\n]*canManageSettings/.test(nav));
check('guards: Missions remains unguarded (TD-25 resolved)', navItemLine('missions') !== null && !navItemLine('missions').includes('visibleWhen'));
check("guards: amendment-profile still roots to amendments", /case 'amendment-profile':\s*return \{ id: 'amendments' \};/.test(nav));
check("guards: person-profile root unchanged", /case 'person-profile':\s*return \{ id: 'command-center' \};/.test(nav));

// ── 4. No Contracts mutation/write surface exists or was enabled ─────────────
check('write-surface: IContractService is read-only (exactly the four list/get methods)',
  ['listContracts(', 'listRenewalContracts(', 'getContract(', 'listContractActivities('].every(m => iface.includes(m))
  && !/create|update|delete|merge|submit|save|mutate/i.test(iface.replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, '')));
check('write-surface: SharePoint contract service issues no mutating request', !/X-HTTP-Method|method:\s*['"]POST['"]|X-RequestDigest/.test(spSvc));
check('write-surface: both DSMs register the same read-only contracts service', mockIdx.includes('contracts: createMockContractService()') && spIdx.includes('contracts: createSharePointContractService(siteUrl)'));

// ── 4b. TD-31 / TD-32 Internal V1 corrections ─────────────────────────────────
const contractsList = read('packages/c3/src/screens/ContractsList.tsx');
const peopleWs = read('packages/c3/src/screens/PeopleWorkspace.tsx');
const personProfile = read('packages/c3/src/screens/PersonProfile.tsx');
check('TD-31: inert New Contract control removed from the Contracts workspace', !contractsList.includes('New Contract') || !/<Button[^>]*>New Contract<\/Button>/.test(contractsList));
check('TD-31: ContractsList renders no button-based header action at all', !/actions=\{<Button/.test(contractsList));
check('TD-32: People register no longer displays the stored TotalContracts field', !peopleWs.includes('person.TotalContracts'));
check('TD-32: People register "Contracts" column removed for V1 (no stale/fabricated count)', !peopleWs.includes("label: 'Contracts'") && !peopleWs.includes('contractCount'));
check('TD-32: People register HEADERS and COL_WIDTHS stay aligned (6 columns)', (peopleWs.match(/\{ label: '/g) ?? []).length === 6 && /COL_WIDTHS[^=]*=\s*\[120, null, 140, 160, 120, 96\]/.test(peopleWs));
check('TD-32: PersonProfile Total Contracts tile derives from canonical rows', !personProfile.includes('value={person.TotalContracts}') && personProfile.includes('contractsPending || contractsError ? undefined : contracts.length'));

// ── 5. Navigation code contains no SharePoint provisioning or ACL logic ──────
check('boundary: NavRail/AppShell contain no SharePoint REST, provisioning, or ACL code',
  !/_api\/|roleassignment|breakroleinheritance|roledefinition|fetch\(/i.test(nav)
  && !/_api\/|roleassignment|breakroleinheritance|roledefinition/i.test(shell));
check('boundary: NavRail role checks remain UX-only (no permission mutation, no fetch)', !/fetch\(|EffectiveBasePermissions/.test(nav));

// ── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failures.length;
if (failures.length) {
  console.error(`s32-parity-nav-activation: ${passed}/${total} — FAILURES: ${failures.length}`);
  process.exit(1);
}
console.log(`s32-parity-nav-activation: ${passed}/${total} PASS`);
