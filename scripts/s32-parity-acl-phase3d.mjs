/**
 * s32-parity-acl-phase3d.mjs — Sprint 32 Phase 3D ACL planning parity harness.
 *
 * Tests the REAL pure core (scripts/phase3d/acl-plan-core.mjs) and mechanically
 * verifies the owner-executed browser tooling (C3-3D0 / C3-3D1):
 *   - exact five-principal ACL evaluation; Owners Full Control + four Reads
 *   - rejection of missing / duplicate / wrong-type groups and role definitions
 *   - detection of HR / Members / Visitors / other extras
 *   - inherited vs unique inheritance handling
 *   - deterministic ordering with grant-before-remove
 *   - recovery planning incl. terminal (empty) plans
 *   - Owners-FC never revoked; Limited Access on a target blocks planning
 *   - frozen ACL fingerprint formula
 *   - non-ACL preservation dimensions (schema/settings/identity/contents/deps)
 *   - wildcard-ETag prohibition and mutation-class discipline in the tooling
 *   - byte-identical 3D core embedded in both browser scripts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  P3D_TARGET_GROUPS, resolvePrincipals, resolveRoleDefinitions, normalizeAssignments,
  aclFingerprintInput, evaluateAcl, planMutations, planActionStrings, nonAclDrift,
} from './phase3d/acl-plan-core.mjs';

let passed = 0; const failures = [];
const check = (name, cond) => { if (cond) { passed++; } else { failures.push(name); console.error(`✖ ${name}`); } };

// ── Fixtures ─────────────────────────────────────────────────────────────────
const G = (Id, Title, PrincipalType = 8) => ({ Id, Title, LoginName: Title, PrincipalType });
const groups = () => [G(3, 'C3 Owners'), G(15, 'C3 Operations'), G(17, 'C3 Legal'), G(19, 'C3 Finance'), G(21, 'C3 Management'), G(23, 'C3 HR'), G(5, 'C3 Members'), G(4, 'C3 Visitors')];
const roleDefs = () => [{ Id: 1073741829, Name: 'Full Control' }, { Id: 1073741826, Name: 'Read' }, { Id: 1073741830, Name: 'Edit' }, { Id: 1073741825, Name: 'Limited Access' }];
const DEF_ID = Object.fromEntries(roleDefs().map(r => [r.Name, r.Id]));
const RA = (pid, title, ...names) => ({ PrincipalId: pid, Member: { Id: pid, Title: title, LoginName: title, PrincipalType: 8 }, RoleDefinitionBindings: names.map(n => ({ Id: DEF_ID[n], Name: n })) });
const exactAcl = () => normalizeAssignments([RA(3, 'C3 Owners', 'Full Control'), RA(15, 'C3 Operations', 'Read'), RA(17, 'C3 Legal', 'Read'), RA(19, 'C3 Finance', 'Read'), RA(21, 'C3 Management', 'Read')]);
const { resolved: targets, errors: resolveErrors } = resolvePrincipals(groups());
const { roles, errors: roleErrors } = resolveRoleDefinitions(roleDefs());

// ── 1. Principal resolution ──────────────────────────────────────────────────
check('resolution: five targets resolve cleanly', resolveErrors.length === 0 && targets.length === 5);
check('resolution: ids bound from live inventory', targets[0].id === 3 && targets[1].id === 15 && targets[4].id === 21);
check('resolution: target order preserved (Owners first)', targets.map(t => t.title).join(',') === P3D_TARGET_GROUPS.map(t => t.title).join(','));
{
  const { errors } = resolvePrincipals(groups().filter(g => g.Title !== 'C3 Finance'));
  check('resolution: missing group rejected', errors.some(e => e.includes('missing required group: C3 Finance')));
}
{
  const { errors } = resolvePrincipals([...groups(), G(99, 'C3 Legal')]);
  check('resolution: duplicate group title rejected', errors.some(e => e.includes('duplicate/ambiguous group title: C3 Legal')));
}
{
  const { errors } = resolvePrincipals(groups().map(g => g.Title === 'C3 Operations' ? { ...g, PrincipalType: 1 } : g));
  check('resolution: unexpected principal type rejected', errors.some(e => e.includes('unexpected principal type for C3 Operations')));
}
check('roles: Full Control + Read resolve', roleErrors.length === 0 && roles['Full Control'].id === DEF_ID['Full Control'] && roles.Read.id === DEF_ID.Read);
{
  const { errors } = resolveRoleDefinitions(roleDefs().filter(r => r.Name !== 'Read'));
  check('roles: missing Read rejected', errors.some(e => e.includes('missing role definition: Read')));
}
{
  const { errors } = resolveRoleDefinitions([...roleDefs(), { Id: 9, Name: 'Full Control' }]);
  check('roles: duplicate role name rejected', errors.some(e => e.includes('duplicate role definition name: Full Control')));
}

// ── 2. Exact five-principal evaluation ───────────────────────────────────────
{
  const ev = evaluateAcl(exactAcl(), targets);
  check('evaluate: exact five-principal target passes', ev.exact === true && ev.matchedTargets.length === 5 && ev.extraPrincipals.length === 0);
}
{
  const ev = evaluateAcl(normalizeAssignments([RA(3, 'C3 Owners', 'Read'), RA(15, 'C3 Operations', 'Read'), RA(17, 'C3 Legal', 'Read'), RA(19, 'C3 Finance', 'Read'), RA(21, 'C3 Management', 'Read')]), targets);
  check('evaluate: Owners must hold Full Control', ev.exact === false && ev.wrongBindings.some(w => w.title === 'C3 Owners' && w.expected === 'Full Control'));
}
{
  const ev = evaluateAcl(normalizeAssignments([RA(3, 'C3 Owners', 'Full Control'), RA(15, 'C3 Operations', 'Edit'), RA(17, 'C3 Legal', 'Read'), RA(19, 'C3 Finance', 'Read'), RA(21, 'C3 Management', 'Read')]), targets);
  check('evaluate: four Read assignments required (Edit rejected)', ev.exact === false && ev.wrongBindings.some(w => w.title === 'C3 Operations' && w.actual.includes('Edit')));
}
{
  const ev = evaluateAcl(normalizeAssignments([RA(3, 'C3 Owners', 'Full Control'), RA(15, 'C3 Operations', 'Read'), RA(17, 'C3 Legal', 'Read'), RA(19, 'C3 Finance', 'Read')]), targets);
  check('evaluate: missing target detected', ev.exact === false && ev.missingTargets.includes('C3 Management'));
}
{
  const ev = evaluateAcl(normalizeAssignments([...exactAcl().length ? [] : [], RA(3, 'C3 Owners', 'Full Control'), RA(15, 'C3 Operations', 'Read'), RA(17, 'C3 Legal', 'Read'), RA(19, 'C3 Finance', 'Read'), RA(21, 'C3 Management', 'Read'), RA(23, 'C3 HR', 'Read'), RA(5, 'C3 Members', 'Edit'), RA(4, 'C3 Visitors', 'Read'), RA(77, 'Random Copied User', 'Read')]), targets);
  check('evaluate: HR/Members/Visitors extras detected', ev.forbiddenPresent.length === 3 && ['C3 HR', 'C3 Members', 'C3 Visitors'].every(t => ev.forbiddenPresent.includes(t)));
  check('evaluate: any other copied principal detected as extra', ev.extraPrincipals.some(p => p.title === 'Random Copied User') && ev.exact === false);
}
{
  const ev = evaluateAcl(normalizeAssignments([RA(3, 'C3 Owners', 'Full Control', 'Limited Access'), RA(15, 'C3 Operations', 'Read'), RA(17, 'C3 Legal', 'Read'), RA(19, 'C3 Finance', 'Read'), RA(21, 'C3 Management', 'Read')]), targets);
  check('evaluate: Limited Access on a target is surfaced and blocks exactness', ev.exact === false && ev.limitedAccessOnTargets.includes('C3 Owners'));
}

// ── 3. Deterministic planning: inherited web-copy scenario ───────────────────
const inheritedCopy = () => normalizeAssignments([
  RA(3, 'C3 Owners', 'Full Control'), RA(17, 'C3 Legal', 'Full Control'),
  RA(5, 'C3 Members', 'Edit'), RA(4, 'C3 Visitors', 'Read'), RA(23, 'C3 HR', 'Read'),
]);
{
  const { actions, errors } = planMutations(inheritedCopy(), targets, roles, false);
  const s = planActionStrings(actions);
  check('plan: no errors for clean inherited scenario', errors.length === 0);
  check('plan: inherited state → break-inheritance(copy=true,clearSubscopes=false) first', s[0] === 'break-inheritance(copy=true,clearSubscopes=false)');
  check('plan: unique state → no inheritance break', planActionStrings(planMutations(inheritedCopy(), targets, roles, true).actions).every(x => !x.startsWith('break-inheritance')));
  const kinds = actions.map(a => a.kind);
  const lastGrant = kinds.lastIndexOf('grant'), firstRevoke = kinds.indexOf('revoke-binding'), firstRemove = kinds.indexOf('remove-principal');
  check('plan: grant-before-remove ordering', lastGrant >= 0 && firstRemove > lastGrant && (firstRevoke === -1 || firstRevoke > lastGrant));
  check('plan: grants in fixed target order', s.filter(x => x.startsWith('grant:')).join(';') === `grant:C3 Operations#15=Read#${DEF_ID.Read};grant:C3 Legal#17=Read#${DEF_ID.Read};grant:C3 Finance#19=Read#${DEF_ID.Read};grant:C3 Management#21=Read#${DEF_ID.Read}`);
  check('plan: Owners already Full Control → no Owners grant', s.every(x => !x.startsWith('grant:C3 Owners#')));
  check('plan: extra binding on target revoked (Legal Full Control)', s.includes(`revoke:C3 Legal#17-Full Control#${DEF_ID['Full Control']}`));
  check('plan: non-target principals removed one at a time, sorted', s.filter(x => x.startsWith('remove:')).join(';') === 'remove:C3 HR#23;remove:C3 Members#5;remove:C3 Visitors#4');
  check('plan: Owners never revoked or removed', s.every(x => !x.includes('C3 Owners#3-Full Control') && x !== 'remove:C3 Owners#3'));
  check('plan: deterministic (identical inputs → identical strings)', JSON.stringify(s) === JSON.stringify(planActionStrings(planMutations(inheritedCopy(), targets, roles, false).actions)));
}
{
  const { errors } = planMutations(inheritedCopy(), targets.slice(0, 4), roles, false);
  check('plan: refuses with unresolved targets', errors.some(e => e.includes('unresolved targets')));
}
{
  const { errors } = planMutations(inheritedCopy(), targets, { Read: roles.Read }, false);
  check('plan: refuses with unresolved role definitions', errors.some(e => e.includes('unresolved role definitions')));
}
{
  const withLimited = normalizeAssignments([RA(3, 'C3 Owners', 'Full Control'), RA(15, 'C3 Operations', 'Limited Access')]);
  const { errors } = planMutations(withLimited, targets, roles, true);
  check('plan: Limited Access on a target blocks planning', errors.some(e => e.includes('Limited Access binding on target principal C3 Operations')));
}

// ── 4. Recovery planning (partial and terminal) ──────────────────────────────
{
  const partial = normalizeAssignments([
    RA(3, 'C3 Owners', 'Full Control'), RA(15, 'C3 Operations', 'Read'), RA(17, 'C3 Legal', 'Read'),
    RA(19, 'C3 Finance', 'Read'), RA(21, 'C3 Management', 'Read'), RA(4, 'C3 Visitors', 'Read'),
  ]);
  const s = planActionStrings(planMutations(partial, targets, roles, true).actions);
  check('recovery: partial state plans only the remaining removal', JSON.stringify(s) === JSON.stringify(['remove:C3 Visitors#4']));
  const terminal = planActionStrings(planMutations(exactAcl(), targets, roles, true).actions);
  check('recovery: completed state plans zero actions (terminal verification-only)', terminal.length === 0);
}

// ── 5. Frozen ACL fingerprint formula ────────────────────────────────────────
{
  const input = aclFingerprintInput([RA(5, 'C3 Members', 'Edit'), RA(3, 'C3 Owners', 'Full Control', 'Read')]);
  check('fingerprint: frozen PrincipalId|LoginName|sorted-roles sorted-lines formula', input === '3|C3 Owners|Full Control,Read\n5|C3 Members|Edit');
}

// ── 6. Non-ACL preservation dimensions ───────────────────────────────────────
const snap = (over = {}, listOver = {}) => ({
  list: { guid: 'g', title: 'C3Contracts', url: '/sites/C3/Lists/C3_Contracts', itemCount: 0, baseTemplate: 100, baseType: 0, contentTypesEnabled: false, enableVersioning: true, majorVersionLimit: 10, enableAttachments: false, listEtag: '"7"', ...listOver },
  schemaCompatibilityFingerprintSha256: 'S', fieldInventoryFingerprintSha256: 'F', uniqueChildScopes: [], inboundLookups: [], ...over,
});
check('preserve: identical snapshots → no drift', nonAclDrift(snap(), snap()).length === 0);
check('preserve: schema drift detected', nonAclDrift(snap(), snap({ schemaCompatibilityFingerprintSha256: 'X' })).join(',') === 'schema');
check('preserve: field inventory drift detected', nonAclDrift(snap(), snap({ fieldInventoryFingerprintSha256: 'X' })).join(',') === 'fieldInventory');
check('preserve: item appearance detected', nonAclDrift(snap(), snap({}, { itemCount: 1 })).join(',') === 'itemCount');
check('preserve: settings drift detected', nonAclDrift(snap(), snap({}, { majorVersionLimit: 50 })).join(',') === 'settings');
check('preserve: identity drift detected', nonAclDrift(snap(), snap({}, { url: '/sites/C3/Lists/Other' })).join(',') === 'url');
check('preserve: inbound dependency appearance detected', nonAclDrift(snap(), snap({ inboundLookups: ['x'] })).join(',') === 'inbound');
check('preserve: unique item scope appearance detected', nonAclDrift(snap(), snap({ uniqueChildScopes: [7] })).join(',') === 'scopes');
check('preserve: listEtag deliberately NOT a non-ACL invariant', nonAclDrift(snap(), snap({}, { listEtag: '"8"' })).length === 0);

// ── 7. Browser tooling mechanical discipline ─────────────────────────────────
const here = path.dirname(fileURLToPath(import.meta.url));
const coreSrc = readFileSync(path.join(here, 'phase3d', 'acl-plan-core.mjs'), 'utf8');
const d0 = readFileSync(path.join(here, 'phase3d', 'C3-3D0-Probe-C3Contracts-ACL.js'), 'utf8');
const d1 = readFileSync(path.join(here, 'phase3d', 'C3-3D1-Configure-C3Contracts-ACL.js'), 'utf8');
const region = (src, file) => {
  const b = src.indexOf('── 3D-CORE-BEGIN ──'); const e = src.indexOf('── 3D-CORE-END ──');
  if (b < 0 || e < 0) throw new Error(`3D core markers missing in ${file}`);
  return src.slice(src.indexOf('\n', b) + 1, src.lastIndexOf('\n', e));
};
check('sync: 3D-0 embeds the module core byte-identically', region(d0, '3D-0') === region(coreSrc, 'core'));
check('sync: 3D-1 embeds the module core byte-identically', region(d1, '3D-1') === region(coreSrc, 'core'));
check('discipline: no IF-MATCH anywhere in Phase 3D tooling (ACL endpoints expose no ETag semantics)', !d0.includes('IF-MATCH') && !d1.includes("'IF-MATCH'"));
check('discipline: no wildcard ETag anywhere', !d0.includes("'*'") || !/IF-MATCH.{0,10}\*/.test(d0 + d1));
check('discipline: clearSubscopes=true prohibited (locked S30 rev2 rule)',
  !/breakroleinheritance\([^)]*\)/.test(d0)
  && [...d1.matchAll(/breakroleinheritance\(([^)]*)\)/g)].length > 0
  && [...d1.matchAll(/breakroleinheritance\(([^)]*)\)/g)].every(m => m[1].includes('clearSubscopes=false') && m[1].includes('copyRoleAssignments=true')));
check('discipline: 3D-0 is GET-only (zero mutation surface)', !/X-RequestDigest|X-HTTP-Method|getDigest|method: 'POST'/.test(d0));
check('discipline: 3D-1 mutation classes are ACL-only (no field/schema/list-settings/item mutations)', !/createfieldasxml|\/recycle\(\)|'X-HTTP-Method': 'MERGE'/.test(d1)
  && d1.includes('breakroleinheritance(copyRoleAssignments=true, clearSubscopes=false)')
  && d1.includes('addroleassignment(principalid=') && d1.includes('removeroleassignment(principalid=')
  && d1.includes("getbyprincipalid(") && d1.includes("'X-HTTP-Method': 'DELETE'"));
check('discipline: 3D-1 has DRY_RUN=true default + separate recovery authorization', d1.includes('const DRY_RUN = true') && d1.includes('RECOVERY_PHRASE') && d1.includes('RECOVERY_CONFIRM'));
check('discipline: 3D-1 distinguishes NO MUTATION CONFIRMED from potentially committed', d1.includes('NO MUTATION CONFIRMED') && d1.includes('potentially committed'));
check('discipline: 3D-1 reconciliation failures route through reportPartial', d1.includes('Post-mutation reconciliation failed for') && d1.includes('Final 3D-1 verification failed after committed actions'));
check('discipline: grant-before-remove guard proves Owners FC on the current witness', d1.includes('Refusing ${actionString}: C3 Owners does not hold Full Control'));
check('discipline: administrative access re-proven before every mutation', d1.includes('assertAdminAccess') && d1.includes('EffectiveBasePermissions'));
check('discipline: terminal recovery is verification-only', d1.includes('TERMINAL RECOVERY: verification only — ZERO mutations were issued by this run.'));
check('discipline: 3D-1 stops before later phases', d1.includes('SEPARATE later phases'));
check('discipline: no tenant principal ids embedded in tooling (bound from probe evidence only)', !/principalid=\d/.test(d1) && d1.includes('EXPECTED_TARGET_PRINCIPALS = []'));

// ── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failures.length;
if (failures.length) {
  console.error(`s32-parity-acl-phase3d: ${passed}/${total} — FAILURES: ${failures.length}`);
  process.exit(1);
}
console.log(`s32-parity-acl-phase3d: ${passed}/${total} PASS`);
