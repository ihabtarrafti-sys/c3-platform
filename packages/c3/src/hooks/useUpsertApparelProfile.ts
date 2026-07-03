import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useApp } from '@c3/hooks/useApp';
import { useApparelProfileService } from '@c3/hooks/useApparelProfileService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { ApparelProfile, UpsertApparelProfileInput } from '@c3/types';

/**
 * Mutation: create or update a person's apparel profile (S29A — role-gated
 * master-data update: owner/operations/hr).
 *
 * Creates when no active profile exists; updates the exact active row with
 * its actual ETag otherwise. SP version history is the authoritative audit.
 *
 * actorLoginName is stamped from the authenticated AppContext user.
 * Invalidates the person's profile cache and the batch cache. Errors throw
 * for toast surfacing.
 */
export const useUpsertApparelProfile = () => {
  const qc = useQueryClient();
  const apparelService = useApparelProfileService();
  const { currentUser } = useApp();

  return useMutation<ApparelProfile, Error, Omit<UpsertApparelProfileInput, 'actorLoginName'>>({
    mutationFn: input =>
      apparelService.upsertApparelProfile({ ...input, actorLoginName: currentUser.loginName }),

    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: queryKeys.apparel.byPerson(input.PersonID) });
      void qc.invalidateQueries({ queryKey: queryKeys.apparel.all() });
    },
  });
};
