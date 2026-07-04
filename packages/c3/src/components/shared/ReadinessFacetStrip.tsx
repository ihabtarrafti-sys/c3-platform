/**
 * ReadinessFacetStrip — Sprint 30 (Mission Readiness Cockpit).
 *
 * Compact, read-only facet strip rendered on MissionWorkspace cards.
 * Reusable: any surface holding a MissionReadiness may render it.
 *
 * Truthful-display rules (approved Sprint 30 semantics):
 *   - Loading is its own affordance — never a verdict.
 *   - NotApplicable (Settled/Canceled) renders nothing: readiness is no
 *     longer a question for these missions.
 *   - NotEvaluated (Planning/FinancePending) renders a neutral pre-ADR-002
 *     notice — never a green state.
 *   - Unknown renders an explicit data-unavailable notice alongside whichever
 *     facets DID load; a failed source is never shown as empty/clear/ready.
 *   - Zero data never reads as ready: Empty roster, NoParticipants compliance,
 *     and NotRecorded kit all carry explicit non-ready copy.
 *
 * No hooks, no services — pure presentation over a computed MissionReadiness.
 */

import { Badge, Text } from '@fluentui/react-components';

import type {
  ComplianceFacet,
  KitFacet,
  MissionReadiness,
  MissionReadinessState,
  ParticipantsFacet,
} from '@c3/types';

type BadgeColor = 'brand' | 'danger' | 'informative' | 'subtle' | 'success' | 'warning';

// ---------------------------------------------------------------------------
// Overall chip
// ---------------------------------------------------------------------------

const OVERALL_COLOR: Record<MissionReadinessState, BadgeColor> = {
  Ready:      'success',
  Incomplete: 'informative',
  AtRisk:     'warning',
  Blocked:    'danger',
};

const OVERALL_LABEL: Record<MissionReadinessState, string> = {
  Ready:      'Ready',
  Incomplete: 'Incomplete',
  AtRisk:     'At risk',
  Blocked:    'Blocked',
};

// ---------------------------------------------------------------------------
// Facet chips
// ---------------------------------------------------------------------------

const participantsChip = (facet: ParticipantsFacet): { color: BadgeColor; label: string } => {
  switch (facet.status) {
    case 'Unknown':
      return { color: 'subtle', label: 'Roster unknown — source unavailable' };
    case 'Empty':
      return { color: 'warning', label: 'No participants assigned' };
    case 'Present':
      return {
        color: 'informative',
        label: `${facet.activeCount} participant${facet.activeCount !== 1 ? 's' : ''}`,
      };
  }
};

const complianceChip = (facet: ComplianceFacet): { color: BadgeColor; label: string } => {
  switch (facet.status) {
    case 'Unknown':
      return { color: 'subtle', label: 'Compliance unknown — source unavailable' };
    case 'NoParticipants':
      return { color: 'subtle', label: 'No participants to evaluate' };
    case 'Clear':
      return { color: 'success', label: 'Gaps clear' };
    case 'AtRisk':
      return {
        color: 'warning',
        label: `${facet.gapCount} gap${facet.gapCount !== 1 ? 's' : ''}${
          facet.unroutedCount > 0 ? ` · ${facet.unroutedCount} unrouted` : ''
        }`,
      };
    case 'Blocked':
      return {
        color: 'danger',
        label: `${facet.gapCount} gap${facet.gapCount !== 1 ? 's' : ''} · ${facet.criticalCount} critical${
          facet.unroutedCount > 0 ? ` · ${facet.unroutedCount} unrouted` : ''
        }`,
      };
  }
};

const kitChip = (facet: KitFacet): { color: BadgeColor; label: string } => {
  switch (facet.status) {
    case 'Unknown':
      return { color: 'subtle', label: 'Kit unknown — source unavailable' };
    case 'NotRecorded':
      return { color: 'subtle', label: 'No kit recorded' };
    case 'Exception':
      return {
        color: 'danger',
        label: `Kit: ${facet.missingAssignments} missing`,
      };
    case 'InProgress':
      return {
        color: 'informative',
        label: `Kit ${facet.fulfilledAssignments}/${facet.totalAssignments} fulfilled${
          facet.uncoveredParticipants > 0
            ? ` · ${facet.uncoveredParticipants} uncovered`
            : ''
        }`,
      };
    case 'Fulfilled':
      return {
        color: 'success',
        label: `Kit ${facet.fulfilledAssignments}/${facet.totalAssignments} fulfilled`,
      };
  }
};

// ---------------------------------------------------------------------------
// ReadinessFacetStrip
// ---------------------------------------------------------------------------

export interface ReadinessFacetStripProps {
  /** Computed readiness for this mission; undefined while the map is empty. */
  readiness: MissionReadiness | undefined;
  /** True while the readiness sources are still loading (frame-zero gate). */
  isLoading: boolean;
  /**
   * Render the pending-membership indicator. Defaults to true. MissionWorkspace
   * passes false: its S29B card-level pending badges already display the same
   * approvals (including for pre-confirmation missions, where this strip shows
   * no facets) — rendering both would duplicate the signal on one card.
   */
  showPendingChanges?: boolean;
}

export const ReadinessFacetStrip = ({
  readiness,
  isLoading,
  showPendingChanges = true,
}: ReadinessFacetStripProps) => {
  // Loading — an affordance, never a verdict.
  if (isLoading || readiness === undefined) {
    return (
      <Text size={200} style={{ color: 'var(--c3-gray-400)', display: 'block' }}>
        Computing readiness…
      </Text>
    );
  }

  // Settled / Canceled — readiness is no longer a question.
  if (readiness.evaluation === 'NotApplicable') return null;

  // Planning / FinancePending — pre-ADR-002; no gap evidence exists by design.
  if (readiness.evaluation === 'NotEvaluated') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)', flexWrap: 'wrap' }}>
        <Badge appearance="outline" color="subtle" size="small">
          Readiness: not evaluated (pre-confirmation)
        </Badge>
      </div>
    );
  }

  const facets = readiness.facets;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)', flexWrap: 'wrap' }}>
      {/* Overall verdict — or the explicit trust failure. */}
      {readiness.evaluation === 'Unknown' ? (
        <Badge appearance="outline" color="warning" size="small">
          Readiness unknown — data unavailable
        </Badge>
      ) : readiness.overall !== null ? (
        <Badge color={OVERALL_COLOR[readiness.overall]} size="small">
          Readiness: {OVERALL_LABEL[readiness.overall]}
        </Badge>
      ) : null}

      {/* Facet chips — Unknown evaluation still shows the facets that DID load. */}
      {facets && (
        <>
          {(() => { const c = participantsChip(facets.participants); return (
            <Badge appearance="outline" color={c.color} size="small">{c.label}</Badge>
          ); })()}
          {(() => { const c = complianceChip(facets.compliance); return (
            <Badge appearance="outline" color={c.color} size="small">{c.label}</Badge>
          ); })()}
          {(() => { const c = kitChip(facets.kit); return (
            <Badge appearance="outline" color={c.color} size="small">{c.label}</Badge>
          ); })()}

          {/* Pending membership changes — informational; pending ≠ executed. */}
          {!showPendingChanges ? null : facets.participants.pendingAdds === null ? (
            <Badge appearance="outline" color="subtle" size="small">
              Pending changes unknown
            </Badge>
          ) : (facets.participants.pendingAdds > 0 || (facets.participants.pendingRemovals ?? 0) > 0) ? (
            <Badge color="warning" size="small">
              {[
                facets.participants.pendingAdds > 0
                  ? `${facets.participants.pendingAdds} addition${facets.participants.pendingAdds !== 1 ? 's' : ''}`
                  : null,
                (facets.participants.pendingRemovals ?? 0) > 0
                  ? `${facets.participants.pendingRemovals} removal${facets.participants.pendingRemovals !== 1 ? 's' : ''}`
                  : null,
              ].filter(Boolean).join(' · ')} pending approval
            </Badge>
          ) : null}
        </>
      )}
    </div>
  );
};
