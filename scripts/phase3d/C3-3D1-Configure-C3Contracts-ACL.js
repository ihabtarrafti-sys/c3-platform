(async () => {
  'use strict';
  // ═══ C3 S32 · 3D-1 rev1 — CONFIGURE C3Contracts exact five-principal ACL ═══
  // Owner-executed in a browser console on https://geekaygames.sharepoint.com/sites/C3.
  // Modes: DRY RUN (default, zero mutations) · ARMED NORMAL · RECOVERY (partial prior
  // run) · TERMINAL RECOVERY (verification only). One mutation per fresh witness with
  // full reconciliation. Grant-before-remove; administrative access is proven before
  // every removal. ACLs are the security boundary — UI role checks are UX only.
  //
  // ETag semantics (documented, hosted-probed): SharePoint role-assignment endpoints
  // (breakroleinheritance / addroleassignment / removeroleassignment / getbyprincipalid
  // DELETE) expose NO ETag or IF-MATCH semantics. Concurrency safety here = fresh
  // complete witnesses, exact target rereads, ONE mutation at a time, and full
  // post-mutation reconciliation. Never 'IF-MATCH: *'. Never a parent-list ETag on a
  // child/ACL resource. The expired S32-P3C-FIELD-ETAG-EXCEPTION is NOT reused: this
  // script performs no field or list-settings mutation at all.
  const DRY_RUN = true;
  const CONFIRM = ''; // ← normal mode: I CONFIRM CONFIGURING THE C3CONTRACTS ACL
  const PHRASE = 'I CONFIRM CONFIGURING THE C3CONTRACTS ACL', TAG = '3D-1';
  // ── Evidence bindings — paste EXACT values printed by the reviewed 3D-0 probe ──
  const EXPECTED_TARGET_PRINCIPALS = []; // ← resolvedTargets from 3D-0: [{ title, role, id, loginName }]
  const EXPECTED_ROLE_DEFS = null; // ← resolvedRoles from 3D-0: { 'Full Control': { id }, 'Read': { id } }
  const EXPECTED_PRE_ACL_FP = ''; // ← current ACL fingerprint from 3D-0
  const EXPECTED_PRE_FIELD_INVENTORY_FP = ''; // ← field-inventory fingerprint from 3D-0
  const EXPECTED_PRE_LIST_ETAG = ''; // ← list ETag from 3D-0 (drift detection only — never an IF-MATCH value here)
  const EXPECTED_PLAN = []; // ← deterministic mutation plan strings from 3D-0
  // ── RECOVERY (partial prior run) — never continues automatically ──────────
  const RECOVERY_MODE = false;
  const RECOVERY_CONFIRM = ''; // ← I CONFIRM RESUMING C3CONTRACTS ACL CONFIGURATION
  const RECOVERY_PHRASE = 'I CONFIRM RESUMING C3CONTRACTS ACL CONFIGURATION';
  const EXPECTED_RECOVERY_ACL_FP = '';
  const EXPECTED_RECOVERY_PLAN = []; // ← empty ONLY for terminal verification-only recovery
  const TARGET_GUID = '88e835ad-ffd8-4565-9364-c1c1b4f0fc2f';
  const EXPECTED_URL = '/sites/C3/Lists/C3_Contracts';
  const EXPECTED_TITLE = 'C3Contracts';
  // Phase 3C hosted-green closure fingerprint (reduced Stage-A-compatible formula):
  const EXPECTED_SCHEMA_FP = '3a13b28f94ccc462e5b5001a56a0d543cab3a74a4ba96c5913498087334bea98';

  const PAGE = 500, MAX_PAGES = 200;
  const fail = (m) => { console.error(`%c✖ FAIL-CLOSED: ${m}`, 'color:#c00;font-weight:bold'); throw new Error(m); };
  const web = (typeof _spPageContextInfo !== 'undefined' && _spPageContextInfo.webAbsoluteUrl) || `${location.origin}/sites/C3`;
  if (!/\/sites\/C3$/i.test(web)) fail(`Wrong web context: ${web}`);
  const ORIGIN = new URL(web).origin, WEBPATH = new URL(web).pathname.replace(/\/$/, '');
  const trust = (u, l) => { let p; try { p = new URL(u, web + '/'); } catch { fail(`${l}: unparseable link`); }
    if (p.origin !== ORIGIN || !p.pathname.toLowerCase().startsWith(`${WEBPATH.toLowerCase()}/_api/`)) fail(`${l}: untrusted link ${u}`); return p.href; };
  const GETraw = async (url, accept = 'application/json;odata=nometadata') => {
    const response = await fetch(url, { headers: { Accept: accept }, credentials: 'same-origin' });
    if (response.status === 404) return { __404: true };
    if (!response.ok) {
      let body = '';
      try { body = await response.text(); } catch { body = '<unreadable response body>'; }
      fail(`GET ${url} → HTTP ${response.status}${body ? ` · BODY: ${body}` : ''}`);
    }
    let json; try { json = await response.json(); } catch { fail(`Non-JSON response: ${url}`); }
    json.__etagHeader = response.headers.get('ETag') ?? null; return json; };
  const getAll = async (path, l) => { let url = web + path; const items = []; const seen = new Set(); let n = 0;
    while (url) { if (n > 0) url = trust(url, l); if (seen.has(url)) fail(`${l}: paging loop`); seen.add(url);
      if (++n > MAX_PAGES) fail(`${l}: page cap`); const j = await GETraw(url);
      if (j.__404) fail(`${l}: 404 mid-pagination`); if (!Array.isArray(j.value)) fail(`${l}: malformed page`);
      items.push(...j.value); const a = j['odata.nextLink'], b = j['@odata.nextLink'];
      if (a != null && b != null && a !== b) fail(`${l}: conflicting nextLinks`); url = a ?? b ?? null; }
    return items; };
  const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
  const nz = (v) => (v === null || v === undefined) ? '∅' : String(v);
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));
  const getDigest = async () => {
    const contextResponse = await fetch(`${web}/_api/contextinfo`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json;odata=nometadata' } });
    if (!contextResponse.ok) fail(`contextinfo failed: HTTP ${contextResponse.status}`);
    let contextJson; try { contextJson = await contextResponse.json(); } catch { fail('contextinfo returned non-JSON content.'); }
    const digest = contextJson.FormDigestValue;
    if (!digest) fail('contextinfo did not return FormDigestValue.');
    return digest;
  };

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

  const FIELD_SELECT = '$select=Id,InternalName,Title,TypeAsString,Required,Indexed,EnforceUniqueValues,Hidden,ReadOnlyField,Sealed,FromBaseType,CanBeDeleted,LookupList,LookupField,DefaultValue,SchemaXml';
  const scanLookupsInto = async (targetGuid) => {
    const hits = []; const t = targetGuid.toLowerCase();
    for (const sl of await getAll(`/_api/web/lists?$select=Id,Title&$top=${PAGE}`, 'site lists'))
      for (const f of await getAll(`/_api/web/lists(guid'${sl.Id}')/fields?$select=InternalName,TypeAsString,LookupList&$top=${PAGE}`, `fields of ${sl.Title}`))
        if (['Lookup', 'LookupMulti'].includes(f.TypeAsString) && f.LookupList && f.LookupList.replace(/[{}]/g, '').toLowerCase() === t && sl.Id.toLowerCase() !== t)
          hits.push(`${sl.Id.toLowerCase()}|${sl.Title}|${f.InternalName}|${f.TypeAsString}`);
    return hits.sort(); };
  const captureAclSnapshot = async () => {
    const li = await GETraw(`${web}/_api/web/lists(guid'${TARGET_GUID}')?$select=Id,Title,ItemCount,LastItemModifiedDate,BaseTemplate,BaseType,ContentTypesEnabled,EnableVersioning,MajorVersionLimit,EnableAttachments,RootFolder/ServerRelativeUrl&$expand=RootFolder`, 'application/json;odata=minimalmetadata');
    if (li.__404) fail('C3Contracts (by GUID) not found.');
    const items = await getAll(`/_api/web/lists(guid'${TARGET_GUID}')/items?$select=Id,Title,HasUniqueRoleAssignments&$orderby=Id asc&$top=${PAGE}`, 'items');
    const fields = await getAll(`/_api/web/lists(guid'${TARGET_GUID}')/fields?${FIELD_SELECT}&$top=${PAGE}`, 'fields');
    const acl = await getAll(`/_api/web/lists(guid'${TARGET_GUID}')/roleassignments?$expand=Member,RoleDefinitionBindings&$select=PrincipalId,Member/Id,Member/LoginName,Member/Title,Member/PrincipalType,RoleDefinitionBindings/Id,RoleDefinitionBindings/Name&$top=${PAGE}`, 'ACL');
    const hasUnique = (await GETraw(`${web}/_api/web/lists(guid'${TARGET_GUID}')/HasUniqueRoleAssignments`)).value;
    const inbound = await scanLookupsInto(TARGET_GUID);
    const snap = {
      list: { guid: li.Id, title: li.Title, url: li.RootFolder.ServerRelativeUrl, itemCount: li.ItemCount,
        lastItemModifiedDate: li.LastItemModifiedDate, listEtag: li.__etagHeader ?? li['odata.etag'] ?? null,
        baseTemplate: li.BaseTemplate, baseType: li.BaseType, contentTypesEnabled: li.ContentTypesEnabled,
        enableVersioning: li.EnableVersioning, majorVersionLimit: li.MajorVersionLimit, enableAttachments: li.EnableAttachments,
        hasUniqueRoleAssignments: hasUnique },
      items: items.map(i => ({ Id: i.Id, Title: i.Title })), fields, roleAssignments: acl, inboundLookups: inbound,
      uniqueChildScopes: items.filter(i => i.HasUniqueRoleAssignments === true).map(i => i.Id).sort((a, b) => a - b),
    };
    snap.schemaCompatibilityFingerprintSha256 = await sha(fields.map(f => `${f.InternalName}|${f.TypeAsString}|${f.Required}|${f.Indexed}|${f.EnforceUniqueValues}|${f.Hidden}|${f.ReadOnlyField}|${f.LookupList ?? ''}|${f.LookupField ?? ''}`).sort().join('\n'));
    snap.fieldInventoryFingerprintSha256 = await sha(fields.map(f => [f.Id, f.InternalName, f.Title, f.TypeAsString, f.Required, f.Indexed, f.EnforceUniqueValues, f.Hidden, f.ReadOnlyField, f.Sealed, f.FromBaseType, f.CanBeDeleted, f.LookupList, f.LookupField, f.DefaultValue, f.SchemaXml, f.__etag].map(nz).join('|')).sort().join('\n'));
    snap.aclFingerprintSha256 = await sha(aclFingerprintInput(acl));
    snap.normalizedAcl = normalizeAssignments(acl);
    return snap;
  };
  const assertStable = (A, B) => {
    const drift = nonAclDrift(A, B);
    if (A.list.listEtag !== B.list.listEtag) drift.push('listEtag');
    if (A.aclFingerprintSha256 !== B.aclFingerprintSha256) drift.push('acl');
    if (A.list.hasUniqueRoleAssignments !== B.list.hasUniqueRoleAssignments) drift.push('inheritance');
    if (drift.length) fail(`Evidence UNSTABLE between snapshots (${drift.join(', ')}) — rerun in a quiet window.`);
  };
  const assertBaseGates = (S) => {
    if (S.list.title !== EXPECTED_TITLE) fail(`Title '${S.list.title}' ≠ ${EXPECTED_TITLE}`);
    if (S.list.guid.toLowerCase() !== TARGET_GUID) fail(`GUID mismatch: ${S.list.guid}`);
    if (S.list.url !== EXPECTED_URL) fail(`URL mismatch: ${S.list.url}`);
    if (S.schemaCompatibilityFingerprintSha256 !== EXPECTED_SCHEMA_FP) fail(`Schema fingerprint drift from closed Phase 3C state: ${S.schemaCompatibilityFingerprintSha256}`);
    if (S.list.itemCount !== 0 || S.items.length !== 0) fail(`List not empty: ItemCount=${S.list.itemCount}`);
    if (S.inboundLookups.length !== 0) fail(`Inbound lookups present: ${JSON.stringify(S.inboundLookups)}`);
    if (S.uniqueChildScopes.length !== 0) fail(`Item-level unique scopes present: ${JSON.stringify(S.uniqueChildScopes)}`);
    if (!(S.list.enableVersioning === true && S.list.majorVersionLimit === 10 && S.list.enableAttachments === false)) fail('List settings drifted from canonical Phase 3C state.');
  };
  const MANAGE_PERMISSIONS_LOW = 0x02000000; // SP.PermissionKind.managePermissions
  const assertAdminAccess = async (label) => {
    const p = await GETraw(`${web}/_api/web/lists(guid'${TARGET_GUID}')/EffectiveBasePermissions`);
    if (Number(BigInt(p.Low ?? '0') & BigInt(MANAGE_PERMISSIONS_LOW)) === 0) fail(`${label}: executing user no longer has ManagePermissions on C3Contracts — STOP (administrative access must be preserved).`);
  };
  /** Bounded READ-ONLY ACL verification: refetch until predicate(normalizedAcl,
   *  hasUnique) is true. NEVER retries a mutation. */
  const boundedAclCheck = async (predicate, label, attempts = 5, delayMs = 2000) => {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const acl = await getAll(`/_api/web/lists(guid'${TARGET_GUID}')/roleassignments?$expand=Member,RoleDefinitionBindings&$select=PrincipalId,Member/Id,Member/LoginName,Member/Title,Member/PrincipalType,RoleDefinitionBindings/Id,RoleDefinitionBindings/Name&$top=${PAGE}`, `${label} ACL`);
      const hasUnique = (await GETraw(`${web}/_api/web/lists(guid'${TARGET_GUID}')/HasUniqueRoleAssignments`)).value;
      if (predicate(normalizeAssignments(acl), hasUnique)) return;
      if (attempt < attempts) await sleep(delayMs);
    }
    fail(`${label}: expected ACL state not observed after ${attempts} read-only attempts.`);
  };
  const ownersFcPresent = (normalized, ownersId) =>
    normalized.some(p => p.principalId === ownersId && p.bindings.some(b => b.name === 'Full Control'));

  // ── PREFLIGHT: two complete equivalent snapshots + stability + all gates ──
  const A = await captureAclSnapshot();
  const B = await captureAclSnapshot();
  assertStable(A, B);
  assertBaseGates(A);
  // Live principal/role re-resolution — the pasted 3D-0 evidence must still be true.
  const siteGroups = await getAll(`/_api/web/sitegroups?$select=Id,Title,LoginName,PrincipalType&$top=${PAGE}`, 'site groups');
  const roleDefs = await getAll(`/_api/web/roledefinitions?$select=Id,Name&$top=${PAGE}`, 'role definitions');
  const { resolved, errors: groupErrors } = resolvePrincipals(siteGroups);
  const { roles, errors: roleErrors } = resolveRoleDefinitions(roleDefs);
  if (groupErrors.length) fail(`Principal resolution blockers: ${groupErrors.join(' · ')}`);
  if (roleErrors.length) fail(`Role-definition resolution blockers: ${roleErrors.join(' · ')}`);
  const ownersId = resolved[0].id;
  await assertAdminAccess('preflight');
  const plan = planMutations(A.normalizedAcl, resolved, roles, A.list.hasUniqueRoleAssignments);
  if (plan.errors.length) fail(`Plan blockers: ${plan.errors.join(' · ')}`);
  const planStrings = planActionStrings(plan.actions);
  console.log('Resolved target principals (live):', JSON.stringify(resolved, null, 1));
  console.log('Resolved role definitions (live):', JSON.stringify(roles, null, 1));
  console.log('Current ACL (normalized):', JSON.stringify(A.normalizedAcl, null, 1));
  console.log('Current ACL fingerprint:', A.aclFingerprintSha256);
  console.log('HasUniqueRoleAssignments:', A.list.hasUniqueRoleAssignments, '· list ETag (drift witness only):', A.list.listEtag);
  console.log('Deterministic mutation plan:', JSON.stringify(planStrings, null, 1));
  console.log('Evaluation vs exact target:', JSON.stringify(evaluateAcl(A.normalizedAcl, resolved), null, 1));
  if (DRY_RUN) { console.log(`%c═══ ${TAG} DRY RUN (${RECOVERY_MODE ? 'RECOVERY' : 'normal'}) — preflights PASSED; zero mutations. ACL endpoints expose no ETag semantics (documented): safety = fresh witness + one mutation + full reconciliation. Normal mode: populate the EXPECTED_* constants from the reviewed 3D-0 evidence. Recovery mode: populate EXPECTED_RECOVERY_* from the failed run's printed live evidence (empty EXPECTED_RECOVERY_PLAN is valid ONLY for terminal verification-only recovery). ═══`, 'color:#080;font-weight:bold'); return; }
  // ── ARM GATE (normal binds to reviewed 3D-0 evidence; recovery to fresh evidence) ──
  const sameTargets = (a, b) => JSON.stringify((a ?? []).map(t => `${t.title}#${t.id}=${t.role}`)) === JSON.stringify((b ?? []).map(t => `${t.title}#${t.id}=${t.role}`));
  if (!RECOVERY_MODE) {
    if (EXPECTED_TARGET_PRINCIPALS.length !== 5 || !EXPECTED_ROLE_DEFS) fail('EXPECTED_TARGET_PRINCIPALS / EXPECTED_ROLE_DEFS not populated — arm only from reviewed 3D-0 evidence.');
    if (!sameTargets(EXPECTED_TARGET_PRINCIPALS, resolved)) fail('Live resolved principals ≠ reviewed 3D-0 principals — re-run 3D-0 and review.');
    if (EXPECTED_ROLE_DEFS['Full Control']?.id !== roles['Full Control'].id || EXPECTED_ROLE_DEFS.Read?.id !== roles.Read.id) fail('Live role-definition ids ≠ reviewed 3D-0 evidence.');
    if (!EXPECTED_PRE_ACL_FP || A.aclFingerprintSha256 !== EXPECTED_PRE_ACL_FP) fail('EXPECTED_PRE_ACL_FP empty or ≠ live ACL fingerprint — if a prior run partially completed, use RECOVERY_MODE.');
    if (!EXPECTED_PRE_FIELD_INVENTORY_FP || A.fieldInventoryFingerprintSha256 !== EXPECTED_PRE_FIELD_INVENTORY_FP) fail('EXPECTED_PRE_FIELD_INVENTORY_FP empty or ≠ live field inventory.');
    if (!EXPECTED_PRE_LIST_ETAG || EXPECTED_PRE_LIST_ETAG === '*' || nz(A.list.listEtag) !== nz(EXPECTED_PRE_LIST_ETAG)) fail('EXPECTED_PRE_LIST_ETAG empty/wildcard or ≠ live list ETag (drift witness).');
    if (A.list.hasUniqueRoleAssignments !== false) fail('Normal mode expects an INHERITED pre-state — list already unique; use RECOVERY_MODE with reviewed evidence.');
    if (EXPECTED_PLAN.length === 0 || JSON.stringify(planStrings) !== JSON.stringify(EXPECTED_PLAN)) fail('Live deterministic plan ≠ reviewed EXPECTED_PLAN — re-run 3D-0 and review.');
    if (CONFIRM !== PHRASE) fail('Confirmation phrase absent.');
  } else {
    // Terminal recovery: an EMPTY reviewed plan is valid ONLY together with the
    // fresh ACL fingerprint binding and the recovery phrase — it verifies and
    // closes a potentially-committed final mutation without issuing any mutation.
    if (!EXPECTED_RECOVERY_ACL_FP) fail('Recovery: EXPECTED_RECOVERY_ACL_FP empty — populate from the failed run\'s printed live evidence after owner review.');
    if (A.aclFingerprintSha256 !== EXPECTED_RECOVERY_ACL_FP) fail('Recovery: live ACL fingerprint ≠ reviewed recovery evidence.');
    if (JSON.stringify(planStrings) !== JSON.stringify(EXPECTED_RECOVERY_PLAN)) fail(`Recovery: live plan ${JSON.stringify(planStrings)} ≠ EXPECTED_RECOVERY_PLAN.`);
    if (RECOVERY_CONFIRM !== RECOVERY_PHRASE) fail('Recovery confirmation phrase absent.');
  }
  let verifiedState = A;
  const completed = [], remainingActs = [...planStrings];
  const done = (s) => { completed.push(s); remainingActs.splice(remainingActs.indexOf(s), 1); console.log(`✔ ${s}`); };
  /** Partial-state reporting: ALL recovery values from a fresh complete snapshot —
   *  never inferred from an in-memory array. Normal-mode reruns then prohibited. */
  const reportPartial = async (ctx) => {
    console.error(`✖ ${ctx}`);
    console.error('Completed actions (this run):', JSON.stringify(completed));
    console.error('Remaining actions (this run, incl. the failed one):', JSON.stringify(remainingActs));
    const F = await captureAclSnapshot();
    const freshPlan = planMutations(F.normalizedAcl, resolved, roles, F.list.hasUniqueRoleAssignments);
    console.error('LIVE recovery evidence (owner review, then paste into the EXPECTED_RECOVERY_* constants):');
    console.error('  EXPECTED_RECOVERY_ACL_FP =', JSON.stringify(F.aclFingerprintSha256));
    console.error('  EXPECTED_RECOVERY_PLAN =', JSON.stringify(planActionStrings(freshPlan.actions)));
    console.error('  LIVE normalized ACL:', JSON.stringify(F.normalizedAcl, null, 1));
    console.error('  LIVE HasUniqueRoleAssignments:', F.list.hasUniqueRoleAssignments);
    if (freshPlan.errors.length) console.error('  LIVE plan blockers (owner review):', JSON.stringify(freshPlan.errors));
    fail('PARTIAL STATE — normal-mode reruns are PROHIBITED. Resume only via RECOVERY_MODE bound to the owner-reviewed evidence above.');
  };
  /** Fresh witness before EVERY mutation: two snapshots, stability, base gates,
   *  admin access, non-ACL invariants + ACL fingerprint equal to verifiedState. */
  const freshWitness = async (label) => {
    const W1 = await captureAclSnapshot();
    const W2 = await captureAclSnapshot();
    assertStable(W1, W2);
    assertBaseGates(W1);
    await assertAdminAccess(label);
    const drift = nonAclDrift(W1, verifiedState);
    if (drift.length) fail(`${label}: non-ACL state drifted from last verified state (${drift.join(', ')}).`);
    if (W1.aclFingerprintSha256 !== verifiedState.aclFingerprintSha256) fail(`${label}: ACL drifted from last verified state — concurrent change; STOP.`);
    if (W1.list.hasUniqueRoleAssignments !== verifiedState.list.hasUniqueRoleAssignments) fail(`${label}: inheritance state drifted from last verified state.`);
    return W1;
  };
  const postMutation = async (r, actionString, predicate, expectHasUnique, W) => {
    if (!r.ok) {
      let body = '';
      try { body = await r.text(); } catch { body = '<unreadable response body>'; }
      console.error(`${actionString} → HTTP ${r.status}${body ? ` · BODY: ${body}` : ''}`);
      const fresh = await captureAclSnapshot();
      if (fresh.aclFingerprintSha256 === verifiedState.aclFingerprintSha256
        && fresh.list.hasUniqueRoleAssignments === verifiedState.list.hasUniqueRoleAssignments) {
        fail(`NO MUTATION CONFIRMED: ${actionString} was rejected (HTTP ${r.status}) and the ACL and inheritance state are unchanged. Investigate the cause; NORMAL mode may be re-run — recovery is NOT required.`);
      }
      await reportPartial(`${actionString} → HTTP ${r.status} WITH an observed state change — potentially committed.`);
    }
    // HTTP-successful response: treat as POTENTIALLY COMMITTED before verification.
    try { await boundedAclCheck(predicate, actionString); }
    catch (error) { await reportPartial(`${actionString}: response was HTTP-successful but the expected ACL state was not observed (${error.message}) — the operation may be committed.`); }
    // ── POST-MUTATION RECONCILIATION (any failure here may reflect a committed
    //    mutation → fresh recovery evidence via reportPartial) ──
    let post;
    try {
      post = await captureAclSnapshot();
      assertBaseGates(post);
      const drift = nonAclDrift(post, W);
      if (drift.length) fail(`non-ACL state changed during ${actionString} (${drift.join(', ')}).`);
      if (post.list.hasUniqueRoleAssignments !== expectHasUnique) fail(`inheritance state after ${actionString}: ${post.list.hasUniqueRoleAssignments} ≠ expected ${expectHasUnique}.`);
      if (!predicate(post.normalizedAcl, post.list.hasUniqueRoleAssignments)) fail(`reconciliation predicate failed after ${actionString}.`);
      // Owners Full Control may only be absent while its grant is still pending.
      const ownersGrantPending = remainingActs.some(s => s.startsWith('grant:C3 Owners#') && s !== actionString);
      if (!ownersFcPresent(post.normalizedAcl, ownersId) && !ownersGrantPending) fail(`C3 Owners Full Control missing after ${actionString} — STOP.`);
    } catch (error) {
      await reportPartial(`Post-mutation reconciliation failed for ${actionString}: ${error.message}`);
    }
    verifiedState = post;
  };
  // ── EXECUTION: one witnessed, reconciled mutation per action, in plan order ──
  for (const [index, action] of plan.actions.entries()) {
    const actionString = planStrings[index];
    const W = await freshWitness(`pre ${actionString}`);
    // Grant-before-remove safety: before ANY revoke/remove, Owners Full Control must
    // be present on the CURRENT witness and the executing user must retain access.
    if (action.kind === 'revoke-binding' || action.kind === 'remove-principal') {
      if (!ownersFcPresent(W.normalizedAcl, ownersId)) fail(`Refusing ${actionString}: C3 Owners does not hold Full Control on the current witness.`);
    }
    const digest = await getDigest();
    let r, predicate, expectHasUnique = true;
    if (action.kind === 'break-inheritance') {
      // copyRoleAssignments=true preserves every existing principal (including the
      // executing administrator's path) until replacement access is proven;
      // clearSubscopes=true is PROHIBITED (locked S30 rev2 rule).
      r = await fetch(`${web}/_api/web/lists(guid'${TARGET_GUID}')/breakroleinheritance(copyRoleAssignments=true, clearSubscopes=false)`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json;odata=nometadata', 'X-RequestDigest': digest } });
      const before = JSON.stringify(W.normalizedAcl.map(p => `${p.principalId}|${p.bindings.map(b => b.name).join(',')}`));
      predicate = (acl, hasUnique) => hasUnique === true && JSON.stringify(acl.map(p => `${p.principalId}|${p.bindings.map(b => b.name).join(',')}`)) === before;
    } else if (action.kind === 'grant') {
      r = await fetch(`${web}/_api/web/lists(guid'${TARGET_GUID}')/roleassignments/addroleassignment(principalid=${action.principalId}, roledefid=${action.roleDefId})`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json;odata=nometadata', 'X-RequestDigest': digest } });
      predicate = (acl) => acl.some(p => p.principalId === action.principalId && p.bindings.some(b => b.name === action.roleName));
    } else if (action.kind === 'revoke-binding') {
      r = await fetch(`${web}/_api/web/lists(guid'${TARGET_GUID}')/roleassignments/removeroleassignment(principalid=${action.principalId}, roledefid=${action.roleDefId})`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json;odata=nometadata', 'X-RequestDigest': digest } });
      predicate = (acl) => !acl.some(p => p.principalId === action.principalId && p.bindings.some(b => b.name === action.roleName));
    } else {
      r = await fetch(`${web}/_api/web/lists(guid'${TARGET_GUID}')/roleassignments/getbyprincipalid(${action.principalId})`, { method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json;odata=nometadata', 'X-RequestDigest': digest, 'X-HTTP-Method': 'DELETE' } });
      predicate = (acl) => !acl.some(p => p.principalId === action.principalId);
    }
    await postMutation(r, actionString, predicate, expectHasUnique, W);
    done(actionString);
  }
  if (RECOVERY_MODE && plan.actions.length === 0) console.log('%cTERMINAL RECOVERY: verification only — ZERO mutations were issued by this run.', 'color:#080;font-weight:bold');
  // ── FINAL VERIFICATION: exact five-principal ACL; nothing else changed.
  //    After one or more committed actions a failure emits fresh recovery evidence;
  //    with zero actions this run, direct fail-closed. ──
  const P = verifiedState;
  try {
    const finalEval = evaluateAcl(P.normalizedAcl, resolved);
    if (P.list.hasUniqueRoleAssignments !== true) fail('Final state does not have unique role assignments.');
    if (!finalEval.exact) fail(`Final ACL is not exactly the five-principal target: ${JSON.stringify(finalEval)}`);
    const drift = nonAclDrift(P, A);
    if (drift.length) fail(`Non-ACL state changed during Phase 3D (${drift.join(', ')}).`);
  } catch (error) {
    if (completed.length > 0) await reportPartial(`Final 3D-1 verification failed after committed actions: ${error.message}`);
    throw error; // zero actions this run — direct fail-closed is truthful
  }
  console.log('Final role-assignment inventory:', JSON.stringify(P.normalizedAcl, null, 1));
  console.log('Final ACL fingerprint:', P.aclFingerprintSha256);
  console.log(`%c═══ ${TAG} COMPLETE: C3Contracts ACL = exactly five principals (Owners FC; Operations/Legal/Finance/Management Read) · every mutation individually witnessed + reconciled · schema/settings/contents/GUID/URL/inbound/scopes unchanged. STOP — NavRail activation, deployment, and Part 19 are SEPARATE later phases. ═══`, 'color:#080;font-weight:bold');
})();
