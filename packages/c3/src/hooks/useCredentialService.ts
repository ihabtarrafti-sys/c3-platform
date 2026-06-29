import { useMemo } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { createMockCredentialService } from '@c3/services/mock/MockCredentialService';
import { createSharePointCredentialService } from '@c3/services/sharepoint/SharePointCredentialService';
import type { ICredentialService } from '@c3/services/interfaces/ICredentialService';

/**
 * Returns the active ICredentialService for the current data source mode.
 *
 * Credentials are a first-class operational entity and do not flow through
 * the SPService monolith. This hook follows the same pattern as useSP() but
 * is scoped to the Credential domain.
 */
export const useCredentialService = (): ICredentialService => {
  const { config } = useApp();

  return useMemo(() => {
    if (config.dataSourceMode === 'sharepoint') {
      return createSharePointCredentialService(config.spSiteUrl);
    }
    return createMockCredentialService();
  }, [config.dataSourceMode, config.spSiteUrl]
  );
};
