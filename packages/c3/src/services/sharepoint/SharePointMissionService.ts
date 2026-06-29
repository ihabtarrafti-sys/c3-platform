import type { Mission, MissionFilter, MissionParticipant, MissionStatus } from '@c3/types';
import type { IMissionService } from '../interfaces/IMissionService';

/**
 * SharePoint implementation of IMissionService.
 *
 * Graceful stub — read methods return empty arrays or null and log warnings.
 * Write methods throw: they cannot safely no-op because callers expect a
 * returned Mission object and side effects in the data store.
 *
 * Blocked pending:
 *   - SharePoint site access (IT provisioning)
 *   - Missions list schema design and creation
 *   - MissionParticipants list schema design
 *   - Decision on whether TR codes are stored directly or mapped from a
 *     separate Finance reference list
 *
 * Implementation follows the same pattern as SharePointJourneyService.
 * When unblocked, implement using PnP.js against the Missions list and
 * MissionParticipants list.
 */
export const createSharePointMissionService = (): IMissionService => ({
  async listMissions(filter?: MissionFilter): Promise<Mission[]> {
    void filter;
    console.warn('[C3] SharePointMissionService.listMissions: not implemented');
    return [];
  },

  async getMission(missionId: string): Promise<Mission | null> {
    void missionId;
    console.warn('[C3] SharePointMissionService.getMission: not implemented');
    return null;
  },

  async listMissionParticipants(missionId: string): Promise<MissionParticipant[]> {
    void missionId;
    console.warn('[C3] SharePointMissionService.listMissionParticipants: not implemented');
    return [];
  },

  async listAllMissionParticipants(): Promise<MissionParticipant[]> {
    console.warn('[C3] SharePointMissionService.listAllMissionParticipants: not implemented');
    return [];
  },

  async confirmMission(missionId: string, confirmedBy: string): Promise<Mission> {
    void missionId;
    void confirmedBy;
    console.warn('[C3] SharePointMissionService.confirmMission: not implemented');
    throw new Error('SharePointMissionService.confirmMission: not implemented');
  },

  async updateMissionStatus(missionId: string, status: MissionStatus): Promise<Mission> {
    void missionId;
    void status;
    console.warn('[C3] SharePointMissionService.updateMissionStatus: not implemented');
    throw new Error('SharePointMissionService.updateMissionStatus: not implemented');
  },
});
