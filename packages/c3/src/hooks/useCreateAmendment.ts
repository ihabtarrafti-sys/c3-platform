/**
 * useCreateAmendment — mutation hook for creating an amendment via flowService.
 *
 * On success, invalidates the amendments query for the given contract so that
 * the Amendments tab refreshes automatically.
 *
 * flowService is instantiated with an empty URL because it is currently a stub
 * (returns Promise.resolve). When the real Power Automate flow is wired up,
 * the URL will be sourced from AppConfig.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { flowService } from '@c3/services/flows';
import type { CreateAmendmentInput } from '@c3/services/flows';

export const useCreateAmendment = (contractId: string) => {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateAmendmentInput) =>
      flowService('').createAmendment(input),
    onSuccess: () => {
      void qc.invalidateQueries({
        queryKey: queryKeys.amendments.forContract(contractId),
      });
    },
  });
};
