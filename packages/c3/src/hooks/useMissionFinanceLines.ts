import { useQuery } from '@tanstack/react-query';

import { useFinanceService } from '@c3/hooks/useFinanceService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { MissionFinanceLine } from '@c3/types';

/**
 * Fetches the raw finance lines for a single mission.
 *
 * Returns lines ordered Income-first then Expense (service-side sort).
 * An empty string missionId disables the query, consistent with useMissionGaps
 * and useMissionMilestones.
 *
 * Both useMissionFinanceLines and useMissionFinanceSummary share the same
 * cache key (finance.forMission). Only one fetch occurs regardless of how
 * many components consume either hook for the same missionId.
 *
 * Sprint 13 (S13-2). Used by FinanceSection (S13-3).
 */
export const useMissionFinanceLines = (
  missionId: string,
): { lines: MissionFinanceLine[]; isLoading: boolean } => {
  const financeService = useFinanceService();

  const { data, isLoading } = useQuery<MissionFinanceLine[]>({
    queryKey: queryKeys.finance.forMission(missionId),
    queryFn:  () => financeService.listMissionFinanceLines(missionId),
    enabled:  missionId !== '',
  });

  return {
    lines:     data ?? [],
    isLoading,
  };
};
