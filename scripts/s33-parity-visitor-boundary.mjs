/**
 * s33-parity-visitor-boundary.mjs — Sprint 33 Correction Set E.
 *
 * Covers the 22 mandated scenarios: Contracts truthful-denial (nav hidden,
 * denied-state screens, no false empty, fail-closed reads, no query during
 * normal Visitor nav), per-diem role policy (visible owner/operations/finance/
 * management; hidden visitor/legal/hr; absent from DOM), and read-only
 * Command Center work-item CTAs. The role predicates are compiled from the
 * REAL module; the wiring is pinned by static source discipline.
 */
import { buildSync } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(repoRoot, 'packages/c3/src');
const read = (p) => readFileSync(join(repoRoot, p), 'utf8');

let passed = 0; const failures = [];
const check = (name, cond) => { if (cond) { passed++; } else { failures.push(name); console.error(`✖ ${name}`); } };

// ── Compile the REAL role-policy module ─────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 's33-visitor-'));
const outfile = join(tmp, 'rolePolicy.cjs');
buildSync({
  entryPoints: [join(repoRoot, 'packages/c3/src/utils/rolePolicy.ts')],
  bundle: true, format: 'cjs', platform: 'node', outfile, logLevel: 'error', alias: { '@c3': srcRoot },
});
const { canAccessContracts, canViewPerDiem, canActionWorkItems } = require(outfile);

const ALL = ['owner', 'operations', 'legal', 'finance', 'management', 'hr', 'visitor'];

// Contract access mirrors the C3Contracts ACL: owner/operations/legal/finance/management.
check('contracts: allowed set = owner/operations/legal/finance/management',
  ['owner', 'operations', 'legal', 'finance', 'management'].every(canAccessContracts));
check('contracts: denied = hr, visitor',
  !canAccessContracts('hr') && !canAccessContracts('visitor'));

// Per-diem policy (locked): owner/operations/finance/management; denied visitor/legal/hr.
check('12: per-diem visible to owner', canViewPerDiem('owner'));
check('13: per-diem visible to operations', canViewPerDiem('operations'));
check('14: per-diem visible to finance', canViewPerDiem('finance'));
check('15: per-diem visible to management', canViewPerDiem('management'));
check('16: per-diem hidden from visitor', !canViewPerDiem('visitor'));
check('17: per-diem hidden from legal', !canViewPerDiem('legal'));
check('18: per-diem hidden from hr', !canViewPerDiem('hr'));

// Work-item actionability = owner/operations only.
check('workitems: actionable only for owner/operations',
  canActionWorkItems('owner') && canActionWorkItems('operations') &&
  ['legal', 'finance', 'management', 'hr', 'visitor'].every(r => !canActionWorkItems(r)));

// Every role resolves each predicate to a boolean (total function).
check('policy: predicates total over all roles',
  ALL.every(r => typeof canAccessContracts(r) === 'boolean' &&
    typeof canViewPerDiem(r) === 'boolean' && typeof canActionWorkItems(r) === 'boolean'));

// ── Static wiring ───────────────────────────────────────────────────────────
const nav = read('packages/c3/src/components/layout/NavRail.tsx');
// 1/2: Visitor Contracts hidden; authorized visible.
check('1/2: NavRail Contracts gated on canAccessContracts',
  /id: 'contracts',[\s\S]{0,120}visibleWhen: role => canAccessContracts\(role\)/.test(nav) &&
  nav.includes("import { canAccessContracts }"));

const useContracts = read('packages/c3/src/hooks/useContracts.ts');
const usePersonContracts = read('packages/c3/src/hooks/usePersonContracts.ts');
const useContract = read('packages/c3/src/hooks/useContract.ts');
// 11: no contract query issued for a denied role (enabled:false), from all three hooks.
check('11: contract hooks disable the query for denied roles (no query issued)',
  /enabled:\s*!roleDenied/.test(useContracts) &&
  /enabled:.*&& !roleDenied/.test(usePersonContracts) &&
  /enabled:.*&& !roleDenied/.test(useContract) &&
  [useContracts, usePersonContracts, useContract].every(s => s.includes('canAccessContracts')));

const contractsList = read('packages/c3/src/screens/ContractsList.tsx');
const contractProfile = read('packages/c3/src/screens/ContractProfile.tsx');
const renewals = read('packages/c3/src/screens/RenewalsCenter.tsx');
// 3: direct Contracts/ContractProfile/Renewals route → denied state.
check('3: ContractsList/ContractProfile/Renewals render an explicit denied state',
  /roleDenied[\s\S]{0,220}unavailable for your role/i.test(contractsList) &&
  /roleDenied[\s\S]{0,260}unavailable for your role/i.test(contractProfile) &&
  /roleDenied[\s\S]{0,220}unavailable for your role/i.test(renewals));

const personProfile = read('packages/c3/src/screens/PersonProfile.tsx');
// 4/5: PersonProfile hides "Total Contracts 0" and shows truthful unavailable.
check('4/5: PersonProfile omits the numeric count and shows unavailable for denied roles',
  /contractsRoleDenied \?[\s\S]{0,200}Unavailable for your role/.test(personProfile) &&
  /contractsRoleDenied[\s\S]{0,260}Contracts unavailable for your role/.test(personProfile));

// 6/7: authorized empty still empty; populated still renders (the non-denied
// branches keep the original register/empty logic).
check('6/7: authorized empty + populated register logic preserved',
  contractsList.includes('No contracts yet') && personProfile.includes('No contracts linked') &&
  /if \(roleDenied\)/.test(contractsList));

// 8/9/10: fail-closed reads — no 404/403 → []; typed errors preserved & distinguished.
const personSvc = read('packages/c3/src/services/sharepoint/SharePointPersonService.ts');
check('8/9/10: listPersonContracts fails closed (throws on 404/non-ok/network; no silent [])',
  /status === 404\) throw new ContractsListUnprovisionedError\(\)/.test(personSvc) &&
  /throw new ContractReadFailedError\(response\.status/.test(personSvc) &&
  !/Returning empty contract list for PersonProfile stability/.test(personSvc) &&
  !/return \[\];[\s\S]{0,40}\/\/ .*stability/.test(personSvc));
check('10: ContractsList distinguishes unavailable/provisioning from unexpected failure',
  contractsList.includes('ContractsListUnprovisionedError') &&
  contractsList.includes('ContractReadFailedError') &&
  /Contracts are currently unavailable/.test(contractsList) &&
  /not an empty register/i.test(contractsList) &&
  /Could not load contracts/.test(contractsList));

// Per-diem surfaces gated (MissionWorkspace + ApprovalInbox).
const mission = read('packages/c3/src/screens/MissionWorkspace.tsx');
const approvals = read('packages/c3/src/screens/ApprovalInbox.tsx');
// 16/19: denied per-diem is NOT rendered at all (absent from DOM/a11y text).
check('16/19: MissionWorkspace per-diem gated on showPerDiem (not rendered when denied)',
  /\{showPerDiem && p\.PerDiemRate !== undefined && \(/.test(mission) &&
  /const showPerDiem = canViewPerDiem\(currentUser\.c3Role\)/.test(mission));
check('19: ApprovalInbox payload summary gates per-diem on canViewPerDiem',
  /showPerDiem && perDiemRate !== null \?/.test(approvals) &&
  /const showPerDiem = canViewPerDiem\(currentUser\.c3Role\)/.test(approvals));

// 20/21: read-only Command Center work items — neutral copy, no inert CTA;
// authorized CTA preserved.
const workItemCard = read('packages/c3/src/components/shared/WorkItemCard.tsx');
const commandCenter = read('packages/c3/src/screens/CommandCenter.tsx');
check('20: WorkItemCard renders neutral status (no button, no onClick) when not actionable',
  /actionable \? \([\s\S]{0,240}onClick=\{\(\) => onAction\(workItem\)\}[\s\S]{0,160}\) : \([\s\S]{0,200}NEUTRAL_STATUS_LABEL\[category\]/.test(workItemCard));
check('21: authorized (owner/operations) keep the actionable CTA',
  /const workItemsActionable = canActionWorkItems\(currentUser\.c3Role\)/.test(commandCenter) &&
  /actionable=\{workItemsActionable\}/.test(commandCenter));

// 22: Mock/SP parity — role-denial gating lives in the DSM-agnostic hooks, and
// the Mock person service never fabricates an empty on denial.
const mockPerson = read('packages/c3/src/services/mock/MockPersonService.ts');
check('22: Mock/SP aligned — role gate is in the hook; Mock never fabricates denial []',
  !/Returning empty contract list/.test(mockPerson) &&
  usePersonContracts.includes('canAccessContracts'));

// Architecture guards.
check('x: no PnP import; canonical IDs; native fetch retained in person service',
  !/from ['"]@pnp\//.test(personSvc) && personSvc.includes("getbytitle('C3Contracts')") &&
  /PersonID eq '\$\{escOData\(personId\)\}'/.test(personSvc));
check('x: rolePolicy uses explicit role sets, not a canViewFinancials property read',
  /new Set<C3Role>/.test(read('packages/c3/src/utils/rolePolicy.ts')) &&
  !/\.canViewFinancials/.test(read('packages/c3/src/utils/rolePolicy.ts')));

rmSync(tmp, { recursive: true, force: true });

console.log(`\ns33-parity-visitor-boundary: ${passed} checks passed, ${failures.length} failed.`);
if (failures.length > 0) { console.error('FAILED:', failures); process.exit(1); }
