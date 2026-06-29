import { EmptyState, PageHeader, SkeletonBlock, SkeletonMetricStrip } from '@c3/components/ui';

import { AmendmentHealthCard } from '@c3/components/intelligence/AmendmentHealthCard';
import { ExecutiveKpiStrip } from '@c3/components/intelligence/ExecutiveKpiStrip';
import { OperationalInsightsPanel } from '@c3/components/intelligence/OperationalInsightsPanel';
import { PortfolioBreakdownCard } from '@c3/components/intelligence/PortfolioBreakdownCard';
import { RenewalHealthCard } from '@c3/components/intelligence/RenewalHealthCard';
import { WorkflowBreakdownCard } from '@c3/components/intelligence/WorkflowBreakdownCard';

import { useIntelligence } from '@c3/intelligence/useIntelligence';

const SUBTITLE =
  'Executive view of contract portfolio health, renewal workload, and amendment activity.';

export const Intelligence = () => {
  const { intelligence, isLoading, error } = useIntelligence();

  if (isLoading) {
    return (
      <div
        style={{
          padding: 'var(--c3-space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-4)',
        }}
      >
        <PageHeader title="Intelligence" subtitle={SUBTITLE} />
        <SkeletonBlock height="100px" />
        <SkeletonMetricStrip count={4} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 'var(--c3-space-4)',
          }}
        >
          <SkeletonBlock height="200px" />
          <SkeletonBlock height="200px" />
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 'var(--c3-space-4)',
          }}
        >
          <SkeletonBlock height="200px" />
          <SkeletonBlock height="200px" />
        </div>
        <SkeletonBlock height="160px" />
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 'var(--c3-space-8)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-6)',
        }}
      >
        <PageHeader title="Intelligence" subtitle={SUBTITLE} />
        <EmptyState
          variant="error"
          title="Could not load intelligence"
          description="Check your connection and try again."
        />
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 'var(--c3-space-8)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-4)',
      }}
    >
      <PageHeader title="Intelligence" subtitle={SUBTITLE} />

      <OperationalInsightsPanel insights={intelligence.insights} />

      <ExecutiveKpiStrip kpis={intelligence.kpis} />

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--c3-space-4)',
        }}
      >
        <WorkflowBreakdownCard items={intelligence.workflow} />
        <RenewalHealthCard kpis={intelligence.kpis} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 'var(--c3-space-4)',
        }}
      >
        <AmendmentHealthCard items={intelligence.amendments} />
        <PortfolioBreakdownCard title="Contracts by Game" items={intelligence.games} />
      </div>

      <PortfolioBreakdownCard title="Contracts by Team" items={intelligence.teams} />
    </div>
  );
};
