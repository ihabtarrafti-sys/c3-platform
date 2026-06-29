import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import type { Amendment } from '@c3/types';

export const useAmendments = () => {
  const sp = useSP();

  return useQuery<Amendment[]>({
    queryKey: queryKeys.amendments.all(),
    queryFn: () => sp.listAllAmendments(),
  });
};