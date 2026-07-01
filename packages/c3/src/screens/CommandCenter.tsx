/**
 * CommandCenter — Sprint 11 (Command Center: Operational Work Queue)
 *
 * Hard replacement of the contract KPI dashboard. The Command Center now answers
 * a single question: "What work does the Operations function need to move today?"
 *
 * Previous content (contract portfolio, Renewal Radar, Lifecycle Snapshot) has been
 * removed. Those concepts belong in the Contracts and Renewals screens. The Command
 * Center's job is to translate computed operational state into an actionable queue.
 *
 * Layout:
 *   Header — queue title + total / immediate counts
 *   Priority bands — Immediate → High → Normal
 *     Each band: label + count + WorkItemCard list
 *   Empty state — shown when no items exist
 *   Loading state — skeleton matching band structure
 *
 * Navigation from WorkItemCards:
 *   CredentialAcquisition / CredentialRenewal / JourneyInitiation / ObligationRouting
 *     → PersonProfile (Readiness tab)
 *   MissionDeparturePressure
 *     → Situation Room pre-scoped to the Mission (Sprint 11)
 *
 * The queue is shared and operational — not personal. Every operator sees the
 * same items. Personal routing and acknowledgement are deferred to a future sprint.
 *
 * Ref: docs/architecture/WorkItem Model — Sprint 11 Design.md
 */

import { Text, Button } from '@fluentui/react-components';

import { EmptyState, SkeletonRows } from '@c3/components/ui';
import { WorkItemCard } from '@c3/components/shared/WorkItemCard';
import { useApp } from '@c3/hooks/useApp';
import { useWorkItems } from '@c3/hooks/useWorkItems';
import type { WorkItem } from '@c3/types';

// ---------------------------------------------------------------------------
// Priority band config
// ---------------------------------------------------------------------------

type BandConfig = {
  label: string;
  key: 'immediate' | 'high' | 'normal';
  /** Background accent for the band header. Immediate gets a subtle tint. */
  headerBg: string;
  headerColor: string;
};

const BANDS: BandConfig[] = [
  {
    label: 'Immediate',
    key: 'immediate',
    headerBg: 'var(--c3-critical-bg)',
    headerColor: 'var(--c3-critical)',
  },
  {
    label: 'High',
    key: 'high',
    headerBg: 'var(--c3-warning-bg)',
    headerColor: 'var(--c3-warning)',
  },
  {
    label: 'Normal',
    key: 'normal',
    headerBg: 'var(--c3-gray-100)',
    headerColor: 'var(--c3-gray-600)',
  },
];

// ---------------------------------------------------------------------------
// PriorityBand
// ---------------------------------------------------------------------------

interface PriorityBandProps {
  config: BandConfig;
  items: WorkItem[];
  onAction: (item: WorkItem) => void;
}

const PriorityBand = ({ config, items, onAction }: PriorityBandProps) => {
  if (items.length === 0) return null;

  return (
    <div
      style={{
        backgroundColor: 'var(--c3-white)',
        borderRadius: 'var(--c3-radius-lg)',
        boxShadow: 'var(--c3-shadow-2)',
        overflow: 'hidden',
      }}
    >
      {/* Band header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--c3-space-2)',
          padding: 'var(--c3-space-2) var(--c3-space-4)',
          backgroundColor: config.headerBg,
          borderBottom: '1px solid var(--c3-gray-100)',
        }}
      >
        <Text
          weight="semibold"
          size={200}
          style={{ color: config.headerColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}
        >
          {config.label}
        </Text>
        <Text
          size={200}
          style={{ color: config.headerColor, opacity: 0.7 }}
        >
          · {items.length} item{items.length !== 1 ? 's' : ''}
        </Text>
      </div>

      {/* WorkItemCards */}
      <div>
        {items.map((item) => (
          <WorkItemCard key={item.id} workItem={item} onAction={onAction} />
        ))}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------

const QueueSkeleton = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-4)' }}>
    {[4, 3].map((rows, i) => (
      <div
        key={i}
        style={{
          backgroundColor: 'var(--c3-white)',
          borderRadius: 'var(--c3-radius-lg)',
          boxShadow: 'var(--c3-shadow-2)',
          overflow: 'hidden',
        }}
      >
        {/* Skeleton band header */}
        <div
          style={{
            padding: 'var(--c3-space-2) var(--c3-space-4)',
            backgroundColor: 'var(--c3-gray-100)',
            borderBottom: '1px solid var(--c3-gray-100)',
            display: 'flex',
            gap: 'var(--c3-space-2)',
            alignItems: 'center',
          }}
        >
          <div
            style={{
              height: 12,
              width: 70,
              borderRadius: 'var(--c3-radius-sm)',
              backgroundColor: 'var(--c3-gray-200)',
            }}
          />
          <div
            style={{
              height: 12,
              width: 40,
              borderRadius: 'var(--c3-radius-sm)',
              backgroundColor: 'var(--c3-gray-200)',
            }}
          />
        </div>
        <div style={{ padding: 'var(--c3-space-2) var(--c3-space-4) var(--c3-space-3)' }}>
          <SkeletonRows count={rows} />
        </div>
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// CommandCenter
// ---------------------------------------------------------------------------

export const CommandCenter = () => {
  const { navigate } = useApp();
  const { items, counts, isLoading, error } = useWorkItems();

  // ── Navigation handler ───────────────────────────────────────────────────
  //
  // Each WorkItem carries links (personId, missionId) that determine the
  // resolution context. MissionDeparturePressure navigates to the Situation
  // Room pre-scoped to the mission; all other items navigate to PersonProfile.
  const handleWorkItemAction = (item: WorkItem) => {
    if (item.category === 'MissionDeparturePressure' && item.links.missionId) {
      navigate({ id: 'situation-room', missionId: item.links.missionId });
    } else if (item.links.personId) {
      navigate({ id: 'person-profile', personId: item.links.personId, tab: 'readiness' });
    }
  };

  // ── Error ─────────────────────────────────────────────────────────────────
  // Explicit error state prevents a silent false-positive "All clear" banner
  // when SP data sources fail to load (S20-P0-2).
  if (error) {
    return (
      <div style={{ padding: 'var(--c3-space-8)' }}>
        <EmptyState
          variant="error"
          title="Queue unavailable"
          description="Could not load the operations work queue. Check your connection and reload the page."
        />
      </div>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div style={{ padding: 'var(--c3-space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-6)' }}>
        {/* Header skeleton */}
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
              width: 180,
              borderRadius: 'var(--c3-radius-sm)',
              backgroundColor: 'var(--c3-gray-100)',
            }}
          />
        </div>
        <QueueSkeleton />
      </div>
    );
  }

  // ── Partition items by priority ───────────────────────────────────────────
  // Items are already sorted by generateWorkItems. Split preserves order.
  const immediateItems = items.filter((i) => i.priority === 'Immediate');
  const highItems      = items.filter((i) => i.priority === 'High');
  const normalItems    = items.filter((i) => i.priority === 'Normal');

  // ── Main view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 'var(--c3-space-8)', display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-6)' }}>

      {/* ── Header ────────────────────────────────────────────────── */}
      <div>
        <Text
          as="h1"
          weight="semibold"
          size={800}
          style={{
            color: 'var(--c3-gray-950)',
            display: 'block',
            margin: 0,
            lineHeight: '1.1',
            letterSpacing: '-0.02em',
          }}
        >
          Operations Work Queue
        </Text>
        <Text
          size={300}
          style={{ color: 'var(--c3-gray-500)', display: 'block', marginTop: 'var(--c3-space-1)' }}
        >
          {counts.total === 0
            ? 'No items requiring attention'
            : counts.immediate > 0
              ? `${counts.total} item${counts.total !== 1 ? 's' : ''} · ${counts.immediate} immediate`
              : `${counts.total} item${counts.total !== 1 ? 's' : ''} requiring attention`}
        </Text>
      </div>

      {/* ── Empty state ────────────────────────────────────────────── */}
      {counts.total === 0 && (
        <div
          style={{
            backgroundColor: 'var(--c3-white)',
            borderRadius: 'var(--c3-radius-lg)',
            boxShadow: 'var(--c3-shadow-2)',
            padding: 'var(--c3-space-8)',
          }}
        >
          <EmptyState
            variant="success"
            title="All clear"
            description="No operational work items requiring attention. All gaps are either satisfied or covered."
          />
        </div>
      )}

      {/* ── Priority bands ─────────────────────────────────────────── */}
      {counts.total > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-4)' }}>
          <PriorityBand
            config={BANDS[0]}
            items={immediateItems}
            onAction={handleWorkItemAction}
          />
          <PriorityBand
            config={BANDS[1]}
            items={highItems}
            onAction={handleWorkItemAction}
          />
          <PriorityBand
            config={BANDS[2]}
            items={normalItems}
            onAction={handleWorkItemAction}
          />
        </div>
      )}

      {/* ── Footer hint (non-empty state) ──────────────────────────── */}
      {counts.total > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--c3-space-3)' }}>
          <Text size={200} style={{ color: 'var(--c3-gray-400)' }}>
            Items computed from live operational state ·
          </Text>
          <Button
            appearance="subtle"
            size="small"
            onClick={() => navigate({ id: 'situation-room' })}
          >
            Open Situation Room
          </Button>
        </div>
      )}

    </div>
  );
};
