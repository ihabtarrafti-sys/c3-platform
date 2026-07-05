/**
 * acl-plan-core.mjs — Sprint 32 Phase 3D pure ACL evaluation/planning core (rev 2).
 *
 * This module is the single source of truth for Phase 3D ACL logic. The region
 * between the 3D-CORE-BEGIN / 3D-CORE-END markers is embedded BYTE-IDENTICALLY
 * in the owner-executed browser tooling (C3-3D0 / C3-3D1); the s32 parity
 * harness fails the gate if the copies drift.
 *
 * rev 2 (2026-07-05, after reviewed 3D-0 hosted evidence):
 *  - operational owner principal is `C3 Platform Owners` (resolved by exact hosted
 *    title, never by hard-coded id); `C3 - Contract Command Center Owners` is the
 *    associated site-shell Owners group and is NOT the operational target;
 *  - inheritance break uses the proven Sprint 32 rev-2 method
 *    breakroleinheritance(copyRoleAssignments=false, clearSubscopes=false) — the
 *    inherited ACL is NOT copied (it carries Limited Access on all relevant
 *    principals, Legal Full Control, multi-binding Platform Owners, site-shell
 *    groups, HR, and an individual acting user — copying would create unproven
 *    Limited Access cleanup); clearSubscopes=true remains PROHIBITED;
 *  - the temporary acting-user assignment SharePoint creates on an uncopied break
 *    is modeled EXPLICITLY and removed only after Platform Owners Full Control is
 *    proven and administrative access is preserved.
 *
 * Environment-neutral: no imports, no fetch, no window. Pure data in/out.
 *
 * See: docs/architecture/C3 Contracts ACL — Sprint 32 Phase 3D.md
 */

// ── 3D-CORE-BEGIN ──
  /** Exact Phase 3D target: five principals, no extras. V1 authoring = Owners only. */
  const P3D_TARGET_GROUPS = Object.freeze([
    Object.freeze({ title: 'C3 Platform Owners', role: 'Full Control' }),
    Object.freeze({ title: 'C3 Operations', role: 'Read' }),
    Object.freeze({ title: 'C3 Legal', role: 'Read' }),
    Object.freeze({ title: 'C3 Finance', role: 'Read' }),
    Object.freeze({ title: 'C3 Management', role: 'Read' }),
  ]);
  /** Hosted principals that must NOT retain direct list access — the ACTUAL
   *  associated site-shell group titles (hosted-resolved 2026-07-05) plus HR.
   *  Individual users (e.g. the acting administrator) are reported through the
   *  generic extras detection like any other non-target principal. */
  const P3D_FORBIDDEN_GROUPS = Object.freeze([
    'C3 - Contract Command Center Owners',
    'C3 - Contract Command Center Members',
    'C3 - Contract Command Center Visitors',
    'C3 HR',
  ]);
  const SP_PRINCIPAL_TYPE_SHAREPOINT_GROUP = 8;
  const LIMITED_ACCESS = 'Limited Access';

  /** Resolve the five target groups against the live site-group inventory.
   *  Fails (error entries) on missing, duplicate/ambiguous, or non-group principals.
   *  Never resolves by assumption — only by exact trimmed live Title. */
  const resolvePrincipals = (siteGroups, targetGroups = P3D_TARGET_GROUPS) => {
    const errors = [];
    const resolved = [];
    for (const t of targetGroups) {
      const matches = (siteGroups ?? []).filter(g => String(g.Title ?? '').trim() === t.title);
      if (matches.length === 0) { errors.push(`missing required group: ${t.title}`); continue; }
      if (matches.length > 1) { errors.push(`duplicate/ambiguous group title: ${t.title} (ids ${matches.map(m => m.Id).join(', ')})`); continue; }
      const g = matches[0];
      if (g.PrincipalType !== SP_PRINCIPAL_TYPE_SHAREPOINT_GROUP) { errors.push(`unexpected principal type for ${t.title}: ${g.PrincipalType} (expected SharePoint group = ${SP_PRINCIPAL_TYPE_SHAREPOINT_GROUP})`); continue; }
      if (!Number.isInteger(g.Id) || g.Id <= 0) { errors.push(`unresolvable principal id for ${t.title}: ${g.Id}`); continue; }
      resolved.push({ title: t.title, role: t.role, id: g.Id, loginName: g.LoginName ?? null, principalType: g.PrincipalType });
    }
    return { resolved, errors };
  };

  /** Resolve 'Full Control' and 'Read' role definitions by exact live Name.
   *  Fails on missing or duplicate definitions. */
  const resolveRoleDefinitions = (roleDefinitions) => {
    const errors = [];
    const roles = {};
    for (const name of ['Full Control', 'Read']) {
      const matches = (roleDefinitions ?? []).filter(r => String(r.Name ?? '').trim() === name);
      if (matches.length === 0) { errors.push(`missing role definition: ${name}`); continue; }
      if (matches.length > 1) { errors.push(`duplicate role definition name: ${name} (ids ${matches.map(m => m.Id).join(', ')})`); continue; }
      roles[name] = { id: matches[0].Id, name };
    }
    return { roles, errors };
  };

  /** Normalize expanded SharePoint role assignments to a deterministic shape:
   *  [{ principalId, title, loginName, principalType, bindings: [{id, name}] }]
   *  sorted by principalId; bindings sorted by name then id. */
  const normalizeAssignments = (roleAssignments) =>
    (roleAssignments ?? []).map(a => ({
      principalId: a.PrincipalId,
      title: a.Member?.Title ?? null,
      loginName: a.Member?.LoginName ?? null,
      principalType: a.Member?.PrincipalType ?? null,
      bindings: (a.RoleDefinitionBindings ?? [])
        .map(b => ({ id: b.Id, name: String(b.Name ?? '').trim() }))
        .sort((x, y) => x.name.localeCompare(y.name) || x.id - y.id),
    })).sort((x, y) => x.principalId - y.principalId);

  /** Frozen ACL fingerprint input (formula identical to the Phase 3C snapshot
   *  fingerprint): PrincipalId|LoginName-or-Title|sorted-role-names, sorted lines. */
  const aclFingerprintInput = (roleAssignments) =>
    (roleAssignments ?? []).map(a => `${a.PrincipalId}|${a.Member?.LoginName ?? a.Member?.Title ?? ''}|${(a.RoleDefinitionBindings ?? []).map(r => r.Name).sort().join(',')}`).sort().join('\n');

  /** Evaluate a normalized ACL against the resolved five-principal target.
   *  exact === true ⇔ exactly the five target principals, each with exactly its
   *  single required binding, no Limited Access, and nothing else. */
  const evaluateAcl = (normalized, resolvedTargets) => {
    const byId = new Map(normalized.map(p => [p.principalId, p]));
    const targetIds = new Set(resolvedTargets.map(t => t.id));
    const matchedTargets = [];
    const missingTargets = [];
    const wrongBindings = [];
    const limitedAccessOnTargets = [];
    for (const t of resolvedTargets) {
      const p = byId.get(t.id);
      if (!p) { missingTargets.push(t.title); continue; }
      if (p.bindings.some(b => b.name === LIMITED_ACCESS)) limitedAccessOnTargets.push(t.title);
      const nonLimited = p.bindings.filter(b => b.name !== LIMITED_ACCESS);
      if (nonLimited.length === 1 && nonLimited[0].name === t.role) matchedTargets.push(t.title);
      else wrongBindings.push({ title: t.title, expected: t.role, actual: nonLimited.map(b => b.name) });
    }
    const extraPrincipals = normalized
      .filter(p => !targetIds.has(p.principalId))
      .map(p => ({ principalId: p.principalId, title: p.title, principalType: p.principalType, bindings: p.bindings.map(b => b.name) }));
    const forbiddenPresent = extraPrincipals
      .filter(p => P3D_FORBIDDEN_GROUPS.includes(String(p.title ?? '').trim()))
      .map(p => p.title);
    const exact = missingTargets.length === 0 && wrongBindings.length === 0
      && extraPrincipals.length === 0 && limitedAccessOnTargets.length === 0
      && matchedTargets.length === resolvedTargets.length;
    return { exact, matchedTargets, missingTargets, wrongBindings, extraPrincipals, forbiddenPresent, limitedAccessOnTargets };
  };

  /** The temporary assignment SharePoint may create for the acting administrator
   *  when inheritance is broken WITHOUT copying. Null when absent. */
  const actingUserAssignment = (normalized, executingUserId) =>
    (normalized ?? []).find(p => p.principalId === executingUserId) ?? null;

  /** Shared planner preconditions. Returns error strings (empty = plannable). */
  const planPreconditions = (resolvedTargets, roles, executingUser) => {
    const errors = [];
    if (resolvedTargets.length !== P3D_TARGET_GROUPS.length) errors.push(`unresolved targets: ${resolvedTargets.length}/${P3D_TARGET_GROUPS.length} — refuse to plan`);
    if (!roles?.['Full Control'] || !roles?.Read) errors.push('unresolved role definitions — refuse to plan');
    if (!executingUser || !Number.isInteger(executingUser.id) || executingUser.id <= 0) errors.push('executing user unresolved — refuse to plan');
    if (!errors.length && resolvedTargets.some(t => t.id === executingUser.id)) errors.push('executing user principal id collides with a target principal — refuse to plan');
    if (!errors.length && (resolvedTargets[0].title !== 'C3 Platform Owners' || resolvedTargets[0].role !== 'Full Control')) errors.push('target[0] must be C3 Platform Owners = Full Control');
    return errors;
  };

  /** NORMAL-MODE deterministic plan (proven Sprint 32 rev-2 method):
   *    1. break-inheritance(copy=false, clearSubscopes=false) — the inherited ACL
   *       (Limited Access everywhere, Legal Full Control, multi-binding Platform
   *       Owners, site-shell groups, HR, individual users) is DISCARDED, never
   *       copied; no revoke actions are ever generated for inherited bindings.
   *    2. grant C3 Platform Owners Full Control (verified before any removal).
   *    3. grant Read to Operations, Legal, Finance, Management in fixed order.
   *    4. remove the temporary acting-user assignment (conditional: only when it
   *       exists as a principal distinct from every target). */
  const planNormalMutations = (resolvedTargets, roles, executingUser) => {
    const errors = planPreconditions(resolvedTargets, roles, executingUser);
    const actions = [];
    if (errors.length) return { actions, errors };
    actions.push({ kind: 'break-inheritance', copyRoleAssignments: false, clearSubscopes: false });
    for (const t of resolvedTargets) actions.push({ kind: 'grant', principalId: t.id, principalTitle: t.title, roleDefId: roles[t.role].id, roleName: t.role });
    actions.push({ kind: 'remove-acting-user', principalId: executingUser.id, principalTitle: executingUser.title ?? String(executingUser.id), conditional: true });
    return { actions, errors };
  };

  /** RECOVERY-MODE plan from LIVE direct assignments after a partial run.
   *  Fails closed (errors, zero actions) on: any direct Limited Access binding,
   *  any unexpected direct binding on a target, or any non-target direct
   *  principal other than the acting user. Otherwise plans the missing grants in
   *  fixed target order plus the conditional acting-user removal. An empty plan
   *  is the terminal verification-only state. */
  const planRecoveryMutations = (normalized, resolvedTargets, roles, hasUniqueRoleAssignments, executingUser) => {
    const errors = planPreconditions(resolvedTargets, roles, executingUser);
    if (errors.length) return { actions: [], errors };
    if (hasUniqueRoleAssignments === false) return planNormalMutations(resolvedTargets, roles, executingUser); // nothing committed yet
    const actions = [];
    const byId = new Map(normalized.map(p => [p.principalId, p]));
    const targetIds = new Set(resolvedTargets.map(t => t.id));
    for (const p of normalized) {
      if (p.bindings.some(b => b.name === LIMITED_ACCESS)) errors.push(`unexpected direct Limited Access binding on ${p.title ?? p.principalId} — owner review required`);
    }
    for (const t of resolvedTargets) {
      const p = byId.get(t.id);
      const nonLimited = p ? p.bindings.filter(b => b.name !== LIMITED_ACCESS) : [];
      const unexpected = nonLimited.filter(b => b.name !== t.role);
      if (unexpected.length) errors.push(`unexpected/ambiguous direct binding(s) on target ${t.title}: ${unexpected.map(b => b.name).join(', ')} — owner review required`);
      if (!nonLimited.some(b => b.name === t.role)) actions.push({ kind: 'grant', principalId: t.id, principalTitle: t.title, roleDefId: roles[t.role].id, roleName: t.role });
    }
    for (const p of normalized) {
      if (!targetIds.has(p.principalId) && p.principalId !== executingUser.id)
        errors.push(`unexpected non-target direct principal ${p.title ?? p.principalId} (#${p.principalId}) — owner review required`);
    }
    if (actingUserAssignment(normalized, executingUser.id)) actions.push({ kind: 'remove-acting-user', principalId: executingUser.id, principalTitle: executingUser.title ?? String(executingUser.id), conditional: true });
    if (errors.length) return { actions: [], errors };
    return { actions, errors };
  };

  /** Deterministic string form of a plan (for evidence binding and recovery). */
  const planActionStrings = (actions) => actions.map(a =>
    a.kind === 'break-inheritance' ? 'break-inheritance(copy=false,clearSubscopes=false)'
      : a.kind === 'grant' ? `grant:${a.principalTitle}#${a.principalId}=${a.roleName}#${a.roleDefId}`
      : `remove-acting-user:${a.principalTitle}#${a.principalId}`);

  /** Non-ACL dimensions that NO Phase 3D mutation may change. Returns drifted keys.
   *  listEtag is deliberately excluded — role-assignment mutations may or may not
   *  advance it, and ACL endpoints expose no ETag semantics in this tenant. */
  const nonAclDrift = (a, b) => {
    const dims = {
      guid: [a.list.guid, b.list.guid], title: [a.list.title, b.list.title], url: [a.list.url, b.list.url],
      itemCount: [a.list.itemCount, b.list.itemCount],
      settings: [JSON.stringify([a.list.baseTemplate, a.list.baseType, a.list.contentTypesEnabled, a.list.enableVersioning, a.list.majorVersionLimit, a.list.enableAttachments]),
        JSON.stringify([b.list.baseTemplate, b.list.baseType, b.list.contentTypesEnabled, b.list.enableVersioning, b.list.majorVersionLimit, b.list.enableAttachments])],
      schema: [a.schemaCompatibilityFingerprintSha256, b.schemaCompatibilityFingerprintSha256],
      fieldInventory: [a.fieldInventoryFingerprintSha256, b.fieldInventoryFingerprintSha256],
      scopes: [JSON.stringify(a.uniqueChildScopes), JSON.stringify(b.uniqueChildScopes)],
      inbound: [JSON.stringify(a.inboundLookups), JSON.stringify(b.inboundLookups)],
    };
    return Object.entries(dims).filter(([, [x, y]]) => x !== y).map(([k]) => k);
  };
// ── 3D-CORE-END ──

export {
  P3D_TARGET_GROUPS,
  P3D_FORBIDDEN_GROUPS,
  SP_PRINCIPAL_TYPE_SHAREPOINT_GROUP,
  LIMITED_ACCESS,
  resolvePrincipals,
  resolveRoleDefinitions,
  normalizeAssignments,
  aclFingerprintInput,
  evaluateAcl,
  actingUserAssignment,
  planNormalMutations,
  planRecoveryMutations,
  planActionStrings,
  nonAclDrift,
};
