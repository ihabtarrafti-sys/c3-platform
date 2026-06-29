import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import type { DiagnosticsReport } from '@c3/types';

export const useDiagnostics = () => {
  const sp = useSP();

  const query = useQuery<DiagnosticsReport>({
    queryKey: queryKeys.diagnostics.report(),
    queryFn: () => sp.getDiagnostics(),
  });

  const adapter = useMemo(() => sp.getAdapterInfo(), [sp]);

  return {
    ...query,
    adapter,
  };
};