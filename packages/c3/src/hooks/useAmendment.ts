import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import type { Amendment } from '@c3/types';

export const useAmendment = (amendmentId: string) => {
  const sp = useSP();

  return useQuery<Amendment>({
    queryKey: queryKeys.amendments.detail(amendmentId),
    queryFn: () => sp.getAmendment(amendmentId),
    enabled: amendmentId.trim().length > 0,
  });
};