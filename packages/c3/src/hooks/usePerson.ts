import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import type { Person } from '@c3/types';

export const usePerson = (personId: string) => {
  const sp = useSP();

  return useQuery<Person>({
    queryKey: queryKeys.people.detail(personId),
    queryFn: () => sp.getPerson(personId),
    enabled: personId.trim().length > 0,
  });
};