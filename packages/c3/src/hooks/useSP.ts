import { useMemo } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { createSPService } from '@c3/services/sp';

export const useSP = () => {
  const { config } = useApp();

  return useMemo(
    () =>
      createSPService({
        siteUrl: config.spSiteUrl,
        mode: config.dataSourceMode,
      }),
    [config.spSiteUrl, config.dataSourceMode],
  );
};