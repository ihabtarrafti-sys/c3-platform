import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import type { Activity } from '@c3/types';

export const useContractActivities = (contractId: string) => {
  const sp = useSP();

  return useQuery<Activity[]>({
    queryKey: queryKeys.activities.forContract(contractId),
    queryFn: () => sp.listContractActivities(contractId),
    enabled: contractId.trim().length > 0,
  });
};
