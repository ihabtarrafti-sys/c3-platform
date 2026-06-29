/**
 * workItemGenerators/gapGenerators.ts
 *
 * Per-person WorkItem generators — one function per ownership state:
 *   generateJourneyInitiation  → Unrouted gaps
 *   generateObligationRouting  → Routed gaps
 *   generateCredentialItems    → Covered gaps (Acquisition and Renewal)
 *
 * Each function receives the personId, the filtered gap subset, and the
 * departure context (blockingMission + daysUntilBlockingMission) built by
 * the entry point. Functions are pure: same inputs → same output.
 *
 * Sprint 14 S14-3: extracted from the monolithic workItemGenerators.ts.
 *
 * Deterministic WorkItem IDs:
 *   JourneyInitiation:     ji-{personId}
 *   ObligationRouting:     or-{personId}-{capabilitySlug}
 *   CredentialAcquisition: ca-{personId}-{capabilitySlug}
 *   CredentialRenewal:     cr-{personId}-{capabilitySlug}
 */

import type {
  WorkItem,
  WorkItemCategory,
  WorkItemTrigger,
} from '@c3/types';
import type { OperationalGap } from '@c3/types';
import { computeWorkItemPriority } from '../workItemPriority';
import {
  toCapabilitySlug,
  pickMostUrgent,
  groupByCapability,
  resolveOwnerSource,
  isoDaysFromToday,
} from './helpers';

// ---------------------------------------------------------------------------
// JourneyInitiation
// ---------------------------------------------------------------------------

/**
 * Generate a JourneyInitiation item for a person with Unrouted gaps.
 * One item per person — groups all unrouted gaps into a single "start a Journey"
 * work item, since the action is the same regardless of gap count.
 */
export const generateJourneyInitiation = (
  personId: string,
  unroutedGaps: OperationalGap[],
  blockingMission: string | undefined,
  daysUntilBlockingMission: number | null,
): WorkItem => {
  const most = pickMostUrgent(unroutedGaps);
  const n = unroutedGaps.length;

  // Resolve suggested owner: if all unrouted gaps share a defaultOwner, use it.
  // Otherwise fall back to 'Operations' as the protocol-level fallback.
  const ownerSet = new Set(unroutedGaps.map((g) => g.defaultOwner));
  const owner = ownerSet.size === 1 ? [...ownerSet][0] : 'Operations';

  const trigger: WorkItemTrigger = {
    type: 'OperationalGap',
    personId,
    obligationId: most.obligationId,
    gapUrgency: most.urgencyTier,
  };

  return {
    id: `ji-${personId}`,
    category: 'JourneyInitiation',
    title: `Start readiness Journey for ${most.personName}`,
    detail: `${n} unrouted gap${n !== 1 ? 's' : ''}${most.personRole ? ` · ${most.personRole}` : ''}`,
    owner,
    ownerSource: 'ProtocolDefault',
    dueDate: undefined,
    blockingMission,
    status: 'Open',
    trigger,
    links: { personId },
    priority: computeWorkItemPriority(
      'JourneyInitiation',
      trigger,
      blockingMission,
      daysUntilBlockingMission,
    ),
  };
};

// ---------------------------------------------------------------------------
// ObligationRouting
// ---------------------------------------------------------------------------

/**
 * Generate ObligationRouting items for a person's Routed gaps.
 * One item per capability type — the action (assign an owner) is the same
 * for all gaps of the same type.
 */
export const generateObligationRouting = (
  personId: string,
  routedGaps: OperationalGap[],
  blockingMission: string | undefined,
  daysUntilBlockingMission: number | null,
): WorkItem[] => {
  const items: WorkItem[] = [];
  const byCapability = groupByCapability(routedGaps);

  for (const [cap, capGaps] of byCapability) {
    const most = pickMostUrgent(capGaps);
    const trigger: WorkItemTrigger = {
      type: 'OperationalGap',
      personId,
      obligationId: most.obligationId,
      gapUrgency: most.urgencyTier,
    };

    items.push({
      id: `or-${personId}-${toCapabilitySlug(cap)}`,
      category: 'ObligationRouting',
      title: `Assign ownership of ${most.requirement} for ${most.personName}`,
      detail: `Journey active · obligation unassigned`,
      owner: most.defaultOwner,
      ownerSource: 'ProtocolDefault',
      dueDate: undefined,
      blockingMission,
      status: 'Open',
      trigger,
      links: { personId },
      priority: computeWorkItemPriority(
        'ObligationRouting',
        trigger,
        blockingMission,
        daysUntilBlockingMission,
      ),
    });
  }

  return items;
};

// ---------------------------------------------------------------------------
// CredentialAcquisition + CredentialRenewal
// ---------------------------------------------------------------------------

/**
 * Generate CredentialAcquisition and CredentialRenewal items for a person's
 * Covered gaps. One item per capability type.
 *
 * Discrimination:
 *   daysToExpiry === null → CredentialAcquisition (no credential exists)
 *   daysToExpiry !== null → CredentialRenewal     (credential exists, expiring)
 */
export const generateCredentialItems = (
  personId: string,
  coveredGaps: OperationalGap[],
  blockingMission: string | undefined,
  daysUntilBlockingMission: number | null,
): WorkItem[] => {
  const items: WorkItem[] = [];
  const byCapability = groupByCapability(coveredGaps);

  for (const [cap, capGaps] of byCapability) {
    const most = pickMostUrgent(capGaps);
    const isAcquisition = most.daysToExpiry === null;
    const category: WorkItemCategory = isAcquisition
      ? 'CredentialAcquisition'
      : 'CredentialRenewal';
    const idPrefix = isAcquisition ? 'ca' : 'cr';

    const trigger: WorkItemTrigger = {
      type: 'OperationalGap',
      personId,
      obligationId: most.obligationId,
      gapUrgency: most.urgencyTier,
    };

    const title = isAcquisition
      ? `Obtain ${most.requirement} for ${most.personName}`
      : `Renew ${most.personName}'s ${most.requirement}`;

    const detail = isAcquisition
      ? most.blockingReason
      : most.daysToExpiry !== null
        ? `Expires in ${most.daysToExpiry}d · ${most.personRole ?? 'Staff'}`
        : undefined;

    const dueDate =
      !isAcquisition && most.daysToExpiry !== null
        ? isoDaysFromToday(most.daysToExpiry)
        : undefined;

    items.push({
      id: `${idPrefix}-${personId}-${toCapabilitySlug(cap)}`,
      category,
      title,
      detail,
      owner: most.assignedTo ?? most.defaultOwner,
      ownerSource: resolveOwnerSource(most),
      dueDate,
      blockingMission,
      status: 'Open',
      trigger,
      links: { personId },
      priority: computeWorkItemPriority(
        category,
        trigger,
        blockingMission,
        daysUntilBlockingMission,
      ),
    });
  }

  return items;
};
