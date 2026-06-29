/**
 * financeUtils — C3 Platform
 *
 * Pure computation utilities for Mission Finance.
 * All functions are deterministic: same input → same output.
 *
 * Design invariant: MissionFinanceSummary is ALWAYS derived from lines.
 * Never stored on Mission or anywhere else. If a line changes, the summary
 * updates automatically on the next query.
 */

import type { MissionFinanceLine, MissionFinanceSummary } from '@c3/types';

// ---------------------------------------------------------------------------
// computeMissionFinanceSummary
// ---------------------------------------------------------------------------

/**
 * Compute the financial summary for a set of Mission finance lines.
 *
 * ActualAmount is treated as 0 when undefined (line has no known actual yet).
 * This means actualNet and variance are partial until all lines have actuals.
 * Use hasActuals to determine whether the actuals figures are meaningful.
 */
export const computeMissionFinanceSummary = (
  lines: MissionFinanceLine[],
): MissionFinanceSummary => {
  const income  = lines.filter(l => l.Direction === 'Income');
  const expense = lines.filter(l => l.Direction === 'Expense');

  // Sum a numeric field, treating undefined as 0
  const sumField = (
    arr: MissionFinanceLine[],
    field: 'PlannedAmount' | 'ActualAmount',
  ): number => arr.reduce((acc, l) => acc + (l[field] ?? 0), 0);

  const totalPlannedIncome   = sumField(income,  'PlannedAmount');
  const totalPlannedExpenses = sumField(expense, 'PlannedAmount');
  const totalActualIncome    = sumField(income,  'ActualAmount');
  const totalActualExpenses  = sumField(expense, 'ActualAmount');

  const plannedNet = totalPlannedIncome   - totalPlannedExpenses;
  const actualNet  = totalActualIncome    - totalActualExpenses;

  return {
    totalLineCount:       lines.length,
    settledLineCount:     lines.filter(l => l.IsSettled).length,

    totalPlannedIncome,
    totalPlannedExpenses,
    plannedNet,

    totalActualIncome,
    totalActualExpenses,
    actualNet,

    variance:             actualNet - plannedNet,

    // Empty line list → not settled (nothing to settle)
    isFullySettled:       lines.length > 0 && lines.every(l => l.IsSettled),
    hasActuals:           lines.some(l => l.ActualAmount !== undefined),
  };
};
