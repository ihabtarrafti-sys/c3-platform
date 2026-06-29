import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useJourneyService } from '@c3/hooks/useJourneyService';
import type { Journey, JourneyType } from '@c3/types';

/**
 * Returns all Journeys for a Person, ordered most-recent first.
 *
 * When `type` is provided, results are filtered to that Journey type.
 * When omitted, all Journey types are returned.
 *
 * Use this hook when you need to display journey history or find the most
 * relevant journey regardless of status (active first, then completed, etc.).
 *
 * For a strict "active journey of a given type" query, use useActiveJourney.
 */
export const usePersonJourneys = (personId: string, type?: JourneyType) => {
  const journeyService = useJourneyService();

  return useQuery<Journey[]>({
    queryKey: queryKeys.journey.list(personId),
    queryFn: () => journeyService.listJourneysForPerson(personId, type),
    enabled: personId.trim().length > 0,
  });
};
