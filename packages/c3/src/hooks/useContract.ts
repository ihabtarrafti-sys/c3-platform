import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import { useApp } from '@c3/hooks/useApp';
import { canAccessContracts } from '@c3/utils/rolePolicy';
import type { Contract } from '@c3/types';

/**
 * useContract — S33 Set E: `roleDenied` short-circuits the read for roles
 * without C3Contracts access (security-trimmed). ContractProfile renders an
 * explicit unavailable-for-role state; no contract detail query is issued.
 */
export const useContract = (contractId: string) => {
  const sp = useSP();
  const { currentUser } = useApp();
  const roleDenied = !canAccessContracts(currentUser.c3Role);
  const query = useQuery<Contract>({
    queryKey: queryKeys.contract.detail(contractId),
    queryFn: () => sp.getContract(contractId),
    enabled: contractId.trim().length > 0 && !roleDenied,
  });
  return { ...query, roleDenied };
};
