import { useMemo } from 'react';

import { useMissionFinanceLines } from '@c3/hooks/useMissionFinanceLines';
import { computeMissionFinanceSummary } from '@c3/utils/financeUtils';
import type { MissionFinanceSummary } from '@c3/types';

/**
 * Returns the computed financial summary for a single mission.
 *
 * Derives from useMissionFinanceLines — shares the same cache key
 * (finance.forMission). One fetch serves both hooks.
 *
 * Summary is recomputed via useMemo whenever the lines data changes.
 * Returns a zero-state summary while loading or when there are no lines.
 *
 * Sprint 13 (S13-2). Used by FinanceSection and MissionContextHeader (S13-3).
 */

const EMPTY_SUMMARY: MissionFinanceSummary = {
  totalLineCount:        0,
  settledLineCount:      0,
  totalPlannedIncome:    0,
  totalPlannedExpenses:  0,
  plannedNet:            0,
  totalActualIncome:     0,
  totalActualExpenses:   0,
  actualNet:             0,
  variance:              0,
  isFullySettled:        false,
  hasActuals:            false,
};

export const useMissionFinanceSummary = (
  missionId: string,
): { summary: MissionFinanceSummary; isLoading: boolean } => {
  const { lines, isLoading } = useMissionFinanceLines(missionId);

  const summary = useMemo<MissionFinanceSummary>(
    () => (lines.length > 0 ? computeMissionFinanceSummary(lines) : EMPTY_SUMMARY),
    [lines],
  );

  return { summary, isLoading };
};
