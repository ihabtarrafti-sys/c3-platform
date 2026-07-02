/**
 * useResumeJourney.ts
 *
 * Sprint 19 Phase 2 -- Journey Lifecycle Transitions.
 *
 * Mutation hook for resuming a Suspended Journey (-> Active).
 *
 * Governance: direct role-gated operational action (owner | operations).
 * Not approval-gated. See: docs/architecture/ADR-013 Addendum -- Journey Lifecycle Transitions.md
 *
 * On success, invalidates:
 *   - journey.list(personId)       -- PersonProfile journey card
 *   - journey.active(personId, type) -- useActiveJourney callers
 *   - journey.allActive(type)      -- Situation Room aggregation (resumed -> now Active)
 *
 * Throws InvalidTransitionError when the journey is not Suspended.
 * Throws when actorLoginName is empty (service fail-close).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useJourneyService } from '@c3/hooks/useJourneyService';
import type { Journey } from '@c3/types';

export interface ResumeJourneyVariables {
  journeyId: string;
  actorLoginName: string;
  /** PersonID of the journey owner -- used to scope query invalidation. */
  personId: string;
  /** JourneyType -- used to scope allActive invalidation. */
  journeyType: Journey['Type'];
}

export const useResumeJourney = () => {
  const qc = useQueryClient();
  const journeyService = useJourneyService();

  return useMutation({
    mutationFn: ({ journeyId, actorLoginName }: ResumeJourneyVariables) =>
      journeyService.resumeJourney({ journeyId, actorLoginName }),

    onSuccess: (_, { personId, journeyType }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.journey.list(personId) });
      void qc.invalidateQueries({ queryKey: queryKeys.journey.active(personId, journeyType) });
      void qc.invalidateQueries({ queryKey: queryKeys.journey.allActive(journeyType) });
    },
  });
};
