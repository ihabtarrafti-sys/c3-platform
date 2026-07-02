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
  // fix(s24-p1): Use isPending (not isLoading) so the skeleton holds from frame 0.
  // React Query v5: isLoading = isPending && isFetching. On the very first render,
  // fetchStatus starts as 'idle' before effects run, so isLoading = false even
  // though data is still undefined. isPending = status === 'pending' is true from
  // frame 0 regardless of fetchStatus, preventing a flash of full content with
  // empty data that unmounts Fluent UI Card style-cache Maps mid-cycle.
  const {
    data: contracts = [],
    isPending: contractsPending,
    error: contractsError,
  } = useContracts();
  const {
    data: amendments = [],
    isPending: amendmentsPending,
    error: amendmentsError,
  } = useAmendments();
  const {
    data: people = [],
    isPending: peoplePending,
    error: peopleError,
  } = usePeople();

  const intelligence = useMemo(
    () => ({
      kpis: getContractKpis(
        Array.isArray(contracts) ? contracts : [],
        Array.isArray(amendments) ? amendments.length : 0,
      ),
      workflow: getWorkflowBreakdown(Array.isArray(contracts) ? contracts : []),
      dispositions: getDispositionBreakdown(Array.isArray(contracts) ? contracts : []),
      amendments: getAmendmentBreakdown(Array.isArray(amendments) ? amendments : []),
      games: getGameBreakdown(Array.isArray(contracts) ? contracts : []),
      teams: getTeamBreakdown(Array.isArray(contracts) ? contracts : []),
      insights: getOperationalInsights({
        contracts: Array.isArray(contracts) ? contracts : [],
        amendments: Array.isArray(amendments) ? amendments : [],
        people: Array.isArray(people) ? people : [],
      }),
    }),
    [contracts, amendments, people],
  );

  return {
    isLoading: contractsPending || amendmentsPending || peoplePending,
    error: contractsError ?? amendmentsError ?? peopleError,
    intelligence,
  };
};
