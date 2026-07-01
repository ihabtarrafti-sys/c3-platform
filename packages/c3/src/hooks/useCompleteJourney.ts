/**
 * useCompleteJourney.ts
 *
 * Sprint 19 Phase 2 — Journey Lifecycle Transitions.
 *
 * Mutation hook for marking an Active Journey as Completed.
 *
 * Governance: direct role-gated operational action (owner | operations).
 * Not approval-gated. See: docs/architecture/ADR-013 Addendum — Journey Lifecycle Transitions.md
 *
 * On success, invalidates:
 *   - journey.list(personId)       — PersonProfile journey card
 *   - journey.allActive(type)      — Situation Room aggregation
 *
 * Throws InvalidTransitionError when the journey is not Active.
 * Throws when actorLoginName is empty (service fail-close).
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useJourneyService } from '@c3/hooks/useJourneyService';
import type { JourneyTransitionRequest } from '@c3/services/interfaces/IJourneyService';
import type { Journey } from '@c3/types';

export interface CompleteJourneyVariables extends JourneyTransitionRequest {
  /** PersonID of the journey owner — used to scope query invalidation. */
  personId: string;
  /** JourneyType — used to scope allActive invalidation. */
  journeyType: Journey['Type'];
}

export const useCompleteJourney = () => {
  const qc = useQueryClient();
  const journeyService = useJourneyService();

  return useMutation({
    mutationFn: ({ journeyId, actorLoginName, reason }: CompleteJourneyVariables) =>
      journeyService.completeJourney({ journeyId, actorLoginName, reason }),

    onSuccess: (_, { personId, journeyType }) => {
      void qc.invalidateQueries({ queryKey: queryKeys.journey.list(personId) });
      void qc.invalidateQueries({ queryKey: queryKeys.journey.active(personId, journeyType) });
      void qc.invalidateQueries({ queryKey: queryKeys.journey.allActive(journeyType) });
    },
  });
};
