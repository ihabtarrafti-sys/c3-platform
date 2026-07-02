/**
 * usePersonService.ts
 *
 * Returns the active IPersonService for the current data source mode.
 *
 * Follows the same pattern as useCredentialService (Sprint 20 Phase 3).
 * The Person domain is separated from the SPService monolith so that
 * createPerson() can be surfaced without adding write methods to SPService.
 *
 * Sprint 25 -- createPerson() added to IPersonService; this hook provides
 * the wiring for both Mock and SharePoint execution paths.
 *
 * Used by useExecuteApproval (AddPerson branch) and useSubmitAddPersonApproval.
 */

import { useMemo } from 'react';
import { useApp } from '@c3/hooks/useApp';
import { createMockPersonService } from '@c3/services/mock/MockPersonService';
import { createSharePointPersonService } from '@c3/services/sharepoint/SharePointPersonService';
import type { IPersonService } from '@c3/services/interfaces/IPersonService';

export const usePersonService = (): IPersonService => {
  const { config } = useApp();

  return useMemo(() => {
    if (config.dataSourceMode === 'sharepoint') {
      return createSharePointPersonService(config.spSiteUrl);
    }
    return createMockPersonService();
  }, [config.dataSourceMode, config.spSiteUrl]);
};
