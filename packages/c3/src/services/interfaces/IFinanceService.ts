import type { MissionFinanceLine } from '@c3/types';

/**
 * IFinanceService — read contract for Mission Finance lines.
 *
 * v1 surface: one read method.
 * No write methods in v1 — lines are seeded by data entry outside C3.
 * Mission approval (FinancePending → Confirmed) is handled by IMissionService.confirmMission.
 *
 * Future writes (not in v1):
 *   createFinanceLine(line): Promise<MissionFinanceLine>
 *   updateActualAmount(lineId, amount): Promise<MissionFinanceLine>
 *   markLineSettled(lineId): Promise<MissionFinanceLine>
 */
export interface IFinanceService {
  /**
   * Returns all finance lines for a given Mission, ordered by Direction then
   * Category (Income lines first, then Expense lines).
   * Returns [] if the Mission has no finance lines.
   */
  listMissionFinanceLines(missionId: string): Promise<MissionFinanceLine[]>;
}
