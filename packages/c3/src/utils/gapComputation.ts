/**
 * computeGapsForPeople — shared gap computation utility
 *
 * Sprint 14 (S14-1) — extracted from useOperationalGaps and useMissionGaps.
 *
 * Pure function: no React, no hooks, no side effects. Given a normalised list
 * of people, pre-built credential/journey Maps, protocol functions, and optional
 * context, returns a sorted OperationalGap[].
 *
 * Both useOperationalGaps (all-persons mode) and useMissionGaps (mission-scoped
 * mode) call this function. Prior to S14-1, the ownership-state algorithm and
 * obligation-to-gap conversion were duplicated in both hooks. A bug in the
 * ownership resolution would have required fixes in two places simultaneously.
 *
 * Ref: ADR-001-service-access-pattern.md (parallel factory pattern)
 * Ref: Sprint 9 — Operational Gap Ownership (three-state OwnershipState model)
 * Ref: Sprint 14 — S14-1 Architecture Hardening
 */

import { computeUrgency, daysUntilExpiry } from '@c3/utils/urgency';
import type {
  Credential,
  Journey,
  OperationalGap,
  OwnershipState,
  ProtocolContext,
  ProtocolFn,
} from '@c3/types';

// ---------------------------------------------------------------------------
// PersonInfo
// ---------------------------------------------------------------------------

/**
 * Minimal, normalised person descriptor accepted by computeGapsForPeople.
 *
 * Both callers derive this from different source types:
 *   useOperationalGaps — from Person (PersonID, FullName, PrimaryRole, CurrentTeam)
 *   useMissionGaps     — from MissionParticipant + People Map lookup for display fields
 *
 * The function is agnostic to the source type; callers normalise before calling.
 */
export interface PersonInfo {
  personId:    string;
  personName:  string;
  personRole?: string;
  personTeam?: string;
}

// ---------------------------------------------------------------------------
// ComputeGapsOptions
// ---------------------------------------------------------------------------

/**
 * Optional mission scope context for computeGapsForPeople.
 *
 * When provided by useMissionGaps, every returned gap carries missionId and
 * missionName. missionEndDate is forwarded to computeUrgency as the fixed
 * urgency horizon (replacing rolling 30/90-day windows).
 *
 * When omitted (useOperationalGaps), gaps have no missionId/missionName and
 * urgency uses rolling time-based thresholds.
 */
export interface ComputeGapsOptions {
  /** MissionID to attach to each gap. Only set for mission-scoped computation. */
  missionId?: string;
  /** Mission display name. Set alongside missionId. */
  missionName?: string;
  /**
   * Mission.Span.EndDate — the fixed operational deadline.
   * When present, computeUrgency uses this date as the urgency horizon
   * rather than rolling 30/90-day windows.
   */
  missionEndDate?: string;
}

// ---------------------------------------------------------------------------
// computeGapsForPeople
// ---------------------------------------------------------------------------

/**
 * Evaluate operational gaps for a list of people and return a sorted result.
 *
 * Algorithm:
 *   For each person:
 *     For each protocol function:
 *       Evaluate obligations against the person's credentials and context.
 *       For each non-Satisfied obligation, compose one OperationalGap:
 *         — Compute urgency tier (mission-relative if options.missionEndDate set).
 *         — Resolve ownership state (Unrouted / Routed / Covered) from journey.
 *         — Attach mission context fields if options.missionId is set.
 *   Sort result by urgency tier then daysToExpiry ascending.
 *
 * Ownership state resolution (Sprint 9 three-state model):
 *   Unrouted — no journey for this person. Gap needs routing.
 *   Routed   — journey exists with AssignedTo; no explicit obligation assignment.
 *   Covered  — journey has an obligationAssignment matching this obligation type.
 *              The obligation-specific assignee becomes the gap's assignedTo.
 *
 * See OwnershipState in situation.ts and ObligationAssignment in journeys.ts
 * for full semantics.
 *
 * @param people             Normalised person descriptors. Callers derive from
 *                           Person[] or MissionParticipant[] before calling.
 * @param credentialsByPerson Pre-built Map<personId, Credential[]>. Callers
 *                            may scope this to a participant subset before passing.
 * @param journeyByPerson    Pre-built Map<personId, Journey>. One active journey
 *                           per person per type (Onboarding only in v1).
 * @param protocols          Protocol functions to apply per person. Each function
 *                           is evaluated independently; obligations are merged.
 * @param context            Optional protocol evaluation context (span, jurisdiction).
 *                           When absent, protocols use their default threshold.
 * @param options            Optional mission scope. Adds missionId/missionName to
 *                           each gap and enables fixed-deadline urgency computation.
 */
export function computeGapsForPeople(
  people:              PersonInfo[],
  credentialsByPerson: Map<string, Credential[]>,
  journeyByPerson:     Map<string, Journey>,
  protocols:           ProtocolFn[],
  context?:            ProtocolContext,
  options?:            ComputeGapsOptions,
): OperationalGap[] {
  const result: OperationalGap[] = [];

  for (const person of people) {
    const credentials = credentialsByPerson.get(person.personId) ?? [];
    const journey     = journeyByPerson.get(person.personId);

    for (const protocolFn of protocols) {
      const evaluation = protocolFn(person.personId, credentials, context);

      for (const obligation of evaluation.obligations) {
        if (obligation.status === 'Satisfied') continue;

        const urgencyTier = computeUrgency(
          obligation,
          journey?.JourneyID,
          options?.missionEndDate,
        );
        const days = daysUntilExpiry(obligation.credentialExpiryDate);

        // ── Ownership state (Sprint 9 three-state model) ─────────────────────
        //
        // Journey.obligationAssignments carries explicit per-obligation
        // ownership declarations. When a matching entry exists for this
        // obligation's satisfiedByCapability, the gap is Covered.
        // Without a matching entry, the gap is Routed (journey exists, but
        // explicit coverage for this specific obligation is not declared).
        // Without any journey, the gap is Unrouted — no accountability.
        const obligationAssignment = journey?.obligationAssignments?.find(
          a => a.obligationType === obligation.satisfiedByCapability,
        );

        const ownershipState: OwnershipState =
          !journey               ? 'Unrouted'
          : obligationAssignment ? 'Covered'
          : journey.AssignedTo   ? 'Routed'
          :                        'Unrouted';

        // When Covered: obligation-specific execution owner takes precedence.
        // When Routed:  journey-level governance owner is the best available.
        const assignedTo = obligationAssignment?.assignedTo ?? journey?.AssignedTo;

        result.push({
          personId:   person.personId,
          personName: person.personName,
          personRole: person.personRole,
          personTeam: person.personTeam,

          obligationId:          obligation.id,
          requirement:           obligation.requirement,
          satisfiedByCapability: obligation.satisfiedByCapability,
          blockingReason:        obligation.statusReason,

          urgencyTier,
          daysToExpiry: days,

          journeyId:    journey?.JourneyID,
          assignedTo,
          defaultOwner: obligation.defaultOwner ?? 'Operations',
          ownershipState,

          evaluatedAt: evaluation.evaluatedAt,

          // Mission context — present only when called from useMissionGaps.
          missionId:   options?.missionId,
          missionName: options?.missionName,
        });
      }
    }
  }

  // Sort: urgency tier ascending (Critical → High → Medium),
  // then daysToExpiry ascending (most imminent first), nulls last.
  const TIER_RANK: Record<string, number> = { Critical: 0, High: 1, Medium: 2 };
  result.sort((a, b) => {
    const tierDiff = TIER_RANK[a.urgencyTier] - TIER_RANK[b.urgencyTier];
    if (tierDiff !== 0) return tierDiff;
    if (a.daysToExpiry === null && b.daysToExpiry === null) return 0;
    if (a.daysToExpiry === null) return 1;
    if (b.daysToExpiry === null) return -1;
    return a.daysToExpiry - b.daysToExpiry;
  });

  return result;
}
