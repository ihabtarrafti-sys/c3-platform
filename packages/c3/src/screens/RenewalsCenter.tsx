/**
 * RenewalsCenter — C3 Design System v1.0
 *
 * Tracks contracts requiring renewal action, active renewal processing,
 * and upcoming expiry exposure. Applies the Command Center design language:
 * canonical MetricCard / DataRow / Panel hierarchy, person-first rows,
 * urgency-coded variants, and SkeletonMetricStrip / EmptyState loading states.
 *
 * Design principle: answer three questions in scan order —
 *   1. What needs my attention?    → KPI strip + Needs Decision panel
 *   2. What is being handled?      → Renewal In Progress panel
 *   3. What is on the horizon?     → By Stage grid
 *
 * Layer: Screen — consumes hooks, components/ui, components/shared.
 * Do NOT import services, SDK, SharePoint integration, or host-level APIs.
 */

import { useMemo, type ReactNode } from 'react';
import { Text } from '@fluentui/react-components';

import {
  DataRow,
  EmptyState,
  MetricCard,
  PageHeader,
  SkeletonMetricStrip,
  SkeletonRows,
} from '@c3/components/ui';
import { DaysPill } from '@c3/components/shared/DaysPill';
import { StageBadge } from '@c3/components/shared/StageBadge';
import { useApp } from '@c3/hooks/useApp';
import { useRenewalContracts } from '@c3/hooks/useRenewalContracts';
import { computeDaysToExpiry } from '@c3/utils/dateUtils';
import { getRenewalStage } from '@c3/utils/renewalCompute';
import type { Contract, RenewalStage } from '@c3/types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STAGE_ORDER: RenewalStage[] = ['90d', '60d', '30d', '14d', '7d', 'expired'];

const STAGE_LABELS: Record<RenewalStage, string> = {
  '90d':   '90 Days',
  '60d':   '60 Days',
  '30d':   '30 Days',
  '14d':   '14 Days',
  '7d':    '7 Days',
  expired: 'Expired',
};

const STAGE_SUBTITLES: Record<RenewalStage, string> = {
  '90d':   'Contracts expiring within 90 days',
  '60d':   'Contracts expiring within 60 days',
  '30d':   'Contracts expiring within 30 days',
  '14d':   'Contracts expiring within 14 days',
  '7d':    'Contracts expiring within 7 days',
  expired: 'Past expiry — requires urgent renewal or termination',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps daysToExpiry → DataRow / MetricCard urgency variant.
 * ≤7 days (or expired): critical   — red accent
 * ≤30 days:             warning    — amber accent
 * >30 days:             default    — neutral
 */
const getRenewalVariant = (days: number): 'default' | 'warning' | 'critical' => {
  if (days <= 7) return 'critical';
  if (days <= 30) return 'warning';
  return 'default';
};

// ---------------------------------------------------------------------------
// Panel — local section container with elevation.
// Mirrors CommandCenter's Panel; will be extracted to components/ui once
// this pattern is validated across multiple screens.
// ---------------------------------------------------------------------------

type PanelProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

const Panel = ({ title, subtitle, children }: PanelProps) => (
  <div
    style={{
      backgroundColor: 'var(--c3-white)',
      borderRadius: 'var(--c3-radius-lg)',
      boxShadow: 'var(--c3-shadow-2)',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--c3-space-3)',
        padding: 'var(--c3-space-4)',
        borderBottom: '1px solid var(--c3-gray-100)',
      }}
    >
      <div>
        <Text
          weight="semibold"
          size={500}
          style={{ display: 'block', color: 'var(--c3-gray-950)' }}
        >
          {title}
        </Text>
        <Text
          size={200}
          style={{ color: 'var(--c3-gray-500)', display: 'block', marginTop: 2 }}
        >
          {subtitle}
        </Text>
      </div>
    </div>
    <div style={{ padding: 'var(--c3-space-3) var(--c3-space-4) var(--c3-space-4)' }}>
      {children}
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// PanelSkeleton — structural loading placeholder matching Panel dimensions
// ---------------------------------------------------------------------------

const PanelSkeleton = ({ rows = 5 }: { rows?: number }) => (
  <div
    style={{
      backgroundColor: 'var(--c3-white)',
      borderRadius: 'var(--c3-radius-lg)',
      boxShadow: 'var(--c3-shadow-2)',
      overflow: 'hidden',
    }}
  >
    <div
      style={{
        padding: 'var(--c3-space-4)',
        borderBottom: '1px solid var(--c3-gray-100)',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          height: 16,
          width: 140,
          borderRadius: 'var(--c3-radius-sm)',
          backgroundColor: 'var(--c3-gray-200)',
        }}
      />
      <div
        style={{
          height: 12,
          width: 220,
          borderRadius: 'var(--c3-radius-sm)',
          backgroundColor: 'var(--c3-gray-100)',
        }}
      />
    </div>
    <div style={{ padding: 'var(--c3-space-3) var(--c3-space-4) var(--c3-space-4)' }}>
      <SkeletonRows count={rows} />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface RenewalsCenterProps {
  stage?: RenewalStage;
}

// ---------------------------------------------------------------------------
// RenewalsCenter
// ---------------------------------------------------------------------------

export const RenewalsCenter = ({ stage }: RenewalsCenterProps) => {
  void stage; // reserved for future deep-link filtering by renewal stage

  const { navigate } = useApp();
  const { data: contracts = [], isLoading, error, roleDenied } = useRenewalContracts();

  // Capture data freshness time.
  // contracts reference identity changes on each successful React Query fetch,
  // so this recomputes automatically on background refreshes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => new Date().toISOString(), [contracts]);

  const model = useMemo(() => {
    const isOperationallyActive = (c: Contract) =>
      c.ContractStage1 === 'Signed' &&
      (c.Disposition1 === null || c.Disposition1 === 'Active');

    // Contracts with an active renewal in any stage within 90 days.
    const renewalWindowItems = contracts.filter(
      c =>
        isOperationallyActive(c) &&
        computeDaysToExpiry(c.EndDate) >= 0 &&
        computeDaysToExpiry(c.EndDate) <= 90,
    );

    // Subset of renewal window at ≤30 days — highest urgency.
    const criticalItems = contracts.filter(
      c =>
        isOperationallyActive(c) &&
        computeDaysToExpiry(c.EndDate) >= 0 &&
        computeDaysToExpiry(c.EndDate) <= 30,
    );

    // Any contract actively being renewed regardless of days remaining.
    const renewalInProgress = contracts.filter(c => c.Disposition1 === 'Renewing');

    // "Needs Decision" — operationally active, ≤30 days, sorted by urgency.
    // These have not yet started a formal renewal process.
    const needsDecision = contracts
      .filter(
        c =>
          isOperationallyActive(c) &&
          computeDaysToExpiry(c.EndDate) >= 0 &&
          computeDaysToExpiry(c.EndDate) <= 30,
      )
      .map(c => ({ contract: c, daysToExpiry: computeDaysToExpiry(c.EndDate) }))
      .sort((a, b) => a.daysToExpiry - b.daysToExpiry);

    // Total exposure = full renewal window + in-progress (may overlap slightly).
    const totalRenewalExposure = renewalWindowItems.length + renewalInProgress.length;

    // Enrich all non-archived, non-terminated contracts with computed stage.
    const enriched = contracts
      .filter(c => c.Disposition1 !== 'Archived' && c.Disposition1 !== 'Terminated')
      .map(c => ({
        contract: c,
        daysToExpiry: computeDaysToExpiry(c.EndDate),
        stage: getRenewalStage(computeDaysToExpiry(c.EndDate)),
      }));

    // Exclude contracts already surfaced above to avoid duplication.
    const surfaced = new Set([
      ...renewalInProgress.map(c => c.Id),
      ...needsDecision.map(item => item.contract.Id),
    ]);

    // Group remaining contracts into stage bands for the horizon grid.
    const byStage = STAGE_ORDER.map(stageKey => ({
      stage: stageKey,
      label: STAGE_LABELS[stageKey],
      subtitle: STAGE_SUBTITLES[stageKey],
      items: enriched.filter(
        item => item.stage === stageKey && !surfaced.has(item.contract.Id),
      ),
    }));

    // Enrich in-progress items with daysToExpiry for row rendering.
    const renewalInProgressItems = renewalInProgress.map(c => ({
      contract: c,
      daysToExpiry: computeDaysToExpiry(c.EndDate),
    }));

    return {
      renewalWindow:          renewalWindowItems.length,
      critical:               criticalItems.length,
      renewalInProgressCount: renewalInProgress.length,
      totalRenewalExposure,
      needsDecision,
      renewalInProgressItems,
      byStage,
    };
  }, [contracts]);

  // ── Loading ───────────────────────────────────────────────────────────────
  // S33 Set E: Renewals reads C3Contracts; a denied role (reached only via a
  // stale/direct route — the NavRail item is hidden) gets a truthful state.
  if (roleDenied) {
    return (
      <div style={{ padding: 'var(--c3-space-8)' }}>
        <EmptyState
          title="Renewals are unavailable for your role"
          description="Renewals are derived from contracts, which you don't have access to. Contact an administrator if you believe you should."
        />
      </div>
    );
  }

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
        {/* PageHeader skeleton */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              height: 28,
              width: 260,
              borderRadius: 'var(--c3-radius-md)',
              backgroundColor: 'var(--c3-gray-200)',
            }}
          />
          <div
            style={{
              height: 14,
              width: 420,
              borderRadius: 'var(--c3-radius-sm)',
              backgroundColor: 'var(--c3-gray-100)',
            }}
          />
        </div>
        <SkeletonMetricStrip />
        <PanelSkeleton rows={4} />
        <PanelSkeleton rows={3} />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'var(--c3-space-4)',
            alignItems: 'start',
          }}
        >
          {STAGE_ORDER.map(s => (
            <PanelSkeleton key={s} rows={2} />
          ))}
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ padding: 'var(--c3-space-8)' }}>
        <EmptyState
          variant="error"
          title="Could not load renewal data"
          description="Renewal contracts could not be retrieved. Check your connection or try refreshing the page."
        />
      </div>
    );
  }

  // ── Main view ─────────────────────────────────────────────────────────────
  //
  // Layout strategy: answer the operator's three questions in scan order.
  //   1. What needs my attention?   → KPI strip (color-coded) + Needs Decision panel
  //   2. What is being handled?     → Renewal In Progress panel
  //   3. What is on the horizon?    → By Stage grid (6 stage bands)
  //
  return (
    <div style={{ padding: 'var(--c3-space-8)' }}>

      {/* ── Page header ──────────────────────────────────────────────── */}
      <PageHeader
        title="Renewals Center"
        subtitle="Track contracts requiring renewal action, active renewal work, and upcoming expiry exposure."
        lastUpdated={loadedAt}
      />

      {/* ── KPI strip ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 'var(--c3-space-3)',
          marginBottom: 'var(--c3-space-6)',
        }}
      >
        <MetricCard
          label="Needs Renewal Action"
          value={model.renewalWindow}
          variant={model.renewalWindow > 0 ? 'warning' : 'default'}
          context={model.renewalWindow > 0 ? 'Expiring within 90 days' : 'No action required'}
        />
        <MetricCard
          label="Critical ≤30 Days"
          value={model.critical}
          variant={model.critical > 0 ? 'critical' : 'success'}
          context={model.critical > 0 ? 'Requires immediate attention' : 'All clear'}
        />
        <MetricCard
          label="Renewal In Progress"
          value={model.renewalInProgressCount}
          variant={model.renewalInProgressCount > 0 ? 'info' : 'default'}
          context={
            model.renewalInProgressCount > 0 ? 'Active renewal processing' : 'None in progress'
          }
        />
        <MetricCard
          label="Total Renewal Exposure"
          value={model.totalRenewalExposure}
          variant={model.totalRenewalExposure > 0 ? 'warning' : 'default'}
          context="Across all renewal windows"
        />
      </div>

      {/* ── Needs Decision ───────────────────────────────────────────── */}
      {/* Operationally active contracts ≤30 days — not yet in a renewal process. */}
      <div style={{ marginBottom: 'var(--c3-space-4)' }}>
        <Panel
          title="Needs Decision"
          subtitle="Operationally active contracts expiring within 30 days — sorted by urgency"
        >
          {model.needsDecision.length === 0 ? (
            <EmptyState
              variant="success"
              title="No contracts need immediate action"
              description="No active contracts are expiring within 30 days."
              compact
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
              {model.needsDecision.map(({ contract, daysToExpiry }) => (
                <DataRow
                  key={contract.Id}
                  title={contract.FullName}
                  subtitle={`${contract.ContractID} · ${contract.ContractTypeName}`}
                  variant={getRenewalVariant(daysToExpiry)}
                  mono={false}
                  onClick={() =>
                    navigate({ id: 'contract-profile', contractId: contract.ContractID })
                  }
                  right={
                    <div
                      style={{
                        display: 'flex',
                        gap: 'var(--c3-space-2)',
                        alignItems: 'center',
                        flexShrink: 0,
                      }}
                    >
                      <StageBadge stage={contract.ContractStage1} />
                      <DaysPill endDate={contract.EndDate} />
                    </div>
                  }
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Renewal In Progress ──────────────────────────────────────── */}
      {/* Contracts with Disposition1 === 'Renewing' — active renewal work. */}
      <div style={{ marginBottom: 'var(--c3-space-6)' }}>
        <Panel
          title="Renewal In Progress"
          subtitle="Contracts with an active renewal disposition — tracking open renewal work"
        >
          {model.renewalInProgressItems.length === 0 ? (
            <EmptyState
              variant="empty"
              title="No renewals in progress"
              description="No contracts are currently in an active renewal process."
              compact
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
              {model.renewalInProgressItems.map(({ contract, daysToExpiry }) => (
                <DataRow
                  key={contract.Id}
                  title={contract.FullName}
                  subtitle={`${contract.ContractID} · ${contract.ContractTypeName}`}
                  variant={getRenewalVariant(daysToExpiry)}
                  mono={false}
                  onClick={() =>
                    navigate({ id: 'contract-profile', contractId: contract.ContractID })
                  }
                  right={<DaysPill endDate={contract.EndDate} />}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── By Stage ─────────────────────────────────────────────────── */}
      {/* Remaining portfolio horizon — excludes contracts surfaced above. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--c3-space-4)',
          alignItems: 'start',
        }}
      >
        {model.byStage.map(group => (
          <Panel
            key={group.stage}
            title={group.label}
            subtitle={group.subtitle}
          >
            {group.items.length === 0 ? (
              <EmptyState
                variant="empty"
                title={
                  group.stage === 'expired'
                    ? 'No expired contracts at this time'
                    : 'No contracts currently in this window'
                }
                compact
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
                {group.items.map(({ contract, daysToExpiry }) => (
                  <DataRow
                    key={contract.Id}
                    title={contract.FullName}
                    subtitle={`${contract.ContractID} · ${contract.ContractTypeName}`}
                    variant={getRenewalVariant(daysToExpiry)}
                    mono={false}
                    onClick={() =>
                      navigate({ id: 'contract-profile', contractId: contract.ContractID })
                    }
                    right={<DaysPill endDate={contract.EndDate} />}
                  />
                ))}
              </div>
            )}
          </Panel>
        ))}
      </div>

    </div>
  );
};
