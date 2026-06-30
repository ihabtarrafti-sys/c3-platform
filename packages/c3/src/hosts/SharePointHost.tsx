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
 * ── Beta / non-production stubs (Sprint 18 Phase 4B) ──────────────────────
 *
 *   currentUser.email
 *     Empty string. Not threaded from SPFx pageContext. Unused in beta.
 *
 *   currentUser.c3Role
 *     ⚠ WARNING — TEMPORARY BETA STUB. NOT PRODUCTION AUTHORIZATION.
 *     Hardcoded 'owner' for Sprint 18 Phase 4B hosted-workbench validation.
 *     All users see the owner role (Approvals screen + Approve/Reject/Execute).
 *     Real role resolution (SP security group membership lookup) is a future
 *     sprint deliverable. Before go-live this stub MUST be replaced with a
 *     real group-membership check. Do NOT deploy to production as-is.
 *     ADR-013 self-approval enforcement is enforced at the hook layer
 *     (patchApprovalStatus) and is not affected by the role stub.
 *
 *   authService.getAccessToken
 *     Returns empty string. Not required for same-origin SP REST calls
 *     (credentials: 'same-origin'). Not a security gap in hosted-workbench.
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
    // ⚠ BETA STUB — NOT PRODUCTION AUTHORIZATION. See file-level comment.
    // Hardcoded 'owner' for Sprint 18 Phase 4B hosted-workbench validation only.
    // Replace with real SP group membership lookup before go-live.
    c3Role: 'owner',
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
