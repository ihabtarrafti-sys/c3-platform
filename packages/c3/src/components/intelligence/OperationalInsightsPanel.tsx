import { Card, CardHeader, Text } from '@fluentui/react-components';

import type { OperationalInsight } from '@c3/intelligence/operationalInsights';

interface OperationalInsightsPanelProps {
  insights: OperationalInsight[];
}

export const OperationalInsightsPanel = ({
  insights,
}: OperationalInsightsPanelProps) => {
  const sortedInsights = [...insights].sort((a, b) => {
    const severityOrder = {
      Critical: 0,
      Warning: 1,
      Info: 2,
    };

    return severityOrder[a.severity] - severityOrder[b.severity];
  });

  return (
    <Card>
      <CardHeader
        header={
          <div>
            <Text weight="semibold" size={500}>
              Operational Insights
            </Text>
            <br />
            <Text size={300}>
              Actionable observations generated from the current contract portfolio.
            </Text>
          </div>
        }
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '0 16px 16px' }}>
        {sortedInsights.length === 0 ? (
          <Text size={300}>No operational issues detected.</Text>
        ) : (
          sortedInsights.map(insight => (
            <InsightRow key={insight.id} insight={insight} />
          ))
        )}
      </div>
    </Card>
  );
};

const InsightRow = ({ insight }: { insight: OperationalInsight }) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 12,
        padding: 12,
        border: '1px solid #E5E7EB',
        borderRadius: 8,
        alignItems: 'start',
      }}
    >
      <SeverityDot severity={insight.severity} />

      <div>
        <Text weight="semibold">{insight.title}</Text>
        <br />
        <Text size={300}>{insight.description}</Text>
      </div>
    </div>
  );
};

const SeverityDot = ({
  severity,
}: {
  severity: OperationalInsight['severity'];
}) => {
  const color =
    severity === 'Critical'
      ? 'var(--c3-red)'
      : severity === 'Warning'
        ? 'var(--c3-amber)'
        : 'var(--c3-accent)';

  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: 999,
        marginTop: 6,
        backgroundColor: color,
        display: 'inline-block',
      }}
    />
  );
};