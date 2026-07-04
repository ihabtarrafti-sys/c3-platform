/**
 * workItemGenerators/index.ts — entry point
 *
 * Sprint 11 (Command Center: Operational Work Queue)
 * Sprint 12 (Mission Milestones: Planning Spine)
 * Sprint 14 S14-3: monolithic workItemGenerators.ts split into this directory.
 *
 * Public API: generateWorkItems(gaps, missions, milestones, participantPersonIdsByMission)
 *
 * Pipeline:
 *   1. Build mission pressure index (departure window, per-person context)
 *      using participantPersonIdsByMission (S14-2: replaces ParticipantPersonIDs)
 *   2. Group gaps by person
 *   3. Per-person: generate JourneyInitiation, ObligationRouting,
 *      CredentialAcquisition, and CredentialRenewal items
 *   4. Per-mission: generate MissionDeparturePressure items
 *   5. Per-mission: generate MilestoneAlert items (Sprint 12)
 *   6. Sort the combined list
 *
 * Deterministic IDs:
 *   JourneyInitiation:        ji-{personId}
 *   CredentialAcquisition:    ca-{personId}-{capabilitySlug}
 *   CredentialRenewal:        cr-{personId}-{capabilitySlug}
 *   ObligationRouting:        or-{personId}-{capabilitySlug}
 *   MissionDeparturePressure: mdp-{missionId}
 *   MilestoneAlert:           ml-{milestoneId}
 *
 * capabilitySlug is CredentialCapability converted to kebab-case,
 * e.g. 'RightToWork' → 'right-to-work', 'Travel' → 'travel'.
 *
 * Module structure:
 *   helpers.ts          — constants + shared pure functions
 *   gapGenerators.ts    — per-person generators (JourneyInitiation, ObligationRouting, Credential*)
 *   missionGenerators.ts  — MissionDeparturePressure generator
 *   milestoneGenerators.ts — MilestoneAlert generator
 *   index.ts (this file) — generateWorkItems entry point + pipeline
 *
 * See: docs/architecture/WorkItem Model — Sprint 11 Design.md
 * See: docs/releases/Sprint 12 Proposal.md
 */

import type { WorkItem } from '@c3/types';
import type { OperationalGap } from '@c3/types';
import type { Mission } from '@c3/types';
import type { MissionMilestone } from '@c3/types';
import { MISSION_OBLIGATION_ACTIVE_STATUSES } from '@c3/types';
import { daysUntilExpiry } from '@c3/utils/urgency';
import {
  DEPARTURE_PRESSURE_WINDOW_DAYS,
  getDaysUntilDeparture,
  sortWorkItems,
} from './helpers';
import {
  generateJourneyInitiation,
  generateObligationRouting,
  generateCredentialItems,
} from './gapGenerators';
import { generateMissionDeparturePressure } from './missionGenerators';
import { generateMissionReadinessGap } from './readinessGenerators';
import { generateMilestoneWorkItems } from './milestoneGenerators';

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Generate all WorkItems from the current operational state.
 *
 * @param gaps      All OperationalGaps from useOperationalGaps. These carry
 *                  rolling-window urgency — not mission-horizon urgency.
 * @param missions  All missions. Generator filters to ADR-002-eligible missions
 *                  within the 30-day departure window internally.
 * @param milestones All MissionMilestones from useAllMilestones. Generator
 *                  filters to Overdue and DueSoon milestones for eligible
 *                  missions internally. Defaults to [] for backward compatibility.
 * @param participantPersonIdsByMission Map of missionId → personId[].
 *                  Built by useAllMissionParticipants (S14-2). Replaces the
 *                  former Mission.ParticipantPersonIDs array. Defaults to an
 *                  empty Map — departure pressure items are suppressed when
 *                  absent. NOTE (S30): the map is treated as the authoritative
 *                  active-participant record — an upcoming mission with no
 *                  entry emits a zero-roster MissionReadinessGap item. Callers
 *                  must pass the real map (useWorkItems always does) and must
 *                  not invoke this pipeline while the participant source is
 *                  loading or failed (useWorkItems gates on both).
 *
 * @returns Sorted WorkItem[] (Immediate → High → Normal; MDP first within band).
 */
export const generateWorkItems = (
  gaps: OperationalGap[],
  missions: Mission[],
  milestones: MissionMilestone[] = [],
  participantPersonIdsByMission: Map<string, string[]> = new Map(),
): WorkItem[] => {
  const items: WorkItem[] = [];

  // ── Step 1: Build mission pressure index ─────────────────────────────────
  //
  // Identify upcoming missions: ADR-002-eligible AND within the departure window.
  //   Active missions    → always included (happening now; days = 0)
  //   Confirmed missions → included when StartDate ≤ 30 days away
  //   PostMission        → excluded (event over; no departure pressure)
  const upcomingMissions = missions
    .filter((m) => MISSION_OBLIGATION_ACTIVE_STATUSES.includes(m.Status))
    .filter((m) => {
      if (m.Status === 'Active') return true;
      if (m.Status === 'PostMission') return false;
      const d = daysUntilExpiry(m.Span.StartDate);
      return d !== null && d >= 0 && d <= DEPARTURE_PRESSURE_WINDOW_DAYS;
    });

  // personId → minimum daysUntilDeparture across all upcoming missions they join
  // (the nearest mission is the binding constraint)
  const personMinDeparture = new Map<string, number>();
  // personId → mission name for that nearest mission
  const personBlockingMission = new Map<string, string>();

  for (const mission of upcomingMissions) {
    const days = getDaysUntilDeparture(mission);
    for (const personId of (participantPersonIdsByMission.get(mission.MissionID) ?? [])) {
      const existing = personMinDeparture.get(personId);
      if (existing === undefined || days < existing) {
        personMinDeparture.set(personId, days);
        personBlockingMission.set(personId, mission.Name);
      }
    }
  }

  // ── Step 2: Group all gaps by person ─────────────────────────────────────
  const gapsByPerson = new Map<string, OperationalGap[]>();
  for (const gap of gaps) {
    const existing = gapsByPerson.get(gap.personId);
    if (existing) {
      existing.push(gap);
    } else {
      gapsByPerson.set(gap.personId, [gap]);
    }
  }

  // ── Step 3: Generate per-person items ────────────────────────────────────
  for (const [personId, personGaps] of gapsByPerson) {
    const minDeparture = personMinDeparture.get(personId) ?? null;
    const blockingMission = personBlockingMission.get(personId);

    const unroutedGaps = personGaps.filter((g) => g.ownershipState === 'Unrouted');
    const routedGaps   = personGaps.filter((g) => g.ownershipState === 'Routed');
    const coveredGaps  = personGaps.filter((g) => g.ownershipState === 'Covered');

    if (unroutedGaps.length > 0) {
      items.push(
        generateJourneyInitiation(personId, unroutedGaps, blockingMission, minDeparture),
      );
    }

    if (routedGaps.length > 0) {
      items.push(
        ...generateObligationRouting(personId, routedGaps, blockingMission, minDeparture),
      );
    }

    if (coveredGaps.length > 0) {
      items.push(
        ...generateCredentialItems(personId, coveredGaps, blockingMission, minDeparture),
      );
    }
  }

  // ── Step 4: MissionDeparturePressure items ────────────────────────────────
  for (const mission of upcomingMissions) {
    const item = generateMissionDeparturePressure(mission, gapsByPerson, participantPersonIdsByMission);
    if (item) items.push(item);
  }

  // ── Step 4b: MissionReadinessGap items (Sprint 30) ────────────────────────
  //
  // Zero-roster blind spot: an upcoming Confirmed/Active mission with no
  // participants produces no gaps and therefore no MDP item. Mutually
  // exclusive with MDP for the same mission by construction (MDP needs gaps,
  // gaps need participants). upcomingMissions already applies the window and
  // excludes PostMission; Planning/FinancePending/Settled/Canceled never enter.
  for (const mission of upcomingMissions) {
    const item = generateMissionReadinessGap(mission, participantPersonIdsByMission);
    if (item) items.push(item);
  }

  // ── Step 5: MilestoneAlert items (Sprint 12) ──────────────────────────────
  if (milestones.length > 0) {
    items.push(...generateMilestoneWorkItems(missions, milestones));
  }

  // ── Step 6: Sort ──────────────────────────────────────────────────────────
  return sortWorkItems(items);
};
