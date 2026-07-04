import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { evaluateOnboardingObligations } from '@c3/protocols';
import { queryKeys } from '@c3/hooks/queryKeys';
import { useCredentialService } from '@c3/hooks/useCredentialService';
import { useJourneyService } from '@c3/hooks/useJourneyService';
import { useListApprovals } from '@c3/hooks/useListApprovals';
import { useMissionService } from '@c3/hooks/useMissionService';
import { computeMissionReadiness } from '@c3/utils/missionReadiness';
import { PENDING_APPROVAL_STATUSES } from '@c3/utils/participantWrites';
import type {
  Credential,
  Journey,
  KitAssignment,
  Mission,
  MissionParticipant,
  MissionReadiness,
  PendingParticipantChange,
} from '@c3/types';

/**
 * useMissionReadiness — Sprint 30 (Mission Readiness Cockpit).
 *
 * Composition hook: wires the existing batch queries into the pure
 * computeMissionReadiness module. One pass across all missions — no
 * per-mission or per-card fetches (S27 rule).
 *
 * Cache coherence: every query below reuses an EXISTING query key
 * (participants, kit, credentials, journeys, pending approvals), so no new
 * network surface is introduced — results are shared with MissionWorkspace,
 * SituationRoom, and the work-item pipeline, and every existing mutation's
 * invalidation reaches this hook automatically.
 *
 * Truthful partial-failure handling (approved Sprint 30 semantics):
 *   - isPending (frame-zero gate, TD-23 lesson) is LOADING — distinct from
 *     loaded-but-Unknown. The consumer renders a loading affordance and never
 *     a readiness verdict while pending.
 *   - A failed query yields trusted=false for that source. The pure module
 *     then exposes 'Unknown' — a query failure never becomes an empty roster,
 *     NotRecorded kit, or Clear compliance.
 *   - The pending-approvals source is informational: its failure makes only
 *     the pending-change indicator Unknown (null counts).
 *
 * @param missions  Missions to evaluate — pass the same array the screen
 *                  renders (shared useMissions cache).
 */
export const useMissionReadiness = (
  missions: Mission[],
): {
  readinessByMission: Map<string, MissionReadiness>;
  /** True until every source has produced a first result. */
  isPending: boolean;
} => {
  const missionService = useMissionService();
  const credentialService = useCredentialService();
  const journeyService = useJourneyService();

  // ── Batch sources — identical keys to the existing hooks ─────────────────
  const participantsQuery = useQuery<MissionParticipant[]>({
    queryKey: queryKeys.mission.allParticipants(),
    queryFn: () => missionService.listAllMissionParticipants(),
  });

  const kitQuery = useQuery<KitAssignment[]>({
    queryKey: queryKeys.mission.allKitAssignments(),
    queryFn: () => missionService.listAllKitAssignments(),
  });

  const credentialsQuery = useQuery<Credential[]>({
    queryKey: queryKeys.credentials.all(),
    queryFn: () => credentialService.listAllCredentials(),
  });

  const journeysQuery = useQuery<Journey[]>({
    queryKey: queryKeys.journey.allActive('Onboarding'),
    queryFn: () => journeyService.listAllActiveJourneys('Onboarding'),
  });

  // Pending membership requests — same query MissionWorkspace already runs.
  const approvalsQuery = useListApprovals({ status: [...PENDING_APPROVAL_STATUSES] });

  const isPending =
    participantsQuery.isPending ||
    kitQuery.isPending ||
    credentialsQuery.isPending ||
    journeysQuery.isPending ||
    approvalsQuery.isPending;

  // ── Parse pending participant changes (same contract as MissionWorkspace) ─
  const pendingChanges = useMemo<PendingParticipantChange[]>(() => {
    const list: PendingParticipantChange[] = [];
    for (const approval of approvalsQuery.data ?? []) {
      if (
        approval.operationType !== 'AddMissionParticipant' &&
        approval.operationType !== 'RemoveMissionParticipant'
      ) continue;
      try {
        const p = JSON.parse(approval.payload ?? '') as Record<string, unknown>;
        if (typeof p['missionId'] === 'string' && typeof p['personId'] === 'string') {
          list.push({
            operationType: approval.operationType as PendingParticipantChange['operationType'],
            missionId: p['missionId'],
            personId: p['personId'],
          });
        }
      } catch { /* malformed payload — ignore */ }
    }
    return list;
  }, [approvalsQuery.data]);

  // ── Compute (loading returns an empty map; the consumer gates on isPending) ─
  const readinessByMission = useMemo<Map<string, MissionReadiness>>(() => {
    if (isPending || missions.length === 0) return new Map();

    return computeMissionReadiness(
      missions,
      {
        participants: {
          data: participantsQuery.data ?? [],
          trusted: !participantsQuery.isError,
        },
        credentials: {
          data: credentialsQuery.data ?? [],
          trusted: !credentialsQuery.isError,
        },
        journeys: {
          data: journeysQuery.data ?? [],
          trusted: !journeysQuery.isError,
        },
        kit: {
          data: kitQuery.data ?? [],
          trusted: !kitQuery.isError,
        },
        pendingChanges: {
          data: pendingChanges,
          trusted: !approvalsQuery.isError,
        },
      },
      [evaluateOnboardingObligations],
    );
  }, [
    isPending,
    missions,
    participantsQuery.data, participantsQuery.isError,
    credentialsQuery.data, credentialsQuery.isError,
    journeysQuery.data, journeysQuery.isError,
    kitQuery.data, kitQuery.isError,
    pendingChanges, approvalsQuery.isError,
  ]);

  return { readinessByMission, isPending };
};
