import type { MissionFinanceLine } from '@c3/types';
import type { IFinanceService } from '../interfaces/IFinanceService';

/**
 * SharePoint implementation of IFinanceService.
 *
 * Graceful stub — returns an empty array and logs a warning.
 * Read-only; no write surface in v1.
 *
 * Blocked pending:
 *   - SharePoint site access (IT provisioning)
 *   - FinanceLines list schema design and creation
 *   - Decision on LineID format in SharePoint (auto-increment vs. custom column)
 *   - PnP.js setup in the services layer
 *
 * Implementation pattern when unblocked:
 *   listMissionFinanceLines → PnP.js query against FinanceLines list,
 *   filtered by MissionID column, ordered by Direction then Category.
 *   Map SP list fields to MissionFinanceLine using the column mapping
 *   defined in docs/architecture/Mission Finance v1 — Design.md.
 */
export const createSharePointFinanceService = (): IFinanceService => ({
  async listMissionFinanceLines(missionId: string): Promise<MissionFinanceLine[]> {
    void missionId;
    console.warn('[C3] SharePointFinanceService.listMissionFinanceLines: not implemented');
    return [];
  },
});
