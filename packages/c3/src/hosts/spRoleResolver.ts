/**
 * spRoleResolver.ts
 *
 * Resolves a C3Role for the current SharePoint user by inspecting their
 * SP security group memberships via the SP REST API.
 *
 * Sprint 19 Phase 1 — replaces the temporary 'owner' stub in SharePointHost.
 *
 * ── SharePoint group provisioning requirement ─────────────────────────────
 *
 * The following SharePoint groups must exist on the C3 site before this
 * resolver can grant elevated roles. Groups are matched by exact Title.
 * Users not in any mapped group receive the 'visitor' role.
 *
 *   SP Group Title          C3Role
 *   ──────────────────────  ─────────────
 *   C3 Platform Owners      owner
 *   C3 Operations           operations
 *   C3 HR                   hr
 *   C3 Legal                legal
 *   C3 Finance              finance
 *   C3 Management           management
 *   (no match)              visitor
 *
 * IT provisioning checklist:
 *   1. Create each group at Site Settings → People and Groups → New Group
 *   2. Set group Title to exactly the string above (case-sensitive)
 *   3. Add members as appropriate
 *   4. Grant groups Site Member or Site Visitor permission level
 *      (the resolver only reads group titles — no elevated list access needed)
 *
 * ── Fail-close behaviour ─────────────────────────────────────────────────
 *
 *   - Empty loginName           → 'visitor' (no fetch attempted)
 *   - Empty siteUrl             → 'visitor' (no fetch attempted)
 *   - Non-2xx HTTP response     → 'visitor' + console.warn
 *   - Network / fetch error     → 'visitor' + console.error
 *   - Malformed JSON            → 'visitor' + console.error
 *   - No group match            → 'visitor'
 *
 * ── Priority order ───────────────────────────────────────────────────────
 *
 * If a user is in multiple C3 groups, the highest-priority role wins.
 * Priority: owner > operations > hr > legal > finance > management > visitor.
 *
 * ── SP REST endpoint ─────────────────────────────────────────────────────
 *
 *   GET {siteUrl}/_api/web/currentUser/groups?$select=Title
 *   Accept: application/json;odata=nometadata
 *   credentials: same-origin
 *
 * Returns: { value: [{ Title: "..." }, ...] }
 *
 * See also: SharePointHost.tsx, S18 Beta Release Checklist.md §B1
 */

import type { C3Role } from '@c3/types';

// ---------------------------------------------------------------------------
// Group → role mapping (ordered by priority: highest first)
// ---------------------------------------------------------------------------

/**
 * Ordered list of [SP group title, C3Role] pairs.
 * Evaluation stops at the first match — earlier entries win.
 * Export allows tests and documentation to reference the canonical mapping.
 */
export const SP_GROUP_ROLE_PRIORITY: ReadonlyArray<readonly [string, C3Role]> = [
  ['C3 Platform Owners', 'owner'],
  ['C3 Operations',      'operations'],
  ['C3 HR',              'hr'],
  ['C3 Legal',           'legal'],
  ['C3 Finance',         'finance'],
  ['C3 Management',      'management'],
] as const;

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Resolves the C3Role for the current authenticated SP user.
 *
 * Fetches the user's SP group memberships from the same-origin SP REST API
 * and maps the result to the highest-priority matching C3Role.
 *
 * Fails closed to 'visitor' on any error or absence of a group match.
 * Safe to await multiple times — callers should cache the returned Promise.
 *
 * @param siteUrl   Absolute URL of the SharePoint web (pageContext.web.absoluteUrl).
 * @param loginName SPFx claims login name (pageContext.user.loginName).
 */
export async function resolveSPRole(
  siteUrl: string,
  loginName: string,
): Promise<C3Role> {
  // Fail closed immediately — no fetch if identity is missing.
  if (!loginName.trim()) {
    console.warn(
      '[C3/RoleResolver] loginName is empty. Defaulting to visitor. ' +
      'Ensure pageContext.user.loginName is populated by the SPFx host.',
    );
    return 'visitor';
  }
  if (!siteUrl.trim()) {
    console.warn('[C3/RoleResolver] siteUrl is empty. Defaulting to visitor.');
    return 'visitor';
  }

  // ── Fetch SP group memberships ─────────────────────────────────────────
  let groups: string[];
  try {
    const endpoint =
      `${siteUrl.replace(/\/+$/, '')}/_api/web/currentUser/groups?$select=Title`;

    const res = await fetch(endpoint, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json;odata=nometadata' },
    });

    if (!res.ok) {
      console.warn(
        `[C3/RoleResolver] SP groups fetch returned HTTP ${res.status}. ` +
        'Defaulting to visitor.',
      );
      return 'visitor';
    }

    const data = (await res.json()) as { value?: Array<{ Title?: string }> };

    if (!Array.isArray(data.value)) {
      console.error(
        '[C3/RoleResolver] Unexpected response shape from SP groups endpoint. ' +
        'Defaulting to visitor.',
        data,
      );
      return 'visitor';
    }

    groups = data.value
      .map(g => (typeof g.Title === 'string' ? g.Title : ''))
      .filter(Boolean);

  } catch (err) {
    console.error(
      '[C3/RoleResolver] Failed to fetch SP group memberships. ' +
      'Defaulting to visitor.',
      err,
    );
    return 'visitor';
  }

  // ── Map to C3Role (priority order) ────────────────────────────────────
  for (const [groupTitle, role] of SP_GROUP_ROLE_PRIORITY) {
    if (groups.includes(groupTitle)) {
      console.info(`[C3/RoleResolver] Resolved role '${role}' via group '${groupTitle}'.`);
      return role;
    }
  }

  console.info(
    '[C3/RoleResolver] No C3 group matched for this user. Defaulting to visitor. ' +
    `Groups found: ${groups.length ? groups.join(', ') : '(none)'}`,
  );
  return 'visitor';
}
