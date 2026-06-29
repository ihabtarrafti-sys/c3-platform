import { useMemo } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { useContracts } from '@c3/hooks/useContracts';
import { normalizeUserEmail } from '@c3/utils/userUtils';

export const useMyContracts = () => {
  const { currentUser } = useApp();
  const { data = [], ...rest } = useContracts();

  const myContracts = useMemo(
    () =>
      data.filter(contract => {
        return (
          normalizeUserEmail(contract.ContractOwner?.EMail) ===
          normalizeUserEmail(currentUser.email)
        );
      }),
    [data, currentUser.email]
  );

  return {
    data: myContracts,
    ...rest,
  };
};