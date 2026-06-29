import type { Mission, MissionFilter, MissionParticipant, MissionStatus } from '@c3/types';
import type { IMissionService } from '../interfaces/IMissionService';

/**
 * Mock Mission data — two missions demonstrating both sides of the ADR-002 gate.
 *
 * TR/2026/006 — RLCS WC 2026 (Confirmed)
 *   Status:  Confirmed → generates obligations for PER-0001 and PER-0002.
 *   Span:    2026-07-08 → 2026-08-16 (operational); settled 2026-12-30.
 *   Use:     Demonstrates Mission-scoped gap computation with urgency relative
 *            to 2026-08-16. PER-0001 Travel is AtRisk (credential expires before
 *            EndDate). PER-0002 Travel + RightToWork are Unsatisfied → Critical.
 *
 * SATR/2026/003 — Saudi eLeague 2026 S2 (FinancePending)
 *   Status:  FinancePending → excluded by ADR-002 gate; generates no obligations.
 *   Use:     Demonstrates that pre-Confirmed missions are operationally silent.
 *            Operator sees it in a mission list but not in any gap computation.
 */
const MOCK_MISSIONS: Mission[] = [
  {
    MissionID: 'TR/2026/006',
    Name: 'RLCS 2026 - World Championship & EWC',
    Game: 'Rocket League',
    Organizer: 'Psyonix / EWC',
    Entity: 'UAE',
    Status: 'Confirmed',
    Jurisdiction: 'Paris, France',
    Span: {
      StartDate:      '2026-07-08',
      EndDate:        '2026-08-16',
      SettlementDate: '2026-12-30',
    },
    OperatingCurrency: 'USD',
    CreatedAt:   '2026-05-20T08:00:00Z',
    CreatedBy:   'ops.coordinator@geekay.gg',
    ConfirmedAt: '2026-06-15T10:00:00Z',
    ConfirmedBy: 'finance.lead@geekay.gg',
    Notes: 'Combined WC + EWC trip. Finance approved June 15. Logistics planning in progress.',
  },
  {
    MissionID: 'SATR/2026/003',
    Name: 'Saudi eLeague 2026 - Season 2',
    Game: 'EA Sports FC',
    Organizer: 'Saudi eLeague',
    Entity: 'KSA',
    Status: 'FinancePending',
    Jurisdiction: 'Riyadh, Saudi Arabia',
    Span: {
      StartDate:      '2026-09-01',
      EndDate:        '2026-09-30',
      SettlementDate: '2026-11-30',
    },
    OperatingCurrency: 'SAR',
    CreatedAt: '2026-06-10T09:00:00Z',
    CreatedBy: 'ops.coordinator@geekay.gg',
    Notes: 'Awaiting Finance sign-off. Do not book travel until confirmed.',
  },
];

/**
 * Participant records — role and per diem data per person per Mission.
 *
 * Per diem rates follow the Config sheet tier structure:
 *   Player: 35 USD   Coach: 25 USD   Manager: 50 USD   Analyst: 25 USD
 */
const MOCK_PARTICIPANTS: MissionParticipant[] = [
  {
    MissionID:    'TR/2026/006',
    PersonID:     'PER-0001',
    ExternalCode: 'RL/PL/026',
    Role:         'Player',
    PerDiemRate:  35,
  },
  {
    MissionID:    'TR/2026/006',
    PersonID:     'PER-0002',
    ExternalCode: 'RL/CH/004',
    Role:         'Coach',
    PerDiemRate:  25,
  },
  {
    MissionID:    'SATR/2026/003',
    PersonID:     'PER-0004',
    ExternalCode: 'FC/PL/001',
    Role:         'Player',
    PerDiemRate:  35,
  },
];

// ---------------------------------------------------------------------------
// Valid status transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  Planning:       ['FinancePending', 'Canceled'],
  FinancePending: ['Confirmed', 'Canceled'],
  Confirmed:      ['Active', 'Canceled'],
  Active:         ['PostMission'],
  PostMission:    ['Settled'],
  Settled:        [],
  Canceled:       [],
};

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

let missionStore: Mission[] = [...MOCK_MISSIONS];

function updateMissionInStore(missionId: string, patch: Partial<Mission>): Mission {
  const existing = missionStore.find(m => m.MissionID === missionId);
  if (!existing) {
    throw new Error(`[MockMissionService] Mission not found: ${missionId}`);
  }
  const updated: Mission = { ...existing, ...patch };
  missionStore = missionStore.map(m => (m.MissionID === missionId ? updated : m));
  return updated;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createMockMissionService = (): IMissionService => ({
  async listMissions(filter?: MissionFilter): Promise<Mission[]> {
    let results = [...missionStore];

    if (filter?.status?.length) {
      results = results.filter(m => filter.status!.includes(m.Status));
    }
    if (filter?.entity) {
      results = results.filter(m => m.Entity === filter.entity);
    }

    // Sort by StartDate ascending (soonest Mission first)
    results.sort((a, b) => a.Span.StartDate.localeCompare(b.Span.StartDate));
    return results;
  },

  async getMission(missionId: string): Promise<Mission | null> {
    return missionStore.find(m => m.MissionID === missionId) ?? null;
  },

  async listMissionParticipants(missionId: string): Promise<MissionParticipant[]> {
    return MOCK_PARTICIPANTS.filter(p => p.MissionID === missionId);
  },

  async listAllMissionParticipants(): Promise<MissionParticipant[]> {
    return [...MOCK_PARTICIPANTS];
  },

  async confirmMission(missionId: string, confirmedBy: string): Promise<Mission> {
    const mission = missionStore.find(m => m.MissionID === missionId);
    if (!mission) {
      throw new Error(`[MockMissionService] Mission not found: ${missionId}`);
    }
    if (mission.Status !== 'FinancePending' && mission.Status !== 'Planning') {
      throw new Error(
        `[MockMissionService] Cannot confirm Mission in status "${mission.Status}". ` +
        `Only Planning or FinancePending missions may be confirmed.`,
      );
    }
    return updateMissionInStore(missionId, {
      Status:      'Confirmed',
      ConfirmedAt: new Date().toISOString(),
      ConfirmedBy: confirmedBy,
    });
  },

  async updateMissionStatus(missionId: string, status: MissionStatus): Promise<Mission> {
    const mission = missionStore.find(m => m.MissionID === missionId);
    if (!mission) {
      throw new Error(`[MockMissionService] Mission not found: ${missionId}`);
    }
    const allowed = VALID_TRANSITIONS[mission.Status];
    if (!allowed.includes(status)) {
      throw new Error(
        `[MockMissionService] Invalid transition: ${mission.Status} → ${status}. ` +
        `Allowed: [${allowed.join(', ')}]`,
      );
    }
    return updateMissionInStore(missionId, { Status: status });
  },
});
