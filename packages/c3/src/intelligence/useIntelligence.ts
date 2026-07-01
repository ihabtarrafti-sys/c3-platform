import { useMemo } from 'react';

import { useAmendments } from '@c3/hooks/useAmendments';
import { useContracts } from '@c3/hooks/useContracts';
import { usePeople } from '@c3/hooks/usePeople';

import { getContractKpis } from '@c3/intelligence/contractKpis';
import {
  getAmendmentBreakdown,
  getDispositionBreakdown,
  getGameBreakdown,
  getTeamBreakdown,
  getWorkflowBreakdown,
} from '@c3/intelligence/intelligenceMetrics';
import { getOperationalInsights } from '@c3/intelligence/operationalInsights';

export const useIntelligence = () => {
  const contractsQuery = useContracts();
  const amendmentsQuery = useAmendments();
  const peopleQuery = usePeople();

  const intelligence = useMemo(() => {
    const contracts = contractsQuery.data ?? [];
    const amendments = amendmentsQuery.data ?? [];
    const people = peopleQuery.data ?? [];

    return {
      kpis: getContractKpis(contracts, amendments.length),
      workflow: getWorkflowBreakdown(contracts),
      dispositions: getDispositionBreakdown(contracts),
      amendments: getAmendmentBreakdown(amendments),
      games: getGameBreakdown(contracts),
      teams: getTeamBreakdown(contracts),
      insights: getOperationalInsights({
        contracts,
        amendments,
        people,
      }),
    };
  }, [contractsQuery.data, amendmentsQuery.data, peopleQuery.data]);

  return {
    isLoading:
      contractsQuery.isLoading ||
      amendmentsQuery.isLoading ||
      peopleQuery.isLoading,

    error:
      contractsQuery.error ??
      amendmentsQuery.error ??
      peopleQuery.error,

    intelligence,
  };
};