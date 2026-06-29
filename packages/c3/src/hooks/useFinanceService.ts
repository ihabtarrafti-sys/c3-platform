import { useMemo } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { createMockFinanceService } from '@c3/services/mock/MockFinanceService';
import { createSharePointFinanceService } from '@c3/services/sharepoint/SharePointFinanceService';
import type { IFinanceService } from '@c3/services/interfaces/IFinanceService';

/**
 * Returns the active IFinanceService for the current data source mode.
 *
 * Finance management follows the parallel factory pattern (ADR-001). The
 * service factory is memoized on dataSourceMode — stable across renders unless
 * the host environment changes.
 *
 * Sprint 13 (S13-2): mock implementation active; SharePoint is a graceful stub.
 */
export const useFinanceService = (): IFinanceService => {
  const { config } = useApp();

  return useMemo(() => {
    if (config.dataSourceMode === 'sharepoint') {
      return createSharePointFinanceService();
    }
    return createMockFinanceService();
  }, [config.dataSourceMode]);
};
