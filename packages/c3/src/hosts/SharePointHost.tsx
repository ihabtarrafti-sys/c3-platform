/**
 * SharePointHost.tsx
 *
 * SP-mode host component. Reads the HostContext populated by C3HostWebPart
 * (via mountC3.tsx) and assembles a typed AppConfig for the C3 runtime.
 *
 * Identity: pageContext.user.loginName is threaded through the SPFx host chain
 * (IC3HostProps -> C3HostWebPart -> C3Host -> HostContext.userLoginName) and
 * surfaced here as currentUser.loginName.
 *
 * ── Role resolution (Sprint 19 Phase 1) ──────────────────────────────────
 *
 * c3Role is resolved from SharePoint security group membership via
 * resolveSPRole() in spRoleResolver.ts. The role promise is memoized
 * on [spSiteUrl, userLoginName] — the SP REST fetch fires exactly once
 * per component mount. AppContext awaits it while showing a loading spinner.
 *
 * Group-to-role mapping (priority order):
 *   C3 Platform Owners  →  owner
 *   C3 Operations       →  operations
 *   C3 HR               →  hr
 *   C3 Legal            →  legal
 *   C3 Finance          →  finance
 *   C3 Management       →  management
 *   (no match)          →  visitor
 *
 * Fail-close: empty loginName, empty siteUrl, fetch failure, or no group
 * match all produce 'visitor'. See spRoleResolver.ts for full detail.
 *
 * ── Other non-production fields ───────────────────────────────────────────
 *
 *   currentUser.email
 *     Empty string. Not threaded from SPFx pageContext. Unused in beta.
 *
 *   authService.getAccessToken
 *     Returns empty string. Not required for same-origin SP REST calls
 *     (credentials: 'same-origin'). Not a security gap in hosted-workbench.
 *
 * Replaces prior placeholder: `export const SharePointHost = () => <div>...</div>`
 */

import { useMemo } from 'react';

import type { AppConfig } from '@c3/config/AppConfig';
import type { C3CurrentUser } from '@c3/services/auth';
import { C3App } from '@c3/App';
import { useHostContext } from './HostContext';
import { resolveSPRole } from './spRoleResolver';

export const SharePointHost = () => {
  const host = useHostContext();

  const loginName = host.userLoginName ?? '';
  const siteUrl   = host.spSiteUrl    ?? '';

  // Resolve the C3Role from SP group membership exactly once per mount.
  // useMemo ensures the Promise is not recreated on re-renders unless
  // siteUrl or loginName changes (both are stable after mount).
  // AppContext awaits this promise inside getCurrentUser() and renders a
  // loading spinner until it resolves.
  const rolePromise = useMemo(
    () => resolveSPRole(siteUrl, loginName),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteUrl, loginName],
  );

  const currentUser: C3CurrentUser = {
    displayName: '', // not threaded from SPFx pageContext
    email:       '', // not threaded from SPFx pageContext
    loginName,
    // c3Role is intentionally absent here — it is resolved asynchronously
    // by getCurrentUser() below. The AppContext loading spinner covers the gap.
    c3Role: 'visitor', // safe initial value; overwritten by getCurrentUser()
  };

  const config: AppConfig = {
    environment:    host.environment,
    dataSourceMode: host.dataSourceMode,
    spSiteUrl:      siteUrl,
    disableToasts:  host.disableToasts,
    authService: {
      /**
       * Called once by AppContext on mount. Awaits the memoized rolePromise
       * so the SP group fetch fires exactly once regardless of re-renders.
       */
      getCurrentUser: async (): Promise<C3CurrentUser> => {
        const c3Role = await rolePromise;
        return { ...currentUser, c3Role };
      },
      // getAccessToken not required for same-origin SP REST calls.
      getAccessToken: async () => '',
    },
  };

  return <C3App config={config} />;
};
