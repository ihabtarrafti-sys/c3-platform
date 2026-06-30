import type { ContractFilter } from '../types';

export const queryKeys = {
  contracts: {
    all: () => ['contracts'] as const,
    filtered: (filter: ContractFilter) => ['contracts', filter] as const,
    renewal: () => ['contracts', { renewal: true }] as const,
    radar: () => ['contracts', { radar: true }] as const,
  },
  contract: {
    detail: (id: string) => ['contract', id] as const,
  },

  people: {
    all: () => ['people'] as const,
    detail: (id: string) => ['person', id] as const,
  },
  person: {
    contracts: (id: number) => ['person-contracts', id] as const,
    activities: (id: string, limit?: number) => ['person-activities', id, limit] as const,
    credentials: (id: string) => ['person-credentials', id] as const,
  },
  credentials: {
    all: () => ['credentials-all'] as const,
  },
  journey: {
    active: (personId: string, type: string) => ['journey-active', personId, type] as const,
    list: (personId: string) => ['journeys', personId] as const,
    allActive: (type?: string) => ['journeys-all-active', type] as const,
  },
  amendments: {
    all: () => ['amendments'] as const,
    forContract: (id: string) => ['amendments', id] as const,
    detail: (id: string) => ['amendment', id] as const,
  },
  activities: {
    forContract: (id: string) => ['activities', id] as const,
  },
  users: {
    all: () => ['users'] as const,
  },
  actionItems: {
    all: () => ['action-items'] as const,
  },
  compliance: {
    all: () => ['compliance'] as const,
  },
  diagnostics: {
    report: () => ['diagnostics'] as const,
  },
  mission: {
    /** All missions, unfiltered. */
    all: () => ['missions'] as const,
    /** Missions filtered by status and/or entity. */
    filtered: (filter?: { status?: string[]; entity?: string }) =>
      ['missions', filter] as const,
    /** Single mission by ID. */
    byId: (missionId: string) => ['missions', missionId] as const,
    /** Participants for a mission. */
    participants: (missionId: string) => ['missions', missionId, 'participants'] as const,
    /** All participants across all missions — used by useAllMissionParticipants (S14-2). */
    allParticipants: () => ['missions', 'all-participants'] as const,
  },
  milestone: {
    /** All milestones across all missions. Used by useWorkItems (S12-3). */
    all: () => ['milestones'] as const,
    /** Milestones for a single mission. Used by useMissionMilestones (S12-2). */
    forMission: (missionId: string) => ['milestones', missionId] as const,
  },
  finance: {
    /**
     * Finance lines for a single mission.
     * Used by useMissionFinanceLines and useMissionFinanceSummary (S13-2).
     * Both hooks share this key — one fetch, two consumers.
     */
    forMission: (missionId: string) => ['finance', missionId] as const,
  },
  approvals: {
    /** Root key — invalidate to refetch all approval queries. */
    all: () => ['approvals'] as const,
    /** Filtered list — default Submitted/InReview unless caller overrides. */
    list: (filter?: { status?: string[] }) => ['approvals', 'list', filter] as const,
  },
} as const;
