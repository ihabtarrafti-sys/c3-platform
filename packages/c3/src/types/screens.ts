export type ContractTab = 'overview' | 'amendments' | 'documents' | 'activity';

export type RenewalStage = '90d' | '60d' | '30d' | '14d' | '7d' | 'expired';

export interface ContractFilter {
  stage?: string;
  opsStatus?: string;
  search?: string;
}

export interface PersonFilter {
  team?: string;
  game?: string;
  search?: string;
}

/**
 * Minimal mission context carried through navigation when the user clicks
 * through from a Mission-scoped gap in the Situation Room.
 *
 * Passed as a prop to PersonProfile -> StartJourneyPanel so the panel can
 * display mission context and tag the resulting Journey with MissionID.
 *
 * Sprint 10 (M10-4).
 */
export interface MissionNavContext {
  missionId: string;
  missionName: string;
}

export type C3Screen =
  | { id: 'command-center' }
  | { id: 'contracts'; filter?: ContractFilter }
  | { id: 'contract-profile'; contractId: string; tab?: ContractTab }
  | { id: 'people'; filter?: PersonFilter }
  | {
      id: 'person-profile';
      personId: string;
      tab?: 'profile' | 'readiness';
      /** Mission context when navigating from a Mission-scoped gap (M10-4). */
      missionContext?: MissionNavContext;
    }
  | { id: 'renewals'; stage?: RenewalStage }
  | { id: 'amendments'; contractId?: string }
  | { id: 'amendment-profile'; amendmentId: string }
  | { id: 'inbox' }
  | { id: 'intelligence' }
  | {
      id: 'situation-room';
      /**
       * Pre-select a mission scope on mount.
       * Used by Command Center MissionDeparturePressure WorkItem navigation (Sprint 11).
       * The Situation Room initialises selectedMissionId from this value.
       */
      missionId?: string;
    }
  | { id: 'missions' }
  | { id: 'settings' }
  | { id: 'developer-diagnostics' }
  | { id: 'approvals' };
