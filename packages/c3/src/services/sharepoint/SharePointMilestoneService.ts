import type { MissionMilestone } from '@c3/types';
import type { IMilestoneService } from '../interfaces/IMilestoneService';

/**
 * SharePoint implementation of IMilestoneService.
 *
 * Graceful stub — read methods return empty arrays and log warnings.
 * completeMilestone throws: it cannot safely no-op because the caller
 * expects a returned MissionMilestone with CompletedDate set.
 *
 * Blocked pending:
 *   - SharePoint site access (IT provisioning)
 *   - Milestones list schema design and creation
 *   - Decision on MilestoneID format in SP (auto-increment vs. custom ID column)
 *   - PnP.js setup in the services layer
 *
 * Implementation pattern: follows SharePointMissionService — use PnP.js
 * against a Milestones list scoped to each Mission's MissionID column.
 * When unblocked, implement listMissionMilestones as a filtered list query
 * and listAllMilestones as an unfiltered query ordered by PlannedDate.
 */
export const createSharePointMilestoneService = (): IMilestoneService => ({
  async listMissionMilestones(missionId: string): Promise<MissionMilestone[]> {
    void missionId;
    console.warn('[C3] SharePointMilestoneService.listMissionMilestones: not implemented');
    return [];
  },

  async listAllMilestones(): Promise<MissionMilestone[]> {
    console.warn('[C3] SharePointMilestoneService.listAllMilestones: not implemented');
    return [];
  },

  async completeMilestone(milestoneId: string): Promise<MissionMilestone> {
    void milestoneId;
    console.warn('[C3] SharePointMilestoneService.completeMilestone: not implemented');
    throw new Error('SharePointMilestoneService.completeMilestone: not implemented');
  },
});
