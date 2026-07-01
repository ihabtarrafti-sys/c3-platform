import { useQuery } from '@tanstack/react-query';
import type { Contract } from '@c3/types';
import { useSP } from '@c3/hooks/useSP';
import { queryKeys } from '@c3/hooks/queryKeys';

/**
 * usePersonContracts
 *
 * Sprint 24 Phase 1 — Updated to use PersonID (PER-XXXX string) as the
 * query key and service argument. Replaces the legacy numeric Id.
 *
 * Query is disabled (returns []) when personId is empty — covers the
 * loading state where person?.PersonID is still undefined.
 */
export const usePersonContracts = (personId: string) => {
  const sp = useSP();
  return useQuery<Contract[]>({
    queryKey: queryKeys.person.contracts(personId),
    queryFn: () => sp.listPersonContracts(personId),
    enabled: personId.trim().length > 0,
  });
};
