import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useApp } from '@c3/hooks/useApp';
import { useMissionService } from '@c3/hooks/useMissionService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { KitAssignment, KitStatusTransitionRequest } from '@c3/types';

/**
 * Mutation: transition a kit assignment's status (S29A lifecycle exemption,
 * role-gated owner/operations).
 *
 * The service re-reads the CURRENT SharePoint status and validates the
 * transition matrix authoritatively — the UI menu is affordance only.
 * MERGE uses the row's actual ETag; a concurrent edit surfaces as
 * ConcurrencyError ("refresh and retry").
 *
 * actorLoginName is stamped from the authenticated AppContext user.
 * Invalidates BOTH kit caches on success. Errors throw to the caller for
 * toast surfacing.
 */
export const useTransitionKitStatus = () => {
  const qc = useQueryClient();
  const missionService = useMissionService();
  const { currentUser } = useApp();

  return useMutation<KitAssignment, Error, Omit<KitStatusTransitionRequest, 'actorLoginName'>>({
    mutationFn: req =>
      missionService.transitionKitStatus({ ...req, actorLoginName: currentUser.loginName }),

    onSuccess: (_, req) => {
      void qc.invalidateQueries({ queryKey: queryKeys.mission.kitAssignments(req.MissionID) });
      void qc.invalidateQueries({ queryKey: queryKeys.mission.allKitAssignments() });
    },
  });
};
