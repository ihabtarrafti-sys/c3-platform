/**
 * s32-parity-acl-phase3d.mjs — Sprint 32 Phase 3D ACL planning parity harness (rev 2).
 *
 * Tests the REAL pure core (scripts/phase3d/acl-plan-core.mjs) and mechanically
 * verifies the owner-executed browser tooling (C3-3D0 / C3-3D1):
 *   - C3 Platform Owners title resolution; the associated site-shell Owners group
 *     is never accepted as the operational target
 *   - exact five-principal ACL evaluation; Platform Owners Full Control + four Reads
 *   - rejection of missing / duplicate / wrong-type groups and role definitions
 *   - detection of site-shell Owners/Members/Visitors, HR, and individual extras
 *   - Legal inherited Full Control corrected to Read (wrong-binding detection)
 *   - normal plan: break(copy=false, clearSubscopes=false) → five grants (Platform
 *     Owners first) → conditional acting-user removal; NO revoke actions ever
 *   - prohibition of copyRoleAssignments=true and clearSubscopes=true
 *   - recovery from partial unique-permission states; fail-closed on unexpected
 *     Limited Access / ambiguous bindings / stranger principals; terminal empty plan
 *   - no final Limited Access bindings in the exact-five result
 *   - frozen ACL fingerprint formula and non-ACL preservation dimensions
 *   - wildcard-ETag prohibition and mutation-class discipline in the tooling
 *   - byte-identical 3D core embedded in both browser scripts
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  P3D_TARGET_GROUPS, resolvePrincipals, resolveRoleDefinitions, normalizeAssignments,
  aclFingerprintInput, evaluateAcl, actingUserAssignment,
  planNormalMutations, planRecoveryMutations, planActionStrings, nonAclDrift,
} from './phase3d/acl-plan-core.mjs';

let passed = 0; const failures = [];
const check = (name, cond) => { if (cond) { passed++; } else { failures.push(name); console.error(`✖ ${name}`); } };

// ── Fixtures (shaped like the reviewed 3D-0 hosted evidence; ids are fixture
//    values — the tooling itself never hard-codes tenant ids) ─────────────────
const G = (Id, Title, PrincipalType = 8) => ({ Id, Title, LoginName: Title, PrincipalType });
const groups = () => [
  G(19, 'C3 Platform Owners'), G(3, 'C3 - Contract Command Center Owners'),
  G(5, 'C3 - Contract Command Center Members'), G(4, 'C3 - Contract Command Center Visitors'),
  G(15, 'C3 Operations'), G(17, 'C3 Legal'), G(20, 'C3 Finance'), G(21, 'C3 Management'), G(23, 'C3 HR'),
];
const roleDefs = () => [{ Id: 1073741829, Name: 'Full Control' }, { Id: 1073741826, Name: 'Read' }, { Id: 1073741830, Name: 'Edit' }, { Id: 1073741825, Name: 'Limited Access' }];
const DEF_ID = Object.fromEntries(roleDefs().map(r => [r.Name, r.Id]));
const RA = (pid, title, type, ...names) => ({ PrincipalId: pid, Member: { Id: pid, Title: title, LoginName: title, PrincipalType: type }, RoleDefinitionBindings: names.map(n => ({ Id: DEF_ID[n], Name: n })) });
const RAG = (pid, title, ...names) => RA(pid, title, 8, ...names);
const actingUser = { id: 11, title: 'Ihab Tarrafti' };
const exactAcl = () => normalizeAssignments([RAG(19, 'C3 Platform Owners', 'Full Control'), RAG(15, 'C3 Operations', 'Read'), RAG(17, 'C3 Legal', 'Read'), RAG(20, 'C3 Finance', 'Read'), RAG(21, 'C3 Management', 'Read')]);
const { resolved: targets, errors: resolveErrors } = resolvePrincipals(groups());
const { roles, errors: roleErrors } = resolveRoleDefinitions(roleDefs());

// ── 1. Principal resolution ──────────────────────────────────────────────────
check('resolution: five targets resolve cleanly', resolveErrors.length === 0 && targets.length === 5);
check('resolution: C3 Platform Owners resolved by exact hosted title', targets[0].title === 'C3 Platform Owners' && targets[0].id === 19 && targets[0].role === 'Full Control');
check('resolution: target order preserved (Platform Owners first)', targets.map(t => t.title).join(',') === P3D_TARGET_GROUPS.map(t => t.title).join(','));
{
  const shellOnly = groups().filter(g => g.Title !== 'C3 Platform Owners');
  const { resolved, errors } = resolvePrincipals(shellOnly);
  check('resolution: associated site-shell Owners group is NEVER accepted as the operational target', errors.some(e => e.includes('missing required group: C3 Platform Owners')) && !resolved.some(t => t.title === 'C3 Platform Owners'));
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
  const ev = evaluateAcl(normalizeAssignments([RAG(19, 'C3 Platform Owners', 'Read'), RAG(15, 'C3 Operations', 'Read'), RAG(17, 'C3 Legal', 'Read'), RAG(20, 'C3 Finance', 'Read'), RAG(21, 'C3 Management', 'Read')]), targets);
  check('evaluate: Platform Owners must hold Full Control', ev.exact === false && ev.wrongBindings.some(w => w.title === 'C3 Platform Owners' && w.expected === 'Full Control'));
}
{
  const ev = evaluateAcl(normalizeAssignments([RAG(19, 'C3 Platform Owners', 'Full Control'), RAG(15, 'C3 Operations', 'Read'), RAG(17, 'C3 Legal', 'Full Control'), RAG(20, 'C3 Finance', 'Read'), RAG(21, 'C3 Management', 'Read')]), targets);
  check('evaluate: Legal Full Control must be corrected to Read', ev.exact === false && ev.wrongBindings.some(w => w.title === 'C3 Legal' && w.actual.includes('Full Control')));
}
{
  const ev = evaluateAcl(normalizeAssignments([RAG(19, 'C3 Platform Owners', 'Full Control'), RAG(15, 'C3 Operations', 'Edit'), RAG(17, 'C3 Legal', 'Read'), RAG(20, 'C3 Finance', 'Read'), RAG(21, 'C3 Management', 'Read')]), targets);
  check('evaluate: four Read assignments required (Edit rejected)', ev.exact === false && ev.wrongBindings.some(w => w.title === 'C3 Operations' && w.actual.includes('Edit')));
}
{
  const ev = evaluateAcl(normalizeAssignments([RAG(19, 'C3 Platform Owners', 'Full Control'), RAG(15, 'C3 Operations', 'Read'), RAG(17, 'C3 Legal', 'Read'), RAG(20, 'C3 Finance', 'Read')]), targets);
  check('evaluate: missing target detected', ev.exact === false && ev.missingTargets.includes('C3 Management'));
}
{
  const ev = evaluateAcl(normalizeAssignments([
    ...[RAG(19, 'C3 Platform Owners', 'Full Control'), RAG(15, 'C3 Operations', 'Read'), RAG(17, 'C3 Legal', 'Read'), RAG(20, 'C3 Finance', 'Read'), RAG(21, 'C3 Management', 'Read')],
    RAG(3, 'C3 - Contract Command Center Owners', 'Full Control'), RAG(5, 'C3 - Contract Command Center Members', 'Edit'),
    RAG(4, 'C3 - Contract Command Center Visitors', 'Read'), RAG(23, 'C3 HR', 'Read'), RA(11, 'Ihab Tarrafti', 1, 'Full Control'),
  ]), targets);
  check('evaluate: actual hosted site-shell Owners/Members/Visitors + HR reported as forbidden extras', ev.forbiddenPresent.length === 4 && ['C3 - Contract Command Center Owners', 'C3 - Contract Command Center Members', 'C3 - Contract Command Center Visitors', 'C3 HR'].every(t => ev.forbiddenPresent.includes(t)));
  check('evaluate: individual acting-user principal detected as an extra', ev.extraPrincipals.some(p => p.title === 'Ihab Tarrafti' && p.principalType === 1) && ev.exact === false);
}
{
  const ev = evaluateAcl(normalizeAssignments([RAG(19, 'C3 Platform Owners', 'Full Control', 'Limited Access'), RAG(15, 'C3 Operations', 'Read'), RAG(17, 'C3 Legal', 'Read'), RAG(20, 'C3 Finance', 'Read'), RAG(21, 'C3 Management', 'Read')]), targets);
  check('evaluate: NO final Limited Access binding allowed on a target', ev.exact === false && ev.limitedAccessOnTargets.includes('C3 Platform Owners'));
}

// ── 3. Normal-mode plan (rev-2 uncopied break) ───────────────────────────────
{
  const { actions, errors } = planNormalMutations(targets, roles, actingUser);
  const s = planActionStrings(actions);
  check('normal plan: no errors', errors.length === 0);
  check('normal plan: exact deterministic sequence (break → Owners FC → four Reads → acting-user removal)', JSON.stringify(s) === JSON.stringify([
    'break-inheritance(copy=false,clearSubscopes=false)',
    `grant:C3 Platform Owners#19=Full Control#${DEF_ID['Full Control']}`,
    `grant:C3 Operations#15=Read#${DEF_ID.Read}`,
    `grant:C3 Legal#17=Read#${DEF_ID.Read}`,
    `grant:C3 Finance#20=Read#${DEF_ID.Read}`,
    `grant:C3 Management#21=Read#${DEF_ID.Read}`,
    'remove-acting-user:Ihab Tarrafti#11',
  ]));
  check('normal plan: break uses copyRoleAssignments=false', actions[0].copyRoleAssignments === false && actions[0].clearSubscopes === false);
  check('normal plan: Platform Owners grant precedes every other grant and the acting-user removal', s.indexOf('grant:C3 Platform Owners#19=Full Control#1073741829') === 1 && s.indexOf('remove-acting-user:Ihab Tarrafti#11') === s.length - 1);
  check('normal plan: NO revoke actions for inherited bindings (inherited ACL is discarded)', s.every(x => !x.startsWith('revoke:')));
  check('normal plan: acting-user removal is modeled explicitly and conditional', actions[s.length - 1].kind === 'remove-acting-user' && actions[s.length - 1].conditional === true);
  check('normal plan: deterministic (identical inputs → identical strings)', JSON.stringify(s) === JSON.stringify(planActionStrings(planNormalMutations(targets, roles, actingUser).actions)));
}
{
  const { errors } = planNormalMutations(targets, roles, { id: 19, title: 'collides' });
  check('normal plan: executing-user id colliding with a target refuses to plan', errors.some(e => e.includes('collides with a target principal')));
}
{
  const { errors } = planNormalMutations(targets.slice(0, 4), roles, actingUser);
  check('normal plan: refuses with unresolved targets', errors.some(e => e.includes('unresolved targets')));
}
{
  const { errors } = planNormalMutations(targets, { Read: roles.Read }, actingUser);
  check('normal plan: refuses with unresolved role definitions', errors.some(e => e.includes('unresolved role definitions')));
}
{
  const { errors } = planNormalMutations(targets, roles, null);
  check('normal plan: refuses with unresolved executing user', errors.some(e => e.includes('executing user unresolved')));
}

// ── 4. Recovery-mode planning from live partial unique states ────────────────
{
  const s = planActionStrings(planRecoveryMutations(exactAcl(), targets, roles, false, actingUser).actions);
  check('recovery: inherited state (nothing committed) → full normal plan', s[0] === 'break-inheritance(copy=false,clearSubscopes=false)' && s.length === 7);
}
{
  const afterBreak = normalizeAssignments([RA(11, 'Ihab Tarrafti', 1, 'Full Control')]);
  const { actions, errors } = planRecoveryMutations(afterBreak, targets, roles, true, actingUser);
  const s = planActionStrings(actions);
  check('recovery: acting-user-only state → five grants then acting-user removal', errors.length === 0 && s.length === 6 && s[0].startsWith('grant:C3 Platform Owners#') && s[5] === 'remove-acting-user:Ihab Tarrafti#11');
}
{
  const partial = normalizeAssignments([RA(11, 'Ihab Tarrafti', 1, 'Full Control'), RAG(19, 'C3 Platform Owners', 'Full Control')]);
  const s = planActionStrings(planRecoveryMutations(partial, targets, roles, true, actingUser).actions);
  check('recovery: Owners-granted partial state → four Reads in fixed order + acting-user removal', JSON.stringify(s) === JSON.stringify([
    `grant:C3 Operations#15=Read#${DEF_ID.Read}`, `grant:C3 Legal#17=Read#${DEF_ID.Read}`,
    `grant:C3 Finance#20=Read#${DEF_ID.Read}`, `grant:C3 Management#21=Read#${DEF_ID.Read}`,
    'remove-acting-user:Ihab Tarrafti#11',
  ]));
}
{
  const s = planActionStrings(planRecoveryMutations(exactAcl(), targets, roles, true, actingUser).actions);
  check('recovery: exact-five state → terminal empty plan (verification only)', s.length === 0);
}
{
  const fiveAndActing = normalizeAssignments([RA(11, 'Ihab Tarrafti', 1, 'Full Control'), RAG(19, 'C3 Platform Owners', 'Full Control'), RAG(15, 'C3 Operations', 'Read'), RAG(17, 'C3 Legal', 'Read'), RAG(20, 'C3 Finance', 'Read'), RAG(21, 'C3 Management', 'Read')]);
  const s = planActionStrings(planRecoveryMutations(fiveAndActing, targets, roles, true, actingUser).actions);
  check('recovery: five-granted state → only the acting-user removal remains', JSON.stringify(s) === JSON.stringify(['remove-acting-user:Ihab Tarrafti#11']));
}
{
  const odd = normalizeAssignments([RAG(19, 'C3 Platform Owners', 'Full Control'), RAG(17, 'C3 Legal', 'Full Control')]);
  const { actions, errors } = planRecoveryMutations(odd, targets, roles, true, actingUser);
  check('recovery: unexpected direct binding on a target fails closed (zero actions)', errors.some(e => e.includes('unexpected/ambiguous direct binding(s) on target C3 Legal')) && actions.length === 0);
}
{
  const withLimited = normalizeAssignments([RAG(19, 'C3 Platform Owners', 'Full Control', 'Limited Access')]);
  const { actions, errors } = planRecoveryMutations(withLimited, targets, roles, true, actingUser);
  check('recovery: unexpected direct Limited Access fails closed (zero actions)', errors.some(e => e.includes('unexpected direct Limited Access binding')) && actions.length === 0);
}
{
  const stranger = normalizeAssignments([RAG(19, 'C3 Platform Owners', 'Full Control'), RAG(23, 'C3 HR', 'Read')]);
  const { actions, errors } = planRecoveryMutations(stranger, targets, roles, true, actingUser);
  check('recovery: unexpected non-target principal fails closed (zero actions)', errors.some(e => e.includes('unexpected non-target direct principal C3 HR')) && actions.length === 0);
}
check('recovery: actingUserAssignment finds/misses the acting principal', actingUserAssignment(normalizeAssignments([RA(11, 'Ihab Tarrafti', 1, 'Full Control')]), 11) !== null && actingUserAssignment(exactAcl(), 11) === null);

// ── 5. Frozen ACL fingerprint formula ────────────────────────────────────────
{
  const input = aclFingerprintInput([RAG(5, 'C3 - Contract Command Center Members', 'Edit'), RAG(19, 'C3 Platform Owners', 'Full Control', 'Read')]);
  check('fingerprint: frozen PrincipalId|LoginName|sorted-roles sorted-lines formula', input === '19|C3 Platform Owners|Full Control,Read\n5|C3 - Contract Command Center Members|Edit');
}

// ── 6. Non-ACL preservation dimensions ───────────────────────────────────────
const snap = (over = {}, listOver = {}) => ({
  list: { guid: 'g', title: 'C3Contracts', url: '/sites/C3/Lists/C3_Contracts', itemCount: 0, baseTemplate: 100, baseType: 0, contentTypesEnabled: false, enableVersioning: true, majorVersionLimit: 10, enableAttachments: false, listEtag: '"255"', ...listOver },
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
check('preserve: listEtag deliberately NOT a non-ACL invariant', nonAclDrift(snap(), snap({}, { listEtag: '"256"' })).length === 0);

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
check('discipline: no wildcard ETag header anywhere', !d0.includes("'IF-MATCH': '*'") && !d1.includes("'IF-MATCH': '*'") && !d0.includes('"IF-MATCH": "*"') && !d1.includes('"IF-MATCH": "*"'));
{
  // Call-argument form only (prohibition COMMENTS legitimately name the banned values).
  const calls = [...d1.matchAll(/breakroleinheritance\(copyRoleAssignments=(\w+), clearSubscopes=(\w+)\)/g)];
  check('discipline: 3D-1 breaks inheritance ONLY with copyRoleAssignments=false, clearSubscopes=false', calls.length === 1 && calls[0][1] === 'false' && calls[0][2] === 'false');
  check('discipline: copyRoleAssignments=true prohibited everywhere (call form)', !/copyRoleAssignments=true[,)]/.test(d0) && !/copyRoleAssignments=true[,)]/.test(d1));
  check('discipline: clearSubscopes=true prohibited everywhere (call form)', !/clearSubscopes=true[,)]/.test(d0) && !/clearSubscopes=true[,)]/.test(d1));
}
check('discipline: 3D-0 is GET-only (zero mutation surface)', !/X-RequestDigest|X-HTTP-Method|getDigest|method: 'POST'/.test(d0));
check('discipline: 3D-1 mutation classes are ACL-only (break/grant/acting-user removal; no binding revokes, no field/item/settings mutations)', !/createfieldasxml|\/recycle\(\)|'X-HTTP-Method': 'MERGE'|removeroleassignment\(/.test(d1)
  && d1.includes('addroleassignment(principalid=') && d1.includes('getbyprincipalid(') && d1.includes("'X-HTTP-Method': 'DELETE'"));
check('discipline: acting-user removal guarded (distinct principal + Platform Owners FC + admin authority) with skip-when-absent', d1.includes('remove-acting-user')
  && d1.includes('Refusing ${actionString}: C3 Platform Owners does not hold Full Control')
  && d1.includes('acting principal collides with a target principal')
  && d1.includes('would lose administrative access')
  && d1.includes('no acting-user assignment present — nothing to remove'));
check('discipline: executing user bound to reviewed 3D-0 evidence', d1.includes('EXPECTED_EXECUTING_USER_ID') && d1.includes('the SAME administrator must run 3D-1'));
check('discipline: 3D-1 has DRY_RUN=true default + separate recovery authorization', d1.includes('const DRY_RUN = true') && d1.includes('RECOVERY_PHRASE') && d1.includes('RECOVERY_CONFIRM'));
check('discipline: 3D-1 distinguishes NO MUTATION CONFIRMED from potentially committed', d1.includes('NO MUTATION CONFIRMED') && d1.includes('potentially committed'));
check('discipline: reconciliation failures route through reportPartial with fresh recovery evidence', d1.includes('Post-mutation reconciliation failed for') && d1.includes('Final 3D-1 verification failed after committed actions') && d1.includes('EXPECTED_RECOVERY_ACL_FP ='));
check('discipline: administrative access re-proven before and after every mutation', d1.includes('assertAdminAccess') && d1.includes('EffectiveBasePermissions'));
check('discipline: terminal recovery is verification-only', d1.includes('TERMINAL RECOVERY: verification only — ZERO mutations were issued by this run.'));
check('discipline: 3D-1 stops before later phases', d1.includes('SEPARATE later phases'));
check('discipline: no tenant principal ids embedded (bound from probe evidence only)', !/principalid=\d/.test(d1) && d1.includes('EXPECTED_TARGET_PRINCIPALS = []') && d1.includes('EXPECTED_EXECUTING_USER_ID = 0'));
check('discipline: probe rejects Platform Owners resolving to the associated site-shell Owners group', d0.includes('ASSOCIATED site-shell Owners group'));

// ── Summary ──────────────────────────────────────────────────────────────────
const total = passed + failures.length;
if (failures.length) {
  console.error(`s32-parity-acl-phase3d: ${passed}/${total} — FAILURES: ${failures.length}`);
  process.exit(1);
}
console.log(`s32-parity-acl-phase3d: ${passed}/${total} PASS`);
