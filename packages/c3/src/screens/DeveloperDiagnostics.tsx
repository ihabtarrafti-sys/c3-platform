import { Badge, Text } from '@fluentui/react-components';

import {
  EmptyState,
  FieldGrid,
  FieldTile,
  MetricCard,
  PageHeader,
  Panel,
  PanelSkeleton,
  SkeletonBlock,
  SkeletonMetricStrip,
} from '@c3/components/ui';
import { useDiagnostics } from '@c3/hooks/useDiagnostics';
import type { DiagnosticStatus } from '@c3/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MetricVariant = 'default' | 'critical' | 'warning' | 'success' | 'info';

const statusToVariant = (status: DiagnosticStatus): MetricVariant => {
  if (status === 'pass') return 'success';
  if (status === 'warning') return 'warning';
  if (status === 'fail') return 'critical';
  return 'default';
};

const STATUS_BORDER: Record<DiagnosticStatus, string> = {
  pass:    'var(--c3-success)',
  warning: 'var(--c3-warning)',
  fail:    'var(--c3-critical)',
  pending: 'var(--c3-gray-200)',
};

const STATUS_BG: Record<DiagnosticStatus, string> = {
  pass:    'var(--c3-success-bg)',
  warning: 'var(--c3-warning-bg)',
  fail:    'var(--c3-critical-bg)',
  pending: 'var(--c3-gray-50)',
};

const FLUENT_COLOR: Record<DiagnosticStatus, 'success' | 'warning' | 'danger' | 'subtle'> = {
  pass:    'success',
  warning: 'warning',
  fail:    'danger',
  pending: 'subtle',
};

const formatDateTime = (value: string) => new Date(value).toLocaleString();

// ---------------------------------------------------------------------------
// StatusBadge — uses Fluent Badge intentionally (diagnostic tool UI)
// ---------------------------------------------------------------------------

const StatusBadge = ({ status }: { status: DiagnosticStatus }) => (
  <Badge color={FLUENT_COLOR[status]}>{status}</Badge>
);

// ---------------------------------------------------------------------------
// DeveloperDiagnostics
// ---------------------------------------------------------------------------

export const DeveloperDiagnostics = () => {
  const { data, adapter, isLoading, error } = useDiagnostics();

  if (isLoading) {
    return (
      <div
        style={{
          padding: 'var(--c3-space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-6)',
        }}
      >
        <PageHeader
          title="Developer Diagnostics"
          subtitle="Runtime validation for data source, service adapters, and integration readiness."
        />
        <SkeletonBlock height="180px" />
        <SkeletonMetricStrip count={5} />
        <PanelSkeleton rows={6} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        style={{
          padding: 'var(--c3-space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-6)',
        }}
      >
        <PageHeader
          title="Developer Diagnostics"
          subtitle="Runtime validation for data source, service adapters, and integration readiness."
        />
        <EmptyState
          variant="error"
          title="Could not load diagnostics"
          description="The diagnostic service is unavailable. Verify the adapter is configured correctly."
        />
      </div>
    );
  }

  const passed  = data.checks.filter(c => c.status === 'pass').length;
  const warnings = data.checks.filter(c => c.status === 'warning').length;
  const failed  = data.checks.filter(c => c.status === 'fail').length;

  return (
    <div
      style={{
        padding: 'var(--c3-space-8)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-4)',
      }}
    >
      <PageHeader
        title="Developer Diagnostics"
        subtitle="Runtime validation for data source, service adapters, and integration readiness."
      />

      {/* Runtime info */}
      <Panel
        title="Runtime"
        subtitle={`Mode: ${data.mode} · Generated: ${formatDateTime(data.generatedAt)}`}
      >
        <FieldGrid columns={4}>
          <FieldTile label="Mode" value={data.mode} />
          <FieldTile label="Source" value={adapter.source} />
          <FieldTile label="Site URL" value={data.siteUrl} />
          <FieldTile label="Generated" value={formatDateTime(data.generatedAt)} />
          <FieldTile label="Adapter" value={adapter.name} />
          <FieldTile label="Version" value={adapter.version} mono />
          <FieldTile label="Read Support" value={adapter.supportsRead ? 'Yes' : 'No'} />
          <FieldTile label="Write Support" value={adapter.supportsWrite ? 'Yes' : 'No'} />
        </FieldGrid>
      </Panel>

      {/* Overall health — 5-column MetricCard strip */}
      <Panel title="Overall Health" subtitle="Platform readiness summary.">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
            gap: 'var(--c3-space-3)',
          }}
        >
          <MetricCard
            label="Status"
            value={data.overallStatus.toUpperCase()}
            variant={statusToVariant(data.overallStatus)}
          />
          <MetricCard
            label="Total Checks"
            value={data.checks.length}
          />
          <MetricCard
            label="Passed"
            value={passed}
            variant={passed > 0 ? 'success' : 'default'}
          />
          <MetricCard
            label="Warnings"
            value={warnings}
            variant={warnings > 0 ? 'warning' : 'default'}
          />
          <MetricCard
            label="Failed"
            value={failed}
            variant={failed > 0 ? 'critical' : 'default'}
          />
        </div>
      </Panel>

      {/* Diagnostic checks */}
      <Panel
        title="Checks"
        subtitle={`${data.checks.length} diagnostic checks`}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--c3-space-2)',
          }}
        >
          {data.checks.map(check => (
            <div
              key={check.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '220px 1fr auto',
                gap: 'var(--c3-space-4)',
                alignItems: 'start',
                padding: 'var(--c3-space-3)',
                border: `1px solid var(--c3-gray-200)`,
                borderLeft: `3px solid ${STATUS_BORDER[check.status]}`,
                borderRadius: 'var(--c3-radius-md)',
                backgroundColor: STATUS_BG[check.status],
              }}
            >
              {/* Label + source */}
              <div>
                <Text
                  weight="semibold"
                  size={300}
                  style={{ display: 'block', color: 'var(--c3-gray-950)' }}
                >
                  {check.label}
                </Text>
                <Text
                  size={200}
                  style={{ color: 'var(--c3-gray-500)', marginTop: 2 }}
                >
                  {check.adapter ?? '—'} · {check.source ?? '—'}
                </Text>
              </div>

              {/* Message + details */}
              <div>
                <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
                  {check.message}
                </Text>

                {check.details?.length ? (
                  <ul
                    style={{
                      marginTop: 'var(--c3-space-2)',
                      marginBottom: 0,
                      paddingLeft: 'var(--c3-space-4)',
                    }}
                  >
                    {check.details.map(detail => (
                      <li key={detail}>
                        <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
                          {detail}
                        </Text>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {/* Status + metrics */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-end',
                  gap: 'var(--c3-space-1)',
                }}
              >
                <StatusBadge status={check.status} />
                {typeof check.count === 'number' && (
                  <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
                    {check.count} records
                  </Text>
                )}
                {typeof check.durationMs === 'number' && (
                  <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
                    {check.durationMs} ms
                  </Text>
                )}
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
};
