/**
 * useGetCredential.ts
 *
 * Sprint 23 Phase 1 -- single-credential fetch by CRED-XXXX identifier.
 *
 * Returns the credential regardless of IsActive status -- unlike
 * usePersonCredentials which only returns active credentials.
 *
 * Primary use: deactivation recovery detection in ApprovalInbox.
 * For an Approved DeactivateCredential card, we need to check whether
 * the credential is already IsActive = false (i.e. deactivation was applied
 * but the approval stamp failed). usePersonCredentials cannot do this because
 * it filters IsActive = true via listCredentialsForPerson.
 *
 * Returns null on not-found or error -- never throws. The enabled guard
 * suppresses the query when credentialId is empty or the card is not a
 * deactivation recovery candidate.
 *
 * See: packages/c3/src/hooks/useRecoverDeactivationExecutionStamp.ts
 * See: packages/c3/src/screens/ApprovalInbox.tsx (recovery detection)
 */

import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useCredentialService } from '@c3/hooks/useCredentialService';
import type { Credential } from '@c3/types';

/**
 * Fetch a single credential by CredentialID (CRED-XXXX).
 *
 * @param credentialId  CRED-XXXX identifier. Query suppressed when empty.
 * @param enabled       Additional enabled guard (default true). Callers set
 *                      this to false when the card is not a recovery candidate.
 */
export const useGetCredential = (credentialId: string, enabled = true) => {
  const credentialService = useCredentialService();

  return useQuery<Credential | null>({
    queryKey: queryKeys.credential.byId(credentialId),
    queryFn: async (): Promise<Credential | null> => {
      try {
        const credential = await credentialService.getCredential(credentialId);
        // getCredential returns null (cast as Credential) when not found -- normalise.
        return credential ?? null;
      } catch {
        // Network / SP error -- not a recovery case; return null to suppress Recover button.
        return null;
      }
    },
    enabled: credentialId.trim().length > 0 && enabled,
  });
};
