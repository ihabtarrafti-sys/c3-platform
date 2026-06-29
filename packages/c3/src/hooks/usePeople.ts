import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '@c3/hooks/queryKeys';
import { useSP } from '@c3/hooks/useSP';
import type { Person } from '@c3/types';

export const usePeople = () => {
  const sp = useSP();

  return useQuery<Person[]>({
    queryKey: queryKeys.people.all(),
    queryFn: () => sp.listPeople(),
  });
};