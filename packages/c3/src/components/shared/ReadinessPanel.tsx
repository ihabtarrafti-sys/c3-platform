/**
 * ReadinessPanel — C3 Design System, Shared Layer
 *
 * Reusable component that renders an ObligationEvaluation as a readiness signal.
 * Takes a pre-computed evaluation — it does not fetch or evaluate anything itself.
 *
 * Sprint 9 (S9-1): Each non-Satisfied obligation now surfaces its `defaultOwner`
 * as a coordination hint — "Suggested: PRO Coordinator" — directly beneath the
 * statusReason. This makes the platform a coordination surface, not just an
 * information surface.
 *
 * Layer: shared (domain-aware: knows ObligationEvaluation, ObligationStatus)
 */

import { Badge, Button, Text } from '@fluentui/react-components';

import { DataRow } from '@c3/components/ui';
import type { CredentialCapability, ObligationEvaluation, ObligationStatus } from '@c3/types';

type BadgeColor = 'success' | 'warning' | 'danger';
type RowVariant  = 'default'  | 'warning' | 'critical';

const BADGE_COLOR: Record<ObligationStatus, BadgeColor> = {
  Satisfied:   'success',
  AtRisk:      'warning',
  Unsatisfied: 'danger',
};

const ROW_VARIANT: Record<ObligationStatus, RowVariant> = {
  Satisfied:   'default',
  AtRisk:      'warning',
  Unsatisfied: 'critical',
};

const HEADER_BG: Record<ObligationStatus, string> = {
  Satisfied:   'var(--c3-success-bg)',
  AtRisk:      'var(--c3-warning-bg)',
  Unsatisfied: 'var(--c3-critical-bg)',
};

const HEADER_BORDER: Record<ObligationStatus, string> = {
  Satisfied:   'var(--c3-success-border)',
  AtRisk:      'var(--c3-warning-border)',
  Unsatisfied: 'var(--c3-critical-border)',
};

const HEADER_TEXT_COLOR: Record<ObligationStatus, string> = {
  Satisfied:   'var(--c3-success)',
  AtRisk:      'var(--c3-warning)',
  Unsatisfied: 'var(--c3-critical)',
};

const STATUS_LABEL: Record<ObligationStatus, string> = {
  Satisfied:   'Satisfied',
  AtRisk:      'At Risk',
  Unsatisfied: 'Unsatisfied',
};

function buildSummary(evaluation: ObligationEvaluation): string {
  const { obligations } = evaluation;
  const unsatisfied = obligations.filter(o => o.status === 'Unsatisfied').length;
  const atRisk      = obligations.filter(o => o.status === 'AtRisk').length;
  const satisfied   = obligations.filter(o => o.status === 'Satisfied').length;

  if (evaluation.overallStatus === 'Satisfied') {
    return `All ${satisfied} obligation${satisfied === 1 ? '' : 's'} satisfied.`;
  }
  const parts: string[] = [];
  if (unsatisfied > 0) parts.push(`${unsatisfied} unsatisfied`);
  if (atRisk      > 0) parts.push(`${atRisk} at risk`);
  return `${parts.join(', ')} — ${satisfied} satisfied.`;
}

interface ReadinessPanelProps {
  evaluation: ObligationEvaluation;
  onResolveObligation?: (capability: CredentialCapability) => void;
}

export const ReadinessPanel = ({ evaluation, onResolveObligation }: ReadinessPanelProps) => {
  const { overallStatus, obligations, protocolName, evaluatedAt } = evaluation;

  const evalTime = new Date(evaluatedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  const displayProtocol = protocolName.replace(/([A-Z])/g, ' $1').trim();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-3)' }}>

      {/* Overall status header */}
      <div
        style={{
          padding: 'var(--c3-space-4)',
          borderRadius: 'var(--c3-radius-md)',
          border: `1px solid ${HEADER_BORDER[overallStatus]}`,
          background: HEADER_BG[overallStatus],
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-2)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)' }}>
          <Text
            weight="semibold"
            style={{ color: HEADER_TEXT_COLOR[overallStatus], fontSize: '15px' }}
          >
            {STATUS_LABEL[overallStatus]}
          </Text>
          <Badge color={BADGE_COLOR[overallStatus]} size="small">
            {displayProtocol}
          </Badge>
        </div>
        <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
          {buildSummary(evaluation)}
        </Text>
        <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
          Evaluated today at {evalTime}
        </Text>
      </div>

      {/* Obligation list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
        {obligations.map(obligation => {
          const showOwnerHint =
            obligation.status !== 'Satisfied' && obligation.defaultOwner;

          // Compose subtitle: statusReason + optional ownership hint
          const subtitle = showOwnerHint
            ? (
              <span>
                {obligation.statusReason}
                <span
                  style={{
                    display: 'block',
                    marginTop: 2,
                    color: 'var(--c3-gray-400)',
                    fontSize: 12,
                  }}
                >
                  Suggested: {obligation.defaultOwner}
                </span>
              </span>
            )
            : obligation.statusReason;

          return (
            <DataRow
              key={obligation.id}
              title={obligation.requirement}
              subtitle={subtitle}
              variant={ROW_VARIANT[obligation.status]}
              mono={false}
              right={
                <Badge color={BADGE_COLOR[obligation.status]} size="small">
                  {STATUS_LABEL[obligation.status]}
                </Badge>
              }
              action={
                onResolveObligation && obligation.status !== 'Satisfied' ? (
                  <Button
                    appearance="subtle"
                    size="small"
                    onClick={() => onResolveObligation(obligation.satisfiedByCapability)}
                  >
                    Resolve
                  </Button>
                ) : undefined
              }
            />
          );
        })}
      </div>

    </div>
  );
};
