import { useMemo } from 'react';

import { useContracts } from '@c3/hooks/useContracts';
import { computeDaysToExpiry } from '@c3/utils/dateUtils';

export const useRenewalContracts = () => {
  const { data = [], ...rest } = useContracts();

  const renewalContracts = useMemo(
    () =>
      data.filter(contract => {
        if (!contract.EndDate) return false; // fix(s24-p1): guard missing EndDate
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
