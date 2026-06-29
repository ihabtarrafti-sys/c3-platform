import { useMemo } from 'react';

import { useContracts } from '@c3/hooks/useContracts';
import { computeDaysToExpiry } from '@c3/utils/dateUtils';

export const useRenewalContracts = () => {
  const { data = [], ...rest } = useContracts();

  const renewalContracts = useMemo(
    () =>
      data.filter(contract => {
        const days = computeDaysToExpiry(contract.EndDate);
        return days <= 90;
      }),
    [data]
  );

  return {
    data: renewalContracts,
    ...rest,
  };
};