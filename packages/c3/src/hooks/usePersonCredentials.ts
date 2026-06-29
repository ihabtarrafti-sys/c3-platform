import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useCredentialService } from '@c3/hooks/useCredentialService';
import type { Credential } from '@c3/types';

/**
 * Returns all active credentials held by a Person.
 *
 * Credentials are first-class operational entities — not fields on Person.
 * This hook is the primary read surface for a person's credential set.
 */
export const usePersonCredentials = (personId: string) => {
  const credentialService = useCredentialService();

  return useQuery<Credential[]>({
    queryKey: queryKeys.person.credentials(personId),
    queryFn: () => credentialService.listCredentialsForPerson(personId),
    enabled: personId.trim().length > 0,
  });
};
