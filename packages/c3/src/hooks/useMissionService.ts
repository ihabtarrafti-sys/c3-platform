import { useMemo } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { createMockMissionService } from '@c3/services/mock/MockMissionService';
import { createSharePointMissionService } from '@c3/services/sharepoint/SharePointMissionService';
import type { IMissionService } from '@c3/services/interfaces/IMissionService';

/**
 * Returns the active IMissionService for the current data source mode.
 *
 * Mission management follows the parallel factory pattern (ADR-001). It does
 * not flow through the SPService monolith. The service factory is memoized
 * on dataSourceMode — stable across renders unless the host environment changes.
 *
 * Sprint 10 (M10-1): mock implementation active; SharePoint is a graceful stub.
 * Sprint 26 (S26-2): SharePoint read path live (listMissions / getMission);
 * participants and writes remain stubbed.
 */
export const useMissionService = (): IMissionService => {
  const { config } = useApp();

  return useMemo(() => {
    if (config.dataSourceMode === 'sharepoint') {
      return createSharePointMissionService(config.spSiteUrl);
    }
    return createMockMissionService();
  }, [config.dataSourceMode, config.spSiteUrl]);
};
