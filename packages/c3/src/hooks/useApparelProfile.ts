import { useQuery } from '@tanstack/react-query';

import { useApparelProfileService } from '@c3/hooks/useApparelProfileService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { ApparelProfile } from '@c3/types';

/**
 * Fetches the active apparel profile for a person.
 *
 * `data === null` means no profile exists — a NORMAL state ("No apparel
 * profile on file."), never an error or a readiness failure. `undefined`
 * means the query has not resolved yet.
 *
 * Safe to call with an empty string (returns immediately via the `enabled`
 * guard without triggering a fetch).
 *
 * Sprint 28 (S28-3).
 */
export const useApparelProfile = (
  personId: string,
): { data: ApparelProfile | null | undefined; isLoading: boolean } => {
  const apparelService = useApparelProfileService();

  const { data, isLoading } = useQuery<ApparelProfile | null>({
    queryKey: queryKeys.apparel.byPerson(personId),
    queryFn: () => apparelService.getApparelProfile(personId),
    enabled: personId.length > 0,
  });

  return { data, isLoading };
};
