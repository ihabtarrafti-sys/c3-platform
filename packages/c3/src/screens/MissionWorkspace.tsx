/**
 * MissionWorkspace — C3 Design System v1.0
 *
 * Sprint 26 (S26-3) — Mission/Event Read Foundation.
 *
 * Read-only register of mission/event commitments. A Mission is Geekay's
 * commitment to deploy people and resources to a defined operational event
 * (see types/mission.ts). This screen exposes the mission domain that has
 * been mature in mock mode since Sprints 10–14; deep mission operations
 * (gap computation, confirmation, finance) remain in the Situation Room.
 *
 * Layout:
 *   PageHeader (title + subtitle + last-updated)
 *   KPI strip (3 MetricCards — total / obligation-active / pending finance)
 *   Mission cards grid — one card per mission
 *
 * Design constraints:
 *   - Strictly read-only: no create, edit, or confirm actions (mission writes
 *     are out of S26 scope; confirmation stays in the Situation Room flow).
 *   - Card layout rather than a dense table — mission volume is tens per
 *     year, and each record carries enough context to justify a card.
 *   - Status colours follow the ADR-002 lifecycle: pre-Confirmed statuses are
 *     visually quiet; Confirmed/Active are prominent.
 *
 * Layer: Screen — consumes hooks, components/ui, components/shared.
 * Do NOT import services, SDK, SharePoint integration, or host-level APIs.
 */

import { useMemo } from 'react';
import { Badge, Text } from '@fluentui/react-components';

import {
  EmptyState,
  MetricCard,
  PageHeader,
  SkeletonMetricStrip,
  SkeletonRows,
} from '@c3/components/ui';
import { useMissions } from '@c3/hooks/useMissions';
import type { Mission, MissionStatus } from '@c3/types';
import { MISSION_OBLIGATION_ACTIVE_STATUSES } from '@c3/types';

// ---------------------------------------------------------------------------
// MissionStatusBadge — screen-local status badge (same pattern as the
// screen-local badges in ApprovalInbox). Colours map the ADR-002 lifecycle.
// ---------------------------------------------------------------------------

const COLOR_BY_STATUS: Record<
  MissionStatus,
  'brand' | 'danger' | 'informative' | 'subtle' | 'success' | 'warning'
> = {
  Planning:       'informative',
  FinancePending: 'warning',
  Confirmed:      'brand',
  Active:         'success',
  PostMission:    'informative',
  Settled:        'subtle',
  Canceled:       'danger',
};

// Maps internal domain values to user-facing labels.
// Domain type MissionStatus is intentionally preserved unchanged.
const LABEL_BY_STATUS: Record<MissionStatus, string> = {
  Planning:       'Planning',
  FinancePending: 'Finance Pending',
  Confirmed:      'Confirmed',
  Active:         'Active',
  PostMission:    'Post-Mission',
  Settled:        'Settled',
  Canceled:       'Canceled',
};

const MissionStatusBadge = ({ status }: { status: MissionStatus }) => (
  <Badge color={COLOR_BY_STATUS[status]}>{LABEL_BY_STATUS[status]}</Badge>
);

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

/** Date-only display — Span dates are already YYYY-MM-DD strings. */
const formatDate = (value?: string): string => {
  if (!value) return '—';
  return value.split('T')[0];
};

// ---------------------------------------------------------------------------
// MissionCard — one read-only card per mission
// ---------------------------------------------------------------------------

const FieldPair = ({ label, value }: { label: string; value: string }) => (
  <div style={{ minWidth: 0 }}>
    <Text
      size={200}
      style={{
        display: 'block',
        color: 'var(--c3-gray-500)',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        fontWeight: 600,
      }}
    >
      {label}
    </Text>
    <Text
      size={300}
      style={{
        display: 'block',
        color: 'var(--c3-gray-950)',
        marginTop: 2,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {value}
    </Text>
  </div>
);

const MissionCard = ({ mission }: { mission: Mission }) => (
  <div
    style={{
      backgroundColor: 'var(--c3-white)',
      borderRadius: 'var(--c3-radius-lg)',
      boxShadow: 'var(--c3-shadow-2)',
      padding: 'var(--c3-space-4)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--c3-space-3)',
    }}
  >
    {/* Card header — MissionID, name, status */}
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 'var(--c3-space-3)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Text
          weight="semibold"
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            color: 'var(--c3-gray-500)',
            display: 'block',
            whiteSpace: 'nowrap',
          }}
        >
          {mission.MissionID}
        </Text>
        <Text
          weight="semibold"
          size={400}
          style={{ display: 'block', color: 'var(--c3-gray-950)', marginTop: 2 }}
        >
          {mission.Name}
        </Text>
      </div>
      <div style={{ flexShrink: 0 }}>
        <MissionStatusBadge status={mission.Status} />
      </div>
    </div>

    {/* Detail grid */}
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 'var(--c3-space-3)',
      }}
    >
      <FieldPair label="Game" value={mission.Game || '—'} />
      <FieldPair label="Organizer" value={mission.Organizer || '—'} />
      <FieldPair label="Entity" value={mission.Entity} />
      <FieldPair label="Jurisdiction" value={mission.Jurisdiction || '—'} />
      <FieldPair
        label="Operational Window"
        value={`${formatDate(mission.Span.StartDate)} → ${formatDate(mission.Span.EndDate)}`}
      />
      <FieldPair label="Currency" value={mission.OperatingCurrency ?? '—'} />
    </div>

    {/* Notes — only when present */}
    {mission.Notes && (
      <Text
        size={200}
        style={{
          color: 'var(--c3-gray-600)',
          borderTop: '1px solid var(--c3-gray-100)',
          paddingTop: 'var(--c3-space-3)',
        }}
      >
        {mission.Notes}
      </Text>
    )}
  </div>
);

// ---------------------------------------------------------------------------
// MissionWorkspace
// ---------------------------------------------------------------------------

export const MissionWorkspace = () => {
  const { data: missions = [], isLoading, error } = useMissions();

  // Data freshness timestamp — recomputes on each React Query refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => new Date().toISOString(), [missions]);

  // ── KPI metrics ────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const total = missions.length;
    const obligationActive = missions.filter(m =>
      MISSION_OBLIGATION_ACTIVE_STATUSES.includes(m.Status),
    ).length;
    const financePending = missions.filter(m => m.Status === 'FinancePending').length;
    return { total, obligationActive, financePending };
  }, [missions]);

  // ── Loading ────────────────────────────────────────────────────────────────
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div
            style={{
              height: 28,
              width: 280,
              borderRadius: 'var(--c3-radius-md)',
              backgroundColor: 'var(--c3-gray-200)',
            }}
          />
          <div
            style={{
              height: 14,
              width: 380,
              borderRadius: 'var(--c3-radius-sm)',
              backgroundColor: 'var(--c3-gray-100)',
            }}
          />
        </div>
        <SkeletonMetricStrip />
        <SkeletonRows count={4} />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ padding: 'var(--c3-space-8)' }}>
        <EmptyState
          variant="error"
          title="Could not load missions"
          description="The mission register could not be retrieved. Check your connection or try refreshing the page."
        />
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 'var(--c3-space-8)' }}>

      {/* ── Page header ──────────────────────────────────────────────── */}
      <PageHeader
        title="Missions"
        subtitle="Operational register of mission and event commitments."
        lastUpdated={loadedAt}
      />

      {/* ── KPI strip ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'var(--c3-space-3)',
          marginBottom: 'var(--c3-space-6)',
        }}
      >
        <MetricCard
          label="Total Missions"
          value={metrics.total}
          variant="default"
        />
        <MetricCard
          label="Generating Obligations"
          value={metrics.obligationActive}
          variant={metrics.obligationActive > 0 ? 'info' : 'default'}
          context="Confirmed, Active, or Post-Mission"
        />
        <MetricCard
          label="Finance Pending"
          value={metrics.financePending}
          variant={metrics.financePending > 0 ? 'warning' : 'default'}
          context={metrics.financePending > 0 ? 'Awaiting Finance sign-off' : 'None awaiting sign-off'}
        />
      </div>

      {/* ── Mission cards — or empty state ───────────────────────────── */}
      {missions.length === 0 ? (
        <EmptyState
          variant="empty"
          title="No missions yet"
          description="Missions will appear here once mission records are created."
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            gap: 'var(--c3-space-4)',
          }}
        >
          {missions.map(mission => (
            <MissionCard key={mission.MissionID} mission={mission} />
          ))}
        </div>
      )}

    </div>
  );
};
