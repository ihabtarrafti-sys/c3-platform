(async () => {
  'use strict';
  // ═══ C3 S32 · 3D-0 rev3 — READ-ONLY PROBE: C3Contracts ACL + principal resolution ═══
  // rev2: operational owner principal = `C3 Platform Owners` (exact hosted title;
  // `C3 - Contract Command Center Owners` is the associated site-shell group and is
  // NOT the target); plan preview uses the proven rev-2 uncopied inheritance break.
  // rev3: field-inventory DRIFT CLASSIFICATION — compares the live full inventory
  // fingerprint to the prior reviewed value and classifies any difference: drift is
  // SAFE TO REBIND only when the reduced canonical schema fingerprint is intact,
  // all 19 canonical business fields remain genuinely exact, the two SP-managed
  // comment fields keep every invariant, and identity/settings/contents/deps are
  // unchanged — i.e. the difference is confined to SharePoint-managed metadata
  // (SchemaXml attributes, dependent computed fields). Anything else is a BLOCKER.
  // Also prints per-field state hashes for exact diffing against prior evidence.
  // Owner-executed in a browser console on https://geekaygames.sharepoint.com/sites/C3.
  // GET-only. Zero mutations. Resolves live principals/role definitions, captures a
  // two-snapshot-stable pre-state, previews the deterministic Phase 3D mutation plan,
  // and exports complete evidence to window.__C3_PHASE3D0_EVIDENCE.
  // Blockers are RECORDED (never thrown) after target identity is proven.
  const TARGET_GUID = '88e835ad-ffd8-4565-9364-c1c1b4f0fc2f';
  const EXPECTED_URL = '/sites/C3/Lists/C3_Contracts';
  const EXPECTED_TITLE = 'C3Contracts';
  // Phase 3C hosted-green closure fingerprint (reduced Stage-A-compatible formula):
  const EXPECTED_SCHEMA_FP = '3a13b28f94ccc462e5b5001a56a0d543cab3a74a4ba96c5913498087334bea98';
  // Prior REVIEWED full field-inventory fingerprint (3D-0 rev 2, 2026-07-05) — used
  // only to detect and classify drift; the FRESH value printed below is what 3D-1
  // binds to:
  const PRIOR_REVIEWED_FIELD_INVENTORY_FP = 'b3e726b0ad97b75a48ab77cdcaef8b80f20044391a7f5a0a150faefb5f1e7842';
  const TITLE_BASE_FIELD_ID = 'fa564e0f-0c70-4ab9-b863-0177e6ddd247'; // SP base Title field

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

  // ── Phase 3C canonical business schema (19 fields) + SP-managed comment-field
  //    allowlist — used by the rev3 drift classifier ──
  const CANON = [
    ['Title', 'Contract ID', 'Text', true, true, true, null],
    ['PersonID', 'Person ID', 'Text', true, true, false, null],
    ['FullName', 'Full Name', 'Text', true, false, false, null],
    ['DisplayName', 'Display Name', 'Text', false, false, false, null],
    ['ContractTypeName', 'Contract Type', 'Text', true, false, false, null],
    ['AgreementCategory', 'Agreement Category', 'Text', false, false, false, null],
    ['ContractStage1', 'Contract Stage', 'Text', true, false, false, null],
    ['Disposition1', 'Disposition', 'Text', false, false, false, null],
    ['StartDate', 'Start Date', 'DateTime', false, false, false, 'DateOnly'],
    ['EndDate', 'End Date', 'DateTime', true, true, false, 'DateOnly'],
    ['SignatureDate', 'Signature Date', 'DateTime', false, false, false, 'DateOnly'],
    ['TerminationDate', 'Termination Date', 'DateTime', false, false, false, 'DateOnly'],
    ['HasSignedContract', 'Has Signed Contract', 'Boolean', false, false, false, null],
    ['MonthlyCompensation', 'Monthly Compensation', 'Currency', false, false, false, 'Decimals2'],
    ['CurrencyCode', 'Currency Code', 'Text', false, false, false, null],
    ['PrizeSharePct', 'Prize Share %', 'Number', false, false, false, 'NoDefault'],
    ['ContractOwnerName', 'Contract Owner Name', 'Text', false, false, false, null],
    ['ContractOwnerEmail', 'Contract Owner Email', 'Text', false, false, false, null],
    ['IsActive', 'Is Active', 'Boolean', false, false, false, 'Default1'],
  ];
  const isExact = (f, spec) => {
    const [, disp, type, req, idx, uniq, extra] = spec;
    if (f.TypeAsString !== type || f.Required !== req || f.Indexed !== idx) return false;
    if ((f.EnforceUniqueValues === true) !== uniq) return false;
    if (f.Title !== disp) return false;
    if (extra === 'DateOnly' && !/Format="DateOnly"/.test(f.SchemaXml ?? '')) return false;
    if (extra === 'Decimals2' && !/Decimals="2"/.test(f.SchemaXml ?? '')) return false;
    if (extra === 'Default1' && f.DefaultValue !== '1') return false;
    if (extra === 'NoDefault' && f.DefaultValue != null && f.DefaultValue !== '') return false;
    return true;
  };
  const MANAGED_COMMENT_FIELDS = [
    { id: 'd307dff3-340f-44a2-9f4b-fbfe1ba07459', internalName: '_CommentCount', title: 'Comment count', showField: 'CommentCount' },
    { id: 'c274cbfd-084a-4017-925f-cce50c9e3eec', internalName: '_CommentFlags', title: 'Comment settings', showField: 'CommentFlags' },
  ];
  const isManagedCommentFieldIntact = (fields, expected) => {
    const f = fields.find(x => String(x.Id ?? '').toLowerCase() === expected.id && x.InternalName === expected.internalName);
    if (!f) return false;
    const schema = f.SchemaXml ?? '';
    return f.Title === expected.title && f.TypeAsString === 'Lookup'
      && f.FromBaseType === false && f.CanBeDeleted === false
      && f.Hidden === true && f.ReadOnlyField === true && f.Sealed === true
      && /DisplaceOnUpgrade="TRUE"/.test(schema) && /RecreateIfMissing="TRUE"/.test(schema)
      && new RegExp(`ShowField="${expected.showField}"`).test(schema);
  };
  const FIELD_SELECT = '$select=Id,InternalName,Title,TypeAsString,Required,Indexed,EnforceUniqueValues,Hidden,ReadOnlyField,Sealed,FromBaseType,CanBeDeleted,LookupList,LookupField,DefaultValue,SchemaXml';
  const scanLookupsInto = async (targetGuid) => {
    const hits = []; const t = targetGuid.toLowerCase();
    for (const sl of await getAll(`/_api/web/lists?$select=Id,Title&$top=${PAGE}`, 'site lists'))
      for (const f of await getAll(`/_api/web/lists(guid'${sl.Id}')/fields?$select=InternalName,TypeAsString,LookupList&$top=${PAGE}`, `fields of ${sl.Title}`))
        if (['Lookup', 'LookupMulti'].includes(f.TypeAsString) && f.LookupList && f.LookupList.replace(/[{}]/g, '').toLowerCase() === t && sl.Id.toLowerCase() !== t)
          hits.push(`${sl.Id.toLowerCase()}|${sl.Title}|${f.InternalName}|${f.TypeAsString}`);
    return hits.sort(); };

  /** COMPLETE read-only pre-state snapshot for Phase 3D (list + ACL + fingerprints). */
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
    // REDUCED Stage-A-compatible schema fingerprint — formula FROZEN.
    snap.schemaCompatibilityFingerprintSha256 = await sha(fields.map(f => `${f.InternalName}|${f.TypeAsString}|${f.Required}|${f.Indexed}|${f.EnforceUniqueValues}|${f.Hidden}|${f.ReadOnlyField}|${f.LookupList ?? ''}|${f.LookupField ?? ''}`).sort().join('\n'));
    // COMPLETE field-inventory fingerprint (frozen formula; field-resource ETag slot
    // is '∅' — fields expose no ETag in this hosted tenant).
    snap.fieldInventoryFingerprintSha256 = await sha(fields.map(f => [f.Id, f.InternalName, f.Title, f.TypeAsString, f.Required, f.Indexed, f.EnforceUniqueValues, f.Hidden, f.ReadOnlyField, f.Sealed, f.FromBaseType, f.CanBeDeleted, f.LookupList, f.LookupField, f.DefaultValue, f.SchemaXml, f.__etag].map(nz).join('|')).sort().join('\n'));
    snap.aclFingerprintSha256 = await sha(aclFingerprintInput(acl));
    return snap;
  };
  const assertStable = (A, B) => {
    const drift = nonAclDrift(A, B);
    if (A.list.listEtag !== B.list.listEtag) drift.push('listEtag');
    if (A.aclFingerprintSha256 !== B.aclFingerprintSha256) drift.push('acl');
    if (A.list.hasUniqueRoleAssignments !== B.list.hasUniqueRoleAssignments) drift.push('inheritance');
    if (A.list.lastItemModifiedDate !== B.list.lastItemModifiedDate) drift.push('lastModified');
    if (drift.length) fail(`Evidence UNSTABLE between snapshots (${drift.join(', ')}) — rerun in a quiet window.`);
  };

  // ── Site-scope read-only inventory ──
  const siteGroups = await getAll(`/_api/web/sitegroups?$select=Id,Title,LoginName,PrincipalType,OwnerTitle&$top=${PAGE}`, 'site groups');
  const roleDefs = await getAll(`/_api/web/roledefinitions?$select=Id,Name,Hidden,RoleTypeKind&$top=${PAGE}`, 'role definitions');
  const webAcl = await getAll(`/_api/web/roleassignments?$expand=Member,RoleDefinitionBindings&$select=PrincipalId,Member/Id,Member/LoginName,Member/Title,Member/PrincipalType,RoleDefinitionBindings/Id,RoleDefinitionBindings/Name&$top=${PAGE}`, 'web ACL');
  const assoc = await GETraw(`${web}/_api/web?$select=AssociatedOwnerGroup/Id,AssociatedOwnerGroup/Title,AssociatedMemberGroup/Id,AssociatedMemberGroup/Title,AssociatedVisitorGroup/Id,AssociatedVisitorGroup/Title&$expand=AssociatedOwnerGroup,AssociatedMemberGroup,AssociatedVisitorGroup`);
  const me = await GETraw(`${web}/_api/web/currentuser?$select=Id,Title,LoginName,IsSiteAdmin`);
  const myGroups = await getAll(`/_api/web/currentuser/Groups?$select=Id,Title&$top=${PAGE}`, 'current user groups');
  const myListPerms = await GETraw(`${web}/_api/web/lists(guid'${TARGET_GUID}')/EffectiveBasePermissions`);
  const MANAGE_PERMISSIONS_LOW = 0x02000000; // SP.PermissionKind.managePermissions (kind 26 → 1<<25)
  const canManage = (Number(BigInt(myListPerms.Low ?? '0') & BigInt(MANAGE_PERMISSIONS_LOW)) !== 0);

  // ── Two-snapshot-stable list pre-state ──
  const A = await captureAclSnapshot();
  const B = await captureAclSnapshot();
  assertStable(A, B);
  if (A.list.title !== EXPECTED_TITLE) fail(`Title '${A.list.title}' ≠ ${EXPECTED_TITLE}`);
  if (A.list.guid.toLowerCase() !== TARGET_GUID) fail(`GUID mismatch: ${A.list.guid}`);
  if (A.list.url !== EXPECTED_URL) fail(`URL mismatch: ${A.list.url}`);

  // ── Resolution + plan preview (rev-2 uncopied break: inherited ACL is discarded,
  //    so the plan is break → five grants → conditional acting-user removal) ──
  const { resolved, errors: groupErrors } = resolvePrincipals(siteGroups);
  const { roles, errors: roleErrors } = resolveRoleDefinitions(roleDefs);
  const normalized = normalizeAssignments(A.roleAssignments);
  const evaluation = resolved.length === P3D_TARGET_GROUPS.length ? evaluateAcl(normalized, resolved) : null;
  const executingUser = { id: me.Id, title: me.Title };
  const plan = A.list.hasUniqueRoleAssignments === false
    ? planNormalMutations(resolved, roles, executingUser)
    : planRecoveryMutations(normalized, resolved, roles, A.list.hasUniqueRoleAssignments, executingUser);
  const planStrings = planActionStrings(plan.actions);

  const out = { at: new Date().toISOString(), web, evidenceStable: true,
    snapshotA: A,
    snapshotB: { list: B.list, schemaCompatibilityFingerprintSha256: B.schemaCompatibilityFingerprintSha256,
      fieldInventoryFingerprintSha256: B.fieldInventoryFingerprintSha256, aclFingerprintSha256: B.aclFingerprintSha256,
      uniqueChildScopes: B.uniqueChildScopes, inboundLookups: B.inboundLookups },
    siteGroups, roleDefinitions: roleDefs, webRoleAssignments: webAcl,
    associatedGroups: { owner: assoc.AssociatedOwnerGroup ?? null, member: assoc.AssociatedMemberGroup ?? null, visitor: assoc.AssociatedVisitorGroup ?? null },
    executingUser: { ...me, groups: myGroups, listEffectiveBasePermissions: { High: myListPerms.High, Low: myListPerms.Low }, hasManagePermissionsOnList: canManage },
    resolvedTargets: resolved, resolvedRoles: roles,
    currentListAclNormalized: normalized, evaluation, plan: planStrings };

  // ── rev3 FIELD-INVENTORY DRIFT CLASSIFICATION ──
  const canonicalFieldIssues = [];
  {
    const byName = new Map(A.fields.map(f => [f.InternalName, f]));
    for (const spec of CANON) {
      const f = byName.get(spec[0]);
      if (!f) { canonicalFieldIssues.push(`canonical business field MISSING: ${spec[0]}`); continue; }
      if (spec[0] === 'Title' && !(String(f.Id).toLowerCase() === TITLE_BASE_FIELD_ID && f.FromBaseType === true)) canonicalFieldIssues.push('Title is not the base Title field');
      if (!isExact(f, spec)) canonicalFieldIssues.push(`canonical business field NOT exact: ${spec[0]}`);
    }
    for (const m of MANAGED_COMMENT_FIELDS) if (!isManagedCommentFieldIntact(A.fields, m)) canonicalFieldIssues.push(`SP-managed comment field missing/invariant-drifted: ${m.internalName}`);
  }
  const inventoryMatchesPrior = A.fieldInventoryFingerprintSha256 === PRIOR_REVIEWED_FIELD_INVENTORY_FP;
  const businessIntact = A.schemaCompatibilityFingerprintSha256 === EXPECTED_SCHEMA_FP && canonicalFieldIssues.length === 0
    && A.list.itemCount === 0 && A.inboundLookups.length === 0 && A.uniqueChildScopes.length === 0
    && A.list.enableVersioning === true && A.list.majorVersionLimit === 10 && A.list.enableAttachments === false;
  out.fieldInventoryDrift = {
    priorReviewedFingerprint: PRIOR_REVIEWED_FIELD_INVENTORY_FP,
    liveFingerprint: A.fieldInventoryFingerprintSha256,
    matchesPrior: inventoryMatchesPrior,
    classification: inventoryMatchesPrior
      ? 'none — matches the prior reviewed inventory'
      : businessIntact
        ? 'sharepoint-managed-metadata — reduced canonical schema fingerprint intact, all 19 canonical business fields exact, SP-managed comment fields intact, identity/settings/contents/dependencies unchanged. SAFE TO REBIND the fresh field-inventory fingerprint.'
        : 'BLOCKER — drift is NOT confined to SharePoint-managed metadata; owner review required.',
  };
  // Per-field state hashes (frozen fieldState property order, no field ETag) — for
  // exact diffing against prior evidence (see diff-3d0-field-inventories.mjs).
  out.fieldStateHashes = {};
  for (const f of A.fields) out.fieldStateHashes[f.InternalName] = await sha([f.Id, f.InternalName, f.Title, f.TypeAsString, f.Required, f.Indexed, f.EnforceUniqueValues, f.Hidden, f.ReadOnlyField, f.Sealed, f.FromBaseType, f.CanBeDeleted, f.LookupList, f.LookupField, f.DefaultValue, f.SchemaXml].map(nz).join('|'));

  // ── BLOCKERS: recorded as evidence, never thrown ──
  out.blockers = [];
  for (const e of groupErrors) out.blockers.push(`principal resolution: ${e}`);
  for (const e of roleErrors) out.blockers.push(`role-definition resolution: ${e}`);
  for (const e of plan.errors) out.blockers.push(`plan: ${e}`);
  for (const e of canonicalFieldIssues) out.blockers.push(`canonical schema: ${e}`);
  if (!inventoryMatchesPrior && !businessIntact) out.blockers.push('field-inventory drift NOT classifiable as SharePoint-managed metadata — owner review required');
  if (A.schemaCompatibilityFingerprintSha256 !== EXPECTED_SCHEMA_FP) out.blockers.push(`schema fingerprint drift from closed Phase 3C state: ${A.schemaCompatibilityFingerprintSha256} ≠ ${EXPECTED_SCHEMA_FP}`);
  if (A.list.itemCount !== 0 || A.items.length !== 0) out.blockers.push(`list not empty: ItemCount=${A.list.itemCount}`);
  if (A.inboundLookups.length !== 0) out.blockers.push(`inbound lookup dependencies present: ${JSON.stringify(A.inboundLookups)}`);
  if (A.uniqueChildScopes.length !== 0) out.blockers.push(`item-level unique scopes present: ${JSON.stringify(A.uniqueChildScopes)}`);
  if (A.list.hasUniqueRoleAssignments === true) out.blockers.push('list ALREADY has unique role assignments — expected inherited pre-state; owner review required (possible partial prior run → 3D-1 RECOVERY_MODE)');
  if (!canManage) out.blockers.push('executing user lacks ManagePermissions on C3Contracts — cannot run 3D-1');
  if (me.IsSiteAdmin !== true && !myGroups.some(g => String(g.Title ?? '').trim() === 'C3 Platform Owners')) out.blockers.push('executing user is neither site admin nor a C3 Platform Owners member — administrative-access preservation cannot be proven');
  const platformOwners = resolved.find(t => t.title === 'C3 Platform Owners');
  if (platformOwners && assoc.AssociatedOwnerGroup && platformOwners.id === assoc.AssociatedOwnerGroup.Id) out.blockers.push(`'C3 Platform Owners' resolved to the ASSOCIATED site-shell Owners group (#${platformOwners.id}) — the operational target must be a distinct group; owner review required`);
  if (resolved.some(t => t.id === me.Id)) out.blockers.push('executing user principal id collides with a resolved target principal — acting-user modeling would be ambiguous');
  if (!(A.list.enableVersioning === true && A.list.majorVersionLimit === 10 && A.list.enableAttachments === false)) out.blockers.push('list settings drifted from canonical Phase 3C state');

  window.__C3_PHASE3D0_EVIDENCE = out;
  console.log('Resolved target principals:', JSON.stringify(resolved, null, 1));
  console.log('Resolved role definitions:', JSON.stringify(roles, null, 1));
  console.log('Associated groups:', JSON.stringify(out.associatedGroups, null, 1));
  console.log('Executing user:', JSON.stringify({ Id: me.Id, LoginName: me.LoginName, IsSiteAdmin: me.IsSiteAdmin, hasManagePermissionsOnList: canManage }, null, 1));
  console.log('Current C3Contracts ACL (normalized):', JSON.stringify(normalized, null, 1));
  console.log('Current ACL fingerprint (EXPECTED_PRE_ACL_FP for 3D-1):', A.aclFingerprintSha256);
  console.log('Schema fingerprint (must equal Phase 3C closure):', A.schemaCompatibilityFingerprintSha256);
  console.log('Field-inventory fingerprint (EXPECTED_PRE_FIELD_INVENTORY_FP for 3D-1):', A.fieldInventoryFingerprintSha256);
  console.log('Field-inventory drift classification:', JSON.stringify(out.fieldInventoryDrift, null, 1));
  console.log('Per-field state hashes (for exact diffing vs prior evidence):', JSON.stringify(out.fieldStateHashes, null, 1));
  console.log('List ETag (EXPECTED_PRE_LIST_ETAG for 3D-1):', A.list.listEtag);
  console.log('Executing user (EXPECTED_EXECUTING_USER_ID / _TITLE for 3D-1):', me.Id, '/', JSON.stringify(me.Title));
  console.log('HasUniqueRoleAssignments:', A.list.hasUniqueRoleAssignments, '· ItemCount:', A.list.itemCount, '· inbound:', JSON.stringify(A.inboundLookups), '· scopes:', JSON.stringify(A.uniqueChildScopes));
  console.log('Deterministic mutation plan (EXPECTED_PLAN for 3D-1):', JSON.stringify(planStrings, null, 1));
  console.log('Evaluation vs exact five-principal target:', JSON.stringify(evaluation, null, 1));
  console.log('Blockers:', JSON.stringify(out.blockers, null, 1));
  console.log('═══ PHASE 3D-0 EVIDENCE JSON (also on window.__C3_PHASE3D0_EVIDENCE) ═══');
  console.log(JSON.stringify(out, null, 2));
  console.log(`%c═══ 3D-0 COMPLETE — GET-only probe · ZERO mutations occurred · two-snapshot stable · blockers=${out.blockers.length}${out.blockers.length ? ' — OWNER REVIEW REQUIRED before 3D-1' : ''} ═══`, out.blockers.length ? 'color:#c00;font-weight:bold' : 'color:#080;font-weight:bold');
})();
