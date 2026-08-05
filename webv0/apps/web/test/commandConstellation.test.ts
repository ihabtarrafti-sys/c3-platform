import { describe, expect, it } from 'vitest';
import type { SituationResponse } from '@c3web/api-contracts';
import { ApiError } from '../src/api';
import { constellationActionTarget, constellationTruthOf } from '../src/tablework/CommandConstellation';

const EMPTY: SituationResponse = {
  todayIso: '2026-08-05',
  signals: [],
  checks: ['Mission readiness checked'],
  counts: {
    activeMissions: 1,
    rosteredPlayers: 2,
    credentialsTracked: 3,
    liveAgreements: 4,
    openApprovals: 0,
  },
};

describe('Command Constellation', () => {
  it('earns quiet only from a current successful empty read', () => {
    expect(constellationTruthOf({
      canView: true,
      data: EMPTY,
      error: null,
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: 123,
    }).kind).toBe('proven-empty');

    expect(constellationTruthOf({
      canView: true,
      data: EMPTY,
      error: null,
      isLoading: false,
      isFetching: true,
      dataUpdatedAt: 123,
    }).kind).toBe('stale');

    expect(constellationTruthOf({
      canView: true,
      data: undefined,
      error: new Error('offline'),
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: 0,
    }).kind).toBe('fetch-failed');
  });

  it('revokes cached signal rows on authoritative refusal and never fetch-authorizes a missing capability', () => {
    expect(constellationTruthOf({
      canView: true,
      data: EMPTY,
      error: new ApiError(403, 'NO_STANDING', 'Denied'),
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: 123,
    })).toEqual({ kind: 'denied', reasonClass: 'NO_STANDING' });
    expect(constellationTruthOf({
      canView: false,
      data: EMPTY,
      error: null,
      isLoading: false,
      isFetching: false,
      dataUpdatedAt: 123,
    })).toEqual({ kind: 'denied', reasonClass: 'SITUATION_UNAVAILABLE' });
  });

  it('keeps signal actions navigational and refuses incomplete identities', () => {
    expect(constellationActionTarget({ kind: 'ViewMission', missionId: 'MSN-0001' })).toBe('/missions/MSN-0001/comms');
    expect(constellationActionTarget({ kind: 'ReviewApproval', approvalId: 'APR-0001' })).toBe('/approvals/APR-0001');
    expect(constellationActionTarget({ kind: 'ViewMission' })).toBeNull();
  });
});
