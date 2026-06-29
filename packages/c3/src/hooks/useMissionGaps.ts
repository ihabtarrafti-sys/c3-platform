import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { evaluateOnboardingObligations } from '@c3/protocols';
import { queryKeys } from '@c3/hooks/queryKeys';
import { useCredentialService } from '@c3/hooks/useCredentialService';
import { useJourneyService } from '@c3/hooks/useJourneyService';
import { useMissionService } from '@c3/hooks/useMissionService';
import { usePeople } from '@c3/hooks/usePeople';
import { computeGapsForPeople } from '@c3/utils/gapComputation';
import {
  MISSION_OBLIGATION_ACTIVE_STATUSES,
  type Credential,
  type Journey,
  type Mission,
  type MissionParticipant,
  type OperationalGap,
  type ProtocolContext,
} from '@c3/types';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Mission-scoped gap computation — the Mission-aware counterpart to
 * useOperationalGaps.
 *
 * Computes operational gaps for the participants of a single Mission.
 * Urgency is relative to Mission.Span.EndDate (the fixed operational deadline)
 * rather than rolling 30/90-day windows.
 *
 * ADR-002 activation gate: if Mission.Status is not in
 * MISSION_OBLIGATION_ACTIVE_STATUSES {Confirmed, Active, PostMission}, returns
 * an empty gap list immediately. FinancePending and Planning missions are silent.
 *
 * Reuses the existing batch queries for credentials and journeys — results are
 * served from TanStack Query cache, so no extra network calls are made when
 * useOperationalGaps has already populated the cache.
 *
 * Gap computation and ownership state resolution are delegated to
 * computeGapsForPeople (src/utils/gapComputation.ts). Sprint 14 S14-1 extracted
 * this logic from the hook — the ownership algorithm now lives in one place.
 * Prior to this, the three-state OwnershipState resolution block existed in
 * both this hook and useOperationalGaps as identical duplicates.
 *
 * @param missionId  The TR code ID of the Mission (e.g. "TR/2026/006").
 *                   Pass an empty string to suppress all fetches (returns empty).
 *
 * Sprint 10 (M10-3). Sprint 14 (S14-1) refactor: computation extracted.
 */
export const useMissionGaps = (
  missionId: string,
): { gaps: OperationalGap[]; mission: Mission | null; isLoading: boolean } => {
  const missionService    = useMissionService();
  const credentialService = useCredentialService();
  const journeyService    = useJourneyService();

  const enabled = missionId.length > 0;

  // ── Mission ───────────────────────────────────────────────────────────────
  const { data: mission = null, isLoading: missionLoading } = useQuery<Mission | null>({
    queryKey: queryKeys.mission.byId(missionId),
    queryFn:  () => missionService.getMission(missionId),
    enabled,
  });

  // ── Participants ──────────────────────────────────────────────────────────
  const { data: participants = [], isLoading: participantsLoading } = useQuery<MissionParticipant[]>({
    queryKey: queryKeys.mission.participants(missionId),
    queryFn:  () => missionService.listMissionParticipants(missionId),
    enabled,
  });

  // ── People (for display names) — shared cache with rest of app ────────────
  const { data: people, isLoading: peopleLoading } = usePeople();

  // ── Batch credential + journey fetches — shared cache ────────────────────
  // Identical query keys to useOperationalGaps — served from cache when the
  // Situation Room has already populated the general gap view.
  const { data: allCredentials, isLoading: credentialsLoading } = useQuery<Credential[]>({
    queryKey: queryKeys.credentials.all(),
    queryFn:  () => credentialService.listAllCredentials(),
  });

  const { data: allJourneys, isLoading: journeysLoading } = useQuery<Journey[]>({
    queryKey: queryKeys.journey.allActive('Onboarding'),
    queryFn:  () => journeyService.listAllActiveJourneys('Onboarding'),
  });

  const isLoading =
    missionLoading      ||
    participantsLoading ||
    peopleLoading       ||
    credentialsLoading  ||
    journeysLoading;

  // ── Gap computation ───────────────────────────────────────────────────────

  const gaps = useMemo((): OperationalGap[] => {
    // ADR-002 gate: only Confirmed / Active / PostMission missions generate gaps.
    if (!mission || !MISSION_OBLIGATION_ACTIVE_STATUSES.includes(mission.Status)) return [];
    if (!allCredentials || !allJourneys || !people || participants.length === 0) return [];

    const participantPersonIDs = new Set(participants.map(p => p.PersonID));

    // Protocol context: span anchored to Mission operational dates.
    // The protocol uses span.to as the credential validity horizon.
    // S14-4: context.mission removed — ProtocolContext no longer carries the
    // Mission entity. The span is set explicitly, giving the protocol everything
    // it needs without importing the Mission domain type into the protocol layer.
    const protocolContext: ProtocolContext = {
      span: { from: mission.Span.StartDate, to: mission.Span.EndDate },
    };

    // Index people by PersonID for name/role lookup.
    const personById = new Map(people.map(p => [p.PersonID, p]));

    // Build credential map scoped to mission participants only.
    const credentialsByPerson = new Map<string, Credential[]>();
    for (const cred of allCredentials) {
      if (!participantPersonIDs.has(cred.HolderPersonID)) continue;
      const list = credentialsByPerson.get(cred.HolderPersonID) ?? [];
      list.push(cred);
      credentialsByPerson.set(cred.HolderPersonID, list);
    }

    // Build journey map scoped to mission participants only.
    const journeyByPerson = new Map<string, Journey>();
    for (const journey of allJourneys) {
      if (participantPersonIDs.has(journey.PersonID)) {
        journeyByPerson.set(journey.PersonID, journey);
      }
    }

    // Normalise MissionParticipants to PersonInfo.
    // Falls back to PersonID / participant.Role when the Person record is absent.
    const personInfos = participants.map(participant => {
      const person = personById.get(participant.PersonID);
      return {
        personId:   participant.PersonID,
        personName: person?.FullName ?? participant.PersonID,
        personRole: person?.PrimaryRole ?? participant.Role,
        personTeam: person?.CurrentTeam,
      };
    });

    return computeGapsForPeople(
      personInfos,
      credentialsByPerson,
      journeyByPerson,
      [evaluateOnboardingObligations],
      protocolContext,
      {
        missionId:     mission.MissionID,
        missionName:   mission.Name,
        missionEndDate: mission.Span.EndDate,
      },
    );
  }, [mission, participants, people, allCredentials, allJourneys]);

  return { gaps, mission, isLoading };
};
