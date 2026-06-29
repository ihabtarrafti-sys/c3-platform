/**
 * SharePointHost.tsx
 *
 * SP-mode host component. Reads the HostContext populated by C3HostWebPart
 * (via mountC3.tsx) and assembles a typed AppConfig for the C3 runtime.
 *
 * Identity: pageContext.user.loginName is threaded through the SPFx host chain
 * (IC3HostProps → C3HostWebPart → C3Host → HostContext.userLoginName) and
 * surfaced here as currentUser.loginName.
 *
 * Sprint 18 Phase 2B stubs / non-authoritative fields:
 *   - currentUser.email: not threaded from SPFx pageContext yet (empty string).
 *   - currentUser.c3Role: hardcoded 'member' — NOT authoritative.
 *     Real role resolution (SP group membership lookup) is Phase 3 scope.
 *     ADR-013 self-approval enforcement applies at patchApprovalStatus time;
 *     c3Role is not used for access control in Phase 2B.
 *   - authService.getAccessToken: returns empty string (not required for
 *     same-origin SP REST calls with credentials: 'same-origin').
 *
 * Replaces prior placeholder: `export const SharePointHost = () => <div>...</div>`
 */

import type { AppConfig } from '@c3/config/AppConfig';
import type { C3CurrentUser } from '@c3/services/auth';
import { C3App } from '@c3/App';
import { useHostContext } from './HostContext';

export const SharePointHost = () => {
  const host = useHostContext();

  const currentUser: C3CurrentUser = {
    displayName: '',                     // not threaded from SPFx in Phase 2B
    email: '',                           // not threaded from SPFx in Phase 2B
    loginName: host.userLoginName ?? '', // from pageContext.user.loginName
    // STUB — not authoritative. 'visitor' is the most restrictive valid C3Role.
    // Real role resolution (SP group membership lookup) is Phase 3 scope.
    // ADR-013 self-approval enforcement is not implemented in Phase 2B.
    c3Role: 'visitor',
  };

  const config: AppConfig = {
    environment: host.environment,
    dataSourceMode: host.dataSourceMode,
    spSiteUrl: host.spSiteUrl ?? '',
    disableToasts: host.disableToasts,
    authService: {
      getCurrentUser: async () => currentUser,
      // getAccessToken not required for same-origin SP REST calls.
      getAccessToken: async () => '',
    },
  };

  return <C3App config={config} />;
};
