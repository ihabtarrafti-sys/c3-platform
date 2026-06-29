import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useJourneyService } from '@c3/hooks/useJourneyService';
import type { InitiateJourneyInput } from '@c3/types';

/**
 * Mutation hook for initiating a Journey for a specific person.
 *
 * On success, invalidates:
 *   - journey.active(personId, input.Type)  — useActiveJourney / useOnboardingJourney
 *   - journey.list(personId)                — usePersonJourneys
 *
 * The Readiness tab in PersonProfile will re-render automatically once these
 * queries settle: the new journey card appears and ReadinessPanel surfaces.
 *
 * Pattern: parallel factory (IJourneyService, not SPService).
 * Ref: ADR-001-service-access-pattern.md
 */
export const useInitiateJourney = () => {
  const qc = useQueryClient();
  const journeyService = useJourneyService();

  return useMutation({
    mutationFn: (input: InitiateJourneyInput) =>
      journeyService.initiateJourney(input),
    onSuccess: (_, input) => {
      // Per-person invalidation: keeps PersonProfile Journey card and StartJourneyPanel live.
      void qc.invalidateQueries({
        queryKey: queryKeys.journey.active(input.PersonID, input.Type),
      });
      void qc.invalidateQueries({
        queryKey: queryKeys.journey.list(input.PersonID),
      });
      // Batch invalidation: keeps Situation Room ownership state current when a journey starts.
      void qc.invalidateQueries({
        queryKey: queryKeys.journey.allActive(input.Type),
      });
    },
  });
};
