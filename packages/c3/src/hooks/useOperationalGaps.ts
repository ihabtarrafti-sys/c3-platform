import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { evaluateOnboardingObligations } from '@c3/protocols';
import { queryKeys } from '@c3/hooks/queryKeys';
import { useCredentialService } from '@c3/hooks/useCredentialService';
import { useJourneyService } from '@c3/hooks/useJourneyService';
import { usePeople } from '@c3/hooks/usePeople';
import { computeGapsForPeople } from '@c3/utils/gapComputation';
import type { Credential, GapFilter, Journey, OperationalGap, ProtocolFn } from '@c3/types';

// ---------------------------------------------------------------------------
// Default protocol set
// ---------------------------------------------------------------------------

// Module-level constant — stable reference, never triggers memo recomputation.
const DEFAULT_PROTOCOLS: ProtocolFn[] = [evaluateOnboardingObligations];

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Aggregation hook — the computation engine behind the Situation Room.
 *
 * Answers: what operational gaps exist across the organisation right now,
 * and who owns solving each one?
 *
 * Algorithm:
 *   1. Batch-fetch all persons and all credentials.
 *   2. Batch-fetch all active Onboarding journeys.
 *   3. Build credential and journey Maps for O(1) per-person lookup.
 *   4. Normalise Person[] to PersonInfo[] (applying filter.personIds if set).
 *   5. Delegate gap computation and sorting to computeGapsForPeople.
 *
 * Gap computation and ownership state resolution live in computeGapsForPeople
 * (src/utils/gapComputation.ts). Sprint 14 S14-1 extracted that logic from
 * this hook and useMissionGaps to eliminate the duplicated ownership algorithm.
 *
 * Cache coherence:
 *   - credentials.all() is invalidated by useAddCredential.onSuccess
 *     → Situation Room gaps update automatically when a credential is registered.
 *   - journey.allActive(type) is invalidated by useInitiateJourney.onSuccess
 *     → Ownership state transitions from Unrouted → Routed/Covered when a
 *        journey starts with obligation assignments.
 *
 * S14-5 audit (Sprint 14): All three filter fields (protocols, context, personIds)
 * are handled by this hook. No UI surface currently passes a non-null filter.
 * No hook changes are needed — connect a UI consumer to unlock each field.
 *
 * Ref: ADR-001-service-access-pattern.md (parallel factory pattern)
 * Ref: Sprint 9 — Operational Gap Ownership
 * Ref: Sprint 14 — S14-1 (gap computation extracted to gapComputation.ts)
 */
export const useOperationalGaps = (
  filter?: GapFilter,
): { gaps: OperationalGap[]; isLoading: boolean } => {
  const { data: people, isLoading: peopleLoading } = usePeople();
  const credentialService = useCredentialService();
  const journeyService    = useJourneyService();

  // ── Batch credential fetch ────────────────────────────────────────────────
  const { data: allCredentials, isLoading: credentialsLoading } = useQuery<Credential[]>({
    queryKey: queryKeys.credentials.all(),
    queryFn:  () => credentialService.listAllCredentials(),
  });

  // ── Batch journey fetch — active Onboarding journeys only ─────────────────
  // When multi-protocol support is added, fetch by each protocol's journey type.
  const { data: allJourneys, isLoading: journeysLoading } = useQuery<Journey[]>({
    queryKey: queryKeys.journey.allActive('Onboarding'),
    queryFn:  () => journeyService.listAllActiveJourneys('Onboarding'),
  });

  const isLoading = peopleLoading || credentialsLoading || journeysLoading;

  // ── Gap computation ───────────────────────────────────────────────────────

  const gaps = useMemo((): OperationalGap[] => {
    if (!people || !allCredentials || !allJourneys) return [];

    const protocols = filter?.protocols ?? DEFAULT_PROTOCOLS;
    const context   = filter?.context;

    // Group credentials by HolderPersonID — O(1) lookup during evaluation.
    const credentialsByPerson = new Map<string, Credential[]>();
    for (const cred of allCredentials) {
      const list = credentialsByPerson.get(cred.HolderPersonID) ?? [];
      list.push(cred);
      credentialsByPerson.set(cred.HolderPersonID, list);
    }

    // Map active journeys by PersonID — one active journey per person per type.
    const journeyByPerson = new Map<string, Journey>();
    for (const journey of allJourneys) {
      journeyByPerson.set(journey.PersonID, journey);
    }

    // Scope persons if filter.personIds is provided; otherwise evaluate all.
    const targetPeople = filter?.personIds
      ? people.filter(p => filter.personIds!.includes(p.PersonID))
      : people;

    // Normalise to PersonInfo for computeGapsForPeople.
    const personInfos = targetPeople.map(p => ({
      personId:   p.PersonID,
      personName: p.FullName,
      personRole: p.PrimaryRole,
      personTeam: p.CurrentTeam,
    }));

    return computeGapsForPeople(
      personInfos,
      credentialsByPerson,
      journeyByPerson,
      protocols,
      context,
      // No options — general (non-mission) evaluation.
    );
  }, [people, allCredentials, allJourneys, filter]);

  return { gaps, isLoading };
};
