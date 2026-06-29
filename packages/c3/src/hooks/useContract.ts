import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import type { Contract } from '@c3/types';

export const useContract = (contractId: string) => {
  const sp = useSP();

  return useQuery<Contract>({
    queryKey: queryKeys.contract.detail(contractId),
    queryFn: () => sp.getContract(contractId),
    enabled: contractId.trim().length > 0,
  });
};