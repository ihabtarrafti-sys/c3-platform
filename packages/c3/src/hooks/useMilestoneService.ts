import { useMemo } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { createMockMilestoneService } from '@c3/services/mock/MockMilestoneService';
import { createSharePointMilestoneService } from '@c3/services/sharepoint/SharePointMilestoneService';
import type { IMilestoneService } from '@c3/services/interfaces/IMilestoneService';

/**
 * Returns the active IMilestoneService for the current data source mode.
 *
 * Milestone management follows the parallel factory pattern (ADR-001). The
 * service factory is memoized on dataSourceMode — stable across renders unless
 * the host environment changes.
 *
 * Sprint 12 (S12-2): mock implementation active; SharePoint is a graceful stub.
 */
export const useMilestoneService = (): IMilestoneService => {
  const { config } = useApp();

  return useMemo(() => {
    if (config.dataSourceMode === 'sharepoint') {
      return createSharePointMilestoneService();
    }
    return createMockMilestoneService();
  }, [config.dataSourceMode]);
};
