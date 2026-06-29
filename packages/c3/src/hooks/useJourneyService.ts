import { useMemo } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { createMockJourneyService } from '@c3/services/mock/MockJourneyService';
import { createSharePointJourneyService } from '@c3/services/sharepoint/SharePointJourneyService';
import type { IJourneyService } from '@c3/services/interfaces/IJourneyService';

/**
 * Returns the active IJourneyService for the current data source mode.
 *
 * Journey management does not flow through the SPService monolith.
 * This hook follows the same parallel-factory pattern as useCredentialService().
 */
export const useJourneyService = (): IJourneyService => {
  const { config } = useApp();

  return useMemo(() => {
    if (config.dataSourceMode === 'sharepoint') {
      return createSharePointJourneyService();
    }
    return createMockJourneyService();
  }, [config.dataSourceMode]);
};
