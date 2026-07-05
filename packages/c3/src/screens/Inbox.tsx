import { useMemo } from 'react';

import {
  DataRow,
  EmptyState,
  MetricCard,
  PageHeader,
  Panel,
  PanelSkeleton,
  SkeletonMetricStrip,
} from '@c3/components/ui';
import { DaysPill } from '@c3/components/shared/DaysPill';
import { DispositionBadge } from '@c3/components/shared/DispositionBadge';
import { OpsStatusBadge } from '@c3/components/shared/OpsStatusBadge';
import { StageBadge } from '@c3/components/shared/StageBadge';
import { useApp } from '@c3/hooks/useApp';
import { useMyContracts } from '@c3/hooks/useMyContracts';
import { computeDaysToExpiry } from '@c3/utils/dateUtils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RenewalVariant = 'default' | 'warning' | 'critical';

const getRenewalVariant = (days: number): RenewalVariant => {
  if (days <= 7) return 'critical';
  if (days <= 30) return 'warning';
  return 'default';
};

// ---------------------------------------------------------------------------
// Inbox
// ---------------------------------------------------------------------------

export const Inbox = () => {
  const { navigate, currentUser } = useApp();
  const { data: contracts = [], isLoading, error } = useMyContracts();

  const model = useMemo(() => {
    const enriched = contracts.map(contract => ({
      contract,
      daysToExpiry: computeDaysToExpiry(contract.EndDate),
    }));

    const needsAttention = enriched
      .filter(item => {
        const isSigned = item.contract.ContractStage1 === 'Signed';
        const requiresRenewalAction = item.contract.Disposition1 === 'Active';
        const expiringSoon = item.daysToExpiry >= 0 && item.daysToExpiry <= 90;
        return isSigned && requiresRenewalAction && expiringSoon;
      })
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

    const expiring30 = enriched
      .filter(item => item.daysToExpiry >= 0 && item.daysToExpiry <= 30)
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

    return {
      total: contracts.length,
      needsAttention,
      expiring30,
      all: enriched.sort((a, b) => a.daysToExpiry - b.daysToExpiry),
    };
  }, [contracts]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => new Date().toISOString(), [contracts]);

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
          title="Inbox"
          subtitle={`Owner-specific contract work for ${currentUser.displayName}.`}
        />
        <SkeletonMetricStrip count={3} />
        <PanelSkeleton rows={4} />
        <PanelSkeleton rows={4} />
        <PanelSkeleton rows={8} />
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
        <PageHeader
          title="Inbox"
          subtitle={`Owner-specific contract work for ${currentUser.displayName}.`}
        />
        <EmptyState
          variant="error"
          title="Could not load inbox"
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
        gap: 'var(--c3-space-6)',
      }}
    >
      <PageHeader
        title="Inbox"
        subtitle={`Owner-specific contract work for ${currentUser.displayName}.`}
        lastUpdated={loadedAt}
      />

      {/* KPI strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--c3-space-3)',
        }}
      >
        <MetricCard label="My Contracts" value={model.total} />
        <MetricCard
          label="Needs Attention"
          value={model.needsAttention.length}
          variant={model.needsAttention.length > 0 ? 'warning' : 'default'}
          context={model.needsAttention.length > 0 ? 'Signed active, 0–90 days' : undefined}
        />
        <MetricCard
          label="Expiring ≤30d"
          value={model.expiring30.length}
          variant={model.expiring30.length > 0 ? 'critical' : 'default'}
          context={model.expiring30.length > 0 ? 'Requires immediate review' : undefined}
        />
      </div>

      {/* Needs Attention */}
      <Panel
        title="Needs Attention"
        subtitle="Signed active contracts inside the renewal window requiring renewal review."
      >
        {model.needsAttention.length === 0 ? (
          <EmptyState
            compact
            title="No renewal gaps"
            description="No owner-specific renewal gaps at this time."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
            {model.needsAttention.map(({ contract, daysToExpiry }) => (
              <DataRow
                key={contract.Id}
                title={contract.ContractID}
                subtitle={`${contract.FullName} · ${contract.ContractTypeName}`}
                variant={getRenewalVariant(daysToExpiry)}
                onClick={() =>
                  navigate({ id: 'contract-profile', contractId: contract.ContractID })
                }
                right={
                  <>
                    <StageBadge stage={contract.ContractStage1} />
                    <OpsStatusBadge status={contract.OpsStatus} />
                    <DaysPill endDate={contract.EndDate} />
                  </>
                }
              />
            ))}
          </div>
        )}
      </Panel>

      {/* Expiring Soon */}
      <Panel
        title="Expiring Soon"
        subtitle="Your contracts expiring within 30 days."
      >
        {model.expiring30.length === 0 ? (
          <EmptyState
            compact
            title="No contracts expiring soon"
            description="No contracts expiring within 30 days."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
            {model.expiring30.map(({ contract, daysToExpiry }) => (
              <DataRow
                key={contract.Id}
                title={contract.ContractID}
                subtitle={`${contract.FullName} · ${contract.ContractTypeName}`}
                variant={getRenewalVariant(daysToExpiry)}
                onClick={() =>
                  navigate({ id: 'contract-profile', contractId: contract.ContractID })
                }
                right={
                  <>
                    <DispositionBadge disposition={contract.Disposition1} />
                    <DaysPill endDate={contract.EndDate} />
                  </>
                }
              />
            ))}
          </div>
        )}
      </Panel>

      {/* My Contracts */}
      <Panel
        title="My Contracts"
        subtitle="All contracts assigned to you."
      >
        {model.all.length === 0 ? (
          <EmptyState
            compact
            title="No contracts assigned"
            description="No contracts are currently assigned to you."
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
            {model.all.map(({ contract, daysToExpiry }) => (
              <DataRow
                key={contract.Id}
                title={contract.ContractID}
                subtitle={`${contract.FullName} · ${contract.ContractTypeName}`}
                variant={getRenewalVariant(daysToExpiry)}
                onClick={() =>
                  navigate({ id: 'contract-profile', contractId: contract.ContractID })
                }
                right={
                  <>
                    <StageBadge stage={contract.ContractStage1} />
                    <OpsStatusBadge status={contract.OpsStatus} />
                    <DispositionBadge disposition={contract.Disposition1} />
                    <DaysPill endDate={contract.EndDate} />
                  </>
                }
              />
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
};
