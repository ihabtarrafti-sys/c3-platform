import { useMutation, useQueryClient } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useCredentialService } from '@c3/hooks/useCredentialService';
import type { CreateCredentialInput } from '@c3/types';

/**
 * Mutation hook for registering a new credential for a Person.
 *
 * On success, invalidates:
 *   - person.credentials(personId) — usePersonCredentials
 *
 * Invalidating the credential list causes:
 *   1. The Credentials tab in PersonProfile to re-render with the new credential.
 *   2. usePersonReadiness (memoized on credential data) to recompute — the
 *      ReadinessPanel will immediately reflect any obligation status changes.
 *
 * Pattern: parallel factory (ICredentialService, not SPService).
 * Ref: ADR-001-service-access-pattern.md
 */
export const useAddCredential = () => {
  const qc = useQueryClient();
  const credentialService = useCredentialService();

  return useMutation({
    mutationFn: (input: CreateCredentialInput) =>
      credentialService.addCredential(input),
    onSuccess: (_, input) => {
      // Per-person invalidation: keeps PersonProfile credential list and ReadinessPanel live.
      void qc.invalidateQueries({
        queryKey: queryKeys.person.credentials(input.HolderPersonID),
      });
      // Batch invalidation: keeps Situation Room gaps current when a credential is added.
      void qc.invalidateQueries({
        queryKey: queryKeys.credentials.all(),
      });
    },
  });
};
