import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import type { Contract } from '@c3/types';

export const useContracts = () => {
  const sp = useSP();

  return useQuery<Contract[]>({
    queryKey: queryKeys.contracts.all(),
    queryFn: () => sp.listContracts(),
  });
};