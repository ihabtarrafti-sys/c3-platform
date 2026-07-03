import { useMemo } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { createMockApparelProfileService } from '@c3/services/mock/MockApparelProfileService';
import { createSharePointApparelProfileService } from '@c3/services/sharepoint/SharePointApparelProfileService';
import type { IApparelProfileService } from '@c3/services/interfaces/IApparelProfileService';

/**
 * Returns the active IApparelProfileService for the current data source mode.
 *
 * Parallel factory pattern (ADR-001), memoized on dataSourceMode/spSiteUrl —
 * same shape as useMissionService.
 *
 * Sprint 28 (S28-3): read-only foundation; both implementations live.
 */
export const useApparelProfileService = (): IApparelProfileService => {
  const { config } = useApp();

  return useMemo(() => {
    if (config.dataSourceMode === 'sharepoint') {
      return createSharePointApparelProfileService(config.spSiteUrl);
    }
    return createMockApparelProfileService();
  }, [config.dataSourceMode, config.spSiteUrl]);
};
