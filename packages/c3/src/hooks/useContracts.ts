import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import { useApp } from '@c3/hooks/useApp';
import { canAccessContracts } from '@c3/utils/rolePolicy';
import type { Contract } from '@c3/types';

/**
 * useContracts
 *
 * S33 Set E — `roleDenied` is true when the current role has no C3Contracts
 * access (security-trimmed as HTTP 404). The register query is NOT issued in
 * that case; ContractsList renders an explicit unavailable-for-role state
 * rather than a false empty register. Authorized roles keep the normal
 * behaviour: a genuine empty result renders as an empty register, and a read
 * failure/unprovisioned list renders as failure (never silently emptied).
 */
export const useContracts = () => {
  const sp = useSP();
  const { currentUser } = useApp();
  const roleDenied = !canAccessContracts(currentUser.c3Role);
  const query = useQuery<Contract[]>({
    queryKey: queryKeys.contracts.all(),
    queryFn: () => sp.listContracts(),
    enabled: !roleDenied,
  });
  return { ...query, roleDenied };
};
