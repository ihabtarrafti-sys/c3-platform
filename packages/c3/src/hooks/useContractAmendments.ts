import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import type { Amendment } from '@c3/types';

export const useContractAmendments = (contractId: string) => {
  const sp = useSP();

  return useQuery<Amendment[]>({
    queryKey: queryKeys.amendments.forContract(contractId),
    queryFn: () => sp.listContractAmendments(contractId),
    enabled: contractId.trim().length > 0,
  });
};