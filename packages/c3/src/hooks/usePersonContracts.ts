import { useQuery } from '@tanstack/react-query';
import type { Contract } from '@c3/types';
import { useSP } from '@c3/hooks/useSP';
import { useApp } from '@c3/hooks/useApp';
import { queryKeys } from '@c3/hooks/queryKeys';
import { canAccessContracts } from '@c3/utils/rolePolicy';

/**
 * usePersonContracts
 *
 * Sprint 24 Phase 1 — Uses PersonID (PER-XXXX string) as the query key and
 * service argument.
 *
 * S33 Set E — `roleDenied` is true when the current role has no C3Contracts
 * access (security-trimmed). The query is NOT issued in that case, so no
 * contract read is made during normal navigation and a denied domain can
 * never surface as a false empty count. Callers must branch on `roleDenied`
 * and render an explicit unavailable-for-role state instead of a zero count.
 */
export const usePersonContracts = (personId: string) => {
  const sp = useSP();
  const { currentUser } = useApp();
  const roleDenied = !canAccessContracts(currentUser.c3Role);
  const query = useQuery<Contract[]>({
    queryKey: queryKeys.person.contracts(personId),
    queryFn: () => sp.listPersonContracts(personId),
    enabled: personId.trim().length > 0 && !roleDenied,
  });
  return { ...query, roleDenied };
};
