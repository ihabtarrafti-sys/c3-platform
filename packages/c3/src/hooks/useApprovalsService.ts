/**
 * useApprovalsService.ts
 *
 * Returns the active IApprovalsService for the current data source mode.
 *
 * Follows the parallel-factory hook pattern (useJourneyService, useCredentialService).
 * Approvals are NOT in the ServiceRegistry because the service requires both
 * siteUrl AND currentUser.loginName — the identity is needed to stamp SubmittedBy.
 *
 * currentUser is always non-null here: AppProvider renders a loading spinner
 * until authService.getCurrentUser() resolves, so by the time any child
 * component calls useApp(), currentUser is guaranteed to be set.
 *
 * Sprint 18 Phase 2B — createApproval live; all other methods throw (Phase 3).
 */

import { useMemo } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { createMockApprovalsService } from '@c3/services/mock/MockApprovalsService';
import { createSharePointApprovalsService } from '@c3/services/sharepoint/SharePointApprovalsService';
import type { IApprovalsService } from '@c3/services/interfaces/IApprovalsService';

export const useApprovalsService = (): IApprovalsService => {
  const { config, currentUser } = useApp();

  return useMemo(() => {
    if (config.dataSourceMode === 'sharepoint') {
      return createSharePointApprovalsService(config.spSiteUrl, currentUser.loginName);
    }
    return createMockApprovalsService(currentUser.loginName);
  }, [config.dataSourceMode, config.spSiteUrl, currentUser.loginName]);
};
