/**
 * acl-plan-core.mjs — Sprint 32 Phase 3D pure ACL evaluation/planning core.
 *
 * This module is the single source of truth for Phase 3D ACL logic. The region
 * between the 3D-CORE-BEGIN / 3D-CORE-END markers is embedded BYTE-IDENTICALLY
 * in the owner-executed browser tooling (C3-3D0 / C3-3D1); the s32 parity
 * harness fails the gate if the copies drift.
 *
 * Environment-neutral: no imports, no fetch, no window. Pure data in/out.
 *
 * See: docs/architecture/C3 Contracts ACL — Sprint 32 Phase 3D.md
 */

// ── 3D-CORE-BEGIN ──
  /** Exact Phase 3D target: five principals, no extras. V1 authoring = Owners only. */
  const P3D_TARGET_GROUPS = Object.freeze([
    Object.freeze({ title: 'C3 Owners', role: 'Full Control' }),
    Object.freeze({ title: 'C3 Operations', role: 'Read' }),
    Object.freeze({ title: 'C3 Legal', role: 'Read' }),
    Object.freeze({ title: 'C3 Finance', role: 'Read' }),
    Object.freeze({ title: 'C3 Management', role: 'Read' }),
  ]);
  /** Groups that must NOT retain direct list access (detected as extras like any
   *  other non-target principal — listed here for explicit evidence reporting). */
  const P3D_FORBIDDEN_GROUPS = Object.freeze(['C3 HR', 'C3 Members', 'C3 Visitors']);
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
   *  single required binding, and nothing else. */
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
      .map(p => ({ principalId: p.principalId, title: p.title, bindings: p.bindings.map(b => b.name) }));
    const forbiddenPresent = extraPrincipals
      .filter(p => P3D_FORBIDDEN_GROUPS.includes(String(p.title ?? '').trim()))
      .map(p => p.title);
    const exact = missingTargets.length === 0 && wrongBindings.length === 0
      && extraPrincipals.length === 0 && limitedAccessOnTargets.length === 0
      && matchedTargets.length === resolvedTargets.length;
    return { exact, matchedTargets, missingTargets, wrongBindings, extraPrincipals, forbiddenPresent, limitedAccessOnTargets };
  };

  /** Deterministic mutation plan. Grant-before-remove, one mutation per action:
   *    1. break-inheritance(copy=true, clearSubscopes=false)   [only if inherited]
   *    2. grant:<title>#<pid>=<role>#<rid>                     [target order]
   *    3. revoke:<title>#<pid>-<role>#<rid>                    [extra bindings ON target principals]
   *    4. remove:<title>#<pid>                                 [whole non-target principals]
   *  Errors (never actions): Limited Access on a target principal; unresolved
   *  targets; any plan that would revoke the C3 Owners Full Control binding. */
  const planMutations = (normalized, resolvedTargets, roles, hasUniqueRoleAssignments) => {
    const errors = [];
    const actions = [];
    if (resolvedTargets.length !== P3D_TARGET_GROUPS.length) errors.push(`unresolved targets: ${resolvedTargets.length}/${P3D_TARGET_GROUPS.length} — refuse to plan`);
    if (!roles?.['Full Control'] || !roles?.Read) errors.push('unresolved role definitions — refuse to plan');
    if (errors.length) return { actions, errors };
    const byId = new Map(normalized.map(p => [p.principalId, p]));
    const targetIds = new Set(resolvedTargets.map(t => t.id));
    const owners = resolvedTargets[0];
    if (owners.title !== 'C3 Owners' || owners.role !== 'Full Control') errors.push('target[0] must be C3 Owners = Full Control');
    if (hasUniqueRoleAssignments === false) actions.push({ kind: 'break-inheritance', copyRoleAssignments: true, clearSubscopes: false });
    // Grants in fixed target order (Owners first — Full Control exists before any removal).
    for (const t of resolvedTargets) {
      const roleDef = roles[t.role];
      const p = byId.get(t.id);
      const has = p?.bindings.some(b => b.name === t.role) ?? false;
      if (!has) actions.push({ kind: 'grant', principalId: t.id, principalTitle: t.title, roleDefId: roleDef.id, roleName: t.role });
      if (p?.bindings.some(b => b.name === LIMITED_ACCESS)) errors.push(`Limited Access binding on target principal ${t.title} — owner review required; not plannable`);
    }
    // Revoke extra bindings on TARGET principals (sorted by title, then role name).
    const revokes = [];
    for (const t of resolvedTargets) {
      const p = byId.get(t.id);
      if (!p) continue;
      for (const b of p.bindings) {
        if (b.name === t.role || b.name === LIMITED_ACCESS) continue;
        revokes.push({ kind: 'revoke-binding', principalId: t.id, principalTitle: t.title, roleDefId: b.id, roleName: b.name });
      }
    }
    revokes.sort((x, y) => x.principalTitle.localeCompare(y.principalTitle) || x.roleName.localeCompare(y.roleName));
    actions.push(...revokes);
    // Remove whole NON-target principals (sorted by title, then id).
    const removes = normalized
      .filter(p => !targetIds.has(p.principalId))
      .map(p => ({ kind: 'remove-principal', principalId: p.principalId, principalTitle: p.title ?? String(p.principalId) }))
      .sort((x, y) => String(x.principalTitle).localeCompare(String(y.principalTitle)) || x.principalId - y.principalId);
    actions.push(...removes);
    // Invariant: the plan must NEVER revoke or remove the Owners Full Control binding.
    if (actions.some(a => (a.kind === 'revoke-binding' && a.principalId === owners.id && a.roleName === 'Full Control') || (a.kind === 'remove-principal' && a.principalId === owners.id)))
      errors.push('INVARIANT VIOLATION: plan would revoke/remove C3 Owners Full Control — refuse to plan');
    return { actions, errors };
  };

  /** Deterministic string form of a plan (for evidence binding and recovery). */
  const planActionStrings = (actions) => actions.map(a =>
    a.kind === 'break-inheritance' ? 'break-inheritance(copy=true,clearSubscopes=false)'
      : a.kind === 'grant' ? `grant:${a.principalTitle}#${a.principalId}=${a.roleName}#${a.roleDefId}`
      : a.kind === 'revoke-binding' ? `revoke:${a.principalTitle}#${a.principalId}-${a.roleName}#${a.roleDefId}`
      : `remove:${a.principalTitle}#${a.principalId}`);

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
  planMutations,
  planActionStrings,
  nonAclDrift,
};
