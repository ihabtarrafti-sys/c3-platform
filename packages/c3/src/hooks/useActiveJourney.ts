import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useJourneyService } from '@c3/hooks/useJourneyService';
import type { Journey, JourneyType } from '@c3/types';

/**
 * Returns the active Journey of the given type for a Person, or null if none
 * exists.
 *
 * A Person should have at most one Active journey of each type at a time.
 * The `type` parameter is included in the cache key so queries for different
 * journey types on the same person produce separate cache entries.
 *
 * Journeys belong to Person — they are initiated by operational decision,
 * not by contract or document.
 */
export const useActiveJourney = (personId: string, type: JourneyType) => {
  const journeyService = useJourneyService();

  return useQuery<Journey | null>({
    queryKey: queryKeys.journey.active(personId, type),
    queryFn: () => journeyService.getActiveJourney(personId, type),
    enabled: personId.trim().length > 0,
  });
};
