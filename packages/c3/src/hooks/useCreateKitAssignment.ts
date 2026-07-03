import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useApp } from '@c3/hooks/useApp';
import { useMissionService } from '@c3/hooks/useMissionService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { CreateKitAssignmentInput, KitAssignment } from '@c3/types';

/**
 * Mutation: create a kit assignment (S29A — ADR-013 Addendum, role-gated
 * owner/operations).
 *
 * actorLoginName is stamped HERE from the authenticated AppContext user —
 * callers pass the business fields only. Never operator-entered (fail-close
 * enforced again in the service).
 *
 * Invalidates BOTH kit caches (per-mission and batch) on success.
 * Errors are thrown to the caller — screens surface them via toast
 * (no silent mutation failures).
 */
export const useCreateKitAssignment = () => {
  const qc = useQueryClient();
  const missionService = useMissionService();
  const { currentUser } = useApp();

  return useMutation<KitAssignment, Error, Omit<CreateKitAssignmentInput, 'actorLoginName'>>({
    mutationFn: input =>
      missionService.createKitAssignment({ ...input, actorLoginName: currentUser.loginName }),

    onSuccess: (_, input) => {
      void qc.invalidateQueries({ queryKey: queryKeys.mission.kitAssignments(input.MissionID) });
      void qc.invalidateQueries({ queryKey: queryKeys.mission.allKitAssignments() });
    },
  });
};
