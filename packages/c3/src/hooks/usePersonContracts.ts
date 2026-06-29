import { useQuery } from '@tanstack/react-query';

import { useSP } from '@c3/hooks/useSP';
import type { Contract } from '@c3/types';

export const usePersonContracts = (personId: number) => {
  const sp = useSP();

  return useQuery<Contract[]>({
    queryKey: ['person-contracts', personId],
    queryFn: () => sp.listPersonContracts(personId),
    enabled: personId > 0,
  });
};