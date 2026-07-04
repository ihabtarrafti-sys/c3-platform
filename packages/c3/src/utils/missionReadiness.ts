/**
 * missionReadiness.ts
 *
 * Pure mission-readiness computation — Sprint 30 (Mission Readiness Cockpit).
 *
 * Single source of truth for the two-axis readiness model:
 *   MissionEvaluationState (lifecycle applicability + source trust) and
 *   MissionReadinessState  (evaluated severity, Blocked > AtRisk > Incomplete > Ready).
 *
 * Consumed by:
 *   - hooks/useMissionReadiness.ts            (composition over existing batch queries)
 *   - components/shared/ReadinessFacetStrip   (display)
 *   - scripts/s30-parity-readiness.mjs        (compiled-from-source parity)
 *
 * Design constraints (locked at Sprint 30 approval):
 *   - ADR-002 preserved: readiness is computed beside useMissionGaps, never by
 *     modifying it. The lifecycle mapping below re-states the activation gate;
 *     MISSION_OBLIGATION_ACTIVE_STATUSES itself is untouched.
 *   - One batch pass across all missions. Compliance reuses the exact
 *     useMissionGaps recipe (computeGapsForPeople + participant-scoped maps +
 *     mission-horizon urgency) so both surfaces always agree.
 *   - A failed source never becomes an empty successful state. Untrusted
 *     required sources produce evaluation 'Unknown' and facet 'Unknown' —
 *     never Empty / NotRecorded / Clear.
 *   - Pending approvals are informational. Their source failing makes only the
 *     pending indicator Unknown (null counts); it neither invents executed
 *     membership nor invalidates trusted operational evidence.
 *
 * No React, no hooks, no service dependencies. Pure functions only.
 */

import { computeGapsForPeople } from '@c3/utils/gapComputation';
import { FULFILLED_KIT_STATUSES } from '@c3/types';
import type {
  ComplianceFacet,
  Credential,
  Journey,
  KitAssignment,
  KitFacet,
  Mission,
  MissionEvaluationState,
  MissionParticipant,
  MissionReadiness,
  MissionReadinessState,
  MissionStatus,
  ParticipantsFacet,
  PendingParticipantChange,
  ProtocolContext,
  ProtocolFn,
  ReadinessSource,
} from '@c3/types';

// ---------------------------------------------------------------------------
// Lifecycle mapping (approved Sprint 30 semantics — restates ADR-002)
// ---------------------------------------------------------------------------

/**
 * Map a MissionStatus to its base evaluation state, before source trust is
 * applied. Evaluation-eligible statuses may still resolve to 'Unknown' when a
 * required source is untrusted.
 */
export const EVALUATION_STATE_BY_STATUS: Record<MissionStatus, MissionEvaluationState> = {
  Planning:       'NotEvaluated',
  FinancePending: 'NotEvaluated',
  Confirmed:      'Evaluated',
  Active:         'Evaluated',
  PostMission:    'Evaluated',
  Settled:        'NotApplicable',
  Canceled:       'NotApplicable',
};

/** Severity rank for the overall precedence. Higher = worse. */
const SEVERITY: Record<MissionReadinessState, number> = {
  Ready: 0,
  Incomplete: 1,
  AtRisk: 2,
  Blocked: 3,
};

const worse = (a: MissionReadinessState, b: MissionReadinessState): MissionReadinessState =>
  SEVERITY[b] > SEVERITY[a] ? b : a;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface MissionReadinessInputs {
  /** Active mission participants across all missions (required source). */
  participants: ReadinessSource<MissionParticipant>;
  /** All credentials (required source for the compliance facet). */
  credentials: ReadinessSource<Credential>;
  /** All active onboarding journeys (required source for the compliance facet). */
  journeys: ReadinessSource<Journey>;
  /** Active kit assignments across all missions (required source). */
  kit: ReadinessSource<KitAssignment>;
  /** Pending participant-membership approvals (informational source). */
  pendingChanges: ReadinessSource<PendingParticipantChange>;
}

// ---------------------------------------------------------------------------
// computeMissionReadiness
// ---------------------------------------------------------------------------

/**
 * Compute readiness for every mission in one pass.
 *
 * @param missions   All missions (any status; lifecycle mapping is applied here).
 * @param inputs     Batch sources with per-source trust flags.
 * @param protocols  Protocol functions for the compliance facet. Callers pass
 *                   [evaluateOnboardingObligations] — injected to keep this
 *                   module protocol-agnostic and parity-testable.
 */
export function computeMissionReadiness(
  missions: Mission[],
  inputs: MissionReadinessInputs,
  protocols: ProtocolFn[],
): Map<string, MissionReadiness> {
  const result = new Map<string, MissionReadiness>();

  // ── Pre-group sources once (trusted or not — grouping is cheap and the
  //    per-facet trust checks below decide whether the data is used). ─────────
  const participantsByMission = groupBy(inputs.participants.data, p => p.MissionID);
  const kitByMission = groupBy(inputs.kit.data, k => k.MissionID);
  const credentialsByPerson = groupBy(inputs.credentials.data, c => c.HolderPersonID);
  const journeyByPerson = new Map<string, Journey>();
  for (const j of inputs.journeys.data) journeyByPerson.set(j.PersonID, j);
  const pendingByMission = groupBy(inputs.pendingChanges.data, p => p.missionId);

  for (const mission of missions) {
    const base = EVALUATION_STATE_BY_STATUS[mission.Status];

    // NotEvaluated / NotApplicable: no facets, no overall, no precedence.
    if (base !== 'Evaluated') {
      result.set(mission.MissionID, {
        missionId: mission.MissionID,
        evaluation: base,
        overall: null,
        facets: null,
      });
      continue;
    }

    // ── Evaluation-eligible: compute facets with per-source trust. ──────────
    const participantsTrusted = inputs.participants.trusted;
    const complianceTrusted =
      participantsTrusted && inputs.credentials.trusted && inputs.journeys.trusted;
    const kitTrusted = participantsTrusted && inputs.kit.trusted;

    const missionParticipants = participantsByMission.get(mission.MissionID) ?? [];
    const missionKit = kitByMission.get(mission.MissionID) ?? [];
    const pending = pendingByMission.get(mission.MissionID) ?? [];

    const participants = computeParticipantsFacet(
      participantsTrusted,
      missionParticipants,
      inputs.pendingChanges.trusted ? pending : null,
    );

    const compliance = computeComplianceFacet(
      complianceTrusted,
      mission,
      missionParticipants,
      credentialsByPerson,
      journeyByPerson,
      protocols,
    );

    const kit = computeKitFacet(kitTrusted, missionParticipants, missionKit);

    // A required blocking-facet source failure makes the whole evaluation
    // Unknown — precedence is never applied over untrusted evidence.
    const allRequiredTrusted = participantsTrusted && complianceTrusted && kitTrusted;

    result.set(mission.MissionID, {
      missionId: mission.MissionID,
      evaluation: allRequiredTrusted ? 'Evaluated' : 'Unknown',
      overall: allRequiredTrusted
        ? computeOverall(participants, compliance, kit)
        : null,
      facets: { participants, compliance, kit },
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Facet computations
// ---------------------------------------------------------------------------

function computeParticipantsFacet(
  trusted: boolean,
  missionParticipants: MissionParticipant[],
  pending: PendingParticipantChange[] | null,
): ParticipantsFacet {
  const pendingAdds =
    pending === null
      ? null
      : pending.filter(p => p.operationType === 'AddMissionParticipant').length;
  const pendingRemovals =
    pending === null
      ? null
      : pending.filter(p => p.operationType === 'RemoveMissionParticipant').length;

  if (!trusted) {
    // Participant source failed — never rendered as an empty roster.
    return { status: 'Unknown', activeCount: 0, pendingAdds, pendingRemovals };
  }

  return {
    status: missionParticipants.length === 0 ? 'Empty' : 'Present',
    activeCount: missionParticipants.length,
    pendingAdds,
    pendingRemovals,
  };
}

function computeComplianceFacet(
  trusted: boolean,
  mission: Mission,
  missionParticipants: MissionParticipant[],
  credentialsByPerson: Map<string, Credential[]>,
  journeyByPerson: Map<string, Journey>,
  protocols: ProtocolFn[],
): ComplianceFacet {
  const empty = { gapCount: 0, criticalCount: 0, highCount: 0, mediumCount: 0, unroutedCount: 0 };

  if (!trusted) {
    // Credential/journey/participant source failed — never rendered Clear.
    return { status: 'Unknown', ...empty };
  }

  if (missionParticipants.length === 0) {
    // Zero participants produce zero gaps by construction — there is no one
    // to evaluate. That is NOT Clear (truthful empty-state rule, S27).
    return { status: 'NoParticipants', ...empty };
  }

  // Exact useMissionGaps recipe: participant-scoped maps, span context,
  // mission-horizon urgency. Display names are irrelevant to counting, so the
  // PersonID doubles as the name — no dependency on the People source.
  const participantIds = new Set(missionParticipants.map(p => p.PersonID));

  const scopedCredentials = new Map<string, Credential[]>();
  for (const [personId, creds] of credentialsByPerson) {
    if (participantIds.has(personId)) scopedCredentials.set(personId, creds);
  }
  const scopedJourneys = new Map<string, Journey>();
  for (const [personId, journey] of journeyByPerson) {
    if (participantIds.has(personId)) scopedJourneys.set(personId, journey);
  }

  const protocolContext: ProtocolContext = {
    span: { from: mission.Span.StartDate, to: mission.Span.EndDate },
  };

  const gaps = computeGapsForPeople(
    missionParticipants.map(p => ({
      personId: p.PersonID,
      personName: p.PersonID,
      personRole: p.Role,
    })),
    scopedCredentials,
    scopedJourneys,
    protocols,
    protocolContext,
    {
      missionId: mission.MissionID,
      missionName: mission.Name,
      missionEndDate: mission.Span.EndDate,
    },
  );

  const criticalCount = gaps.filter(g => g.urgencyTier === 'Critical').length;
  const highCount = gaps.filter(g => g.urgencyTier === 'High').length;
  const mediumCount = gaps.filter(g => g.urgencyTier === 'Medium').length;
  const unroutedCount = gaps.filter(g => g.ownershipState === 'Unrouted').length;

  return {
    status: criticalCount > 0 ? 'Blocked' : gaps.length > 0 ? 'AtRisk' : 'Clear',
    gapCount: gaps.length,
    criticalCount,
    highCount,
    mediumCount,
    unroutedCount,
  };
}

function computeKitFacet(
  trusted: boolean,
  missionParticipants: MissionParticipant[],
  missionKit: KitAssignment[],
): KitFacet {
  const empty = {
    totalAssignments: 0,
    fulfilledAssignments: 0,
    missingAssignments: 0,
    coveredParticipants: 0,
    uncoveredParticipants: 0,
  };

  if (!trusted) {
    // Kit (or participant) source failed — never rendered NotRecorded.
    return { status: 'Unknown', ...empty };
  }

  const totalAssignments = missionKit.length;
  const fulfilledAssignments = missionKit.filter(k =>
    FULFILLED_KIT_STATUSES.includes(k.Status),
  ).length;
  const missingAssignments = missionKit.filter(k => k.Status === 'Missing').length;

  // Participant-aware denominator: coverage is judged over ACTIVE participants.
  // Until an explicit kit-not-applicable model exists, every active participant
  // is assumed to require at least one active assignment.
  const equippedPersonIds = new Set(missionKit.map(k => k.PersonID));
  const coveredParticipants = missionParticipants.filter(p =>
    equippedPersonIds.has(p.PersonID),
  ).length;
  const uncoveredParticipants = missionParticipants.length - coveredParticipants;

  const counts = {
    totalAssignments,
    fulfilledAssignments,
    missingAssignments,
    coveredParticipants,
    uncoveredParticipants,
  };

  // Status precedence: Exception (Missing) is reported even alongside gaps in
  // coverage — a missing item is the strongest kit signal.
  if (missingAssignments > 0) return { status: 'Exception', ...counts };
  if (totalAssignments === 0) return { status: 'NotRecorded', ...counts };

  const fulfilled =
    missionParticipants.length > 0 &&
    uncoveredParticipants === 0 &&
    fulfilledAssignments === totalAssignments;

  return { status: fulfilled ? 'Fulfilled' : 'InProgress', ...counts };
}

// ---------------------------------------------------------------------------
// Overall precedence (applied ONLY when evaluation === 'Evaluated')
// ---------------------------------------------------------------------------

/**
 * Blocked > AtRisk > Incomplete > Ready.
 *
 * Facet contributions:
 *   compliance Blocked                → Blocked
 *   compliance AtRisk                 → AtRisk
 *   kit Exception (Missing item)      → AtRisk  (never Ready — approved S30 decision:
 *                                       a missing physical item is a serious operational
 *                                       exception but does not categorically block the
 *                                       mission the way an unsatisfied credential does)
 *   participants Empty                → Incomplete (zero participants is never Ready)
 *   compliance NoParticipants         → Incomplete (same condition, same contribution)
 *   kit NotRecorded / InProgress      → Incomplete (uncovered participants prevent Ready)
 *   everything satisfied              → Ready
 */
function computeOverall(
  participants: ParticipantsFacet,
  compliance: ComplianceFacet,
  kit: KitFacet,
): MissionReadinessState {
  let overall: MissionReadinessState = 'Ready';

  if (participants.status === 'Empty') overall = worse(overall, 'Incomplete');

  if (compliance.status === 'Blocked') overall = worse(overall, 'Blocked');
  else if (compliance.status === 'AtRisk') overall = worse(overall, 'AtRisk');
  else if (compliance.status === 'NoParticipants') overall = worse(overall, 'Incomplete');

  if (kit.status === 'Exception') overall = worse(overall, 'AtRisk');
  else if (kit.status === 'NotRecorded' || kit.status === 'InProgress') {
    overall = worse(overall, 'Incomplete');
  }

  return overall;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}
