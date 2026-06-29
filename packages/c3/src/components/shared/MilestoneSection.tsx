/**
 * MilestoneSection — Sprint 12 (Mission Milestones: Planning Spine)
 *
 * Renders the planning milestone list for a selected mission in the Situation Room.
 * Shown below MissionContextHeader when a mission scope is active.
 *
 * Layout per milestone row:
 *   [status indicator]  [name + owner?]          [date display]  [Mark? button]
 *
 * Status indicators:
 *   Complete → filled green circle
 *   Overdue  → filled red circle
 *   DueSoon  → filled amber circle
 *   Upcoming → hollow gray circle
 *   Blocked  → hollow gray circle (same as Upcoming in v1; not highlighted)
 *
 * Date display:
 *   Complete → formatted date e.g. "14 May"
 *   Overdue  → "Nd ago" (red)
 *   DueSoon  → "In Nd" or "Today" (amber)
 *   Upcoming → "In Nd" (gray)
 *
 * Mark button:
 *   Rendered for Overdue and DueSoon only. One click; no confirmation.
 *   Button is disabled while the mutation is in flight.
 *   Cache invalidation (via useMarkMilestoneComplete) causes the milestone
 *   to reappear as Complete and removes the corresponding WorkItem from
 *   the Command Center on the next render cycle.
 *
 * Sprint 12 v1 constraints:
 *   - No create, edit, delete, or dependency management.
 *   - The only write operation is "Mark Complete".
 */

import { useState } from 'react';
import { Button, Text } from '@fluentui/react-components';

import { useMarkMilestoneComplete } from '@c3/hooks/useMarkMilestoneComplete';
import type { MissionMilestoneView, MilestoneStatus } from '@c3/types';

// ---------------------------------------------------------------------------
// Status indicator
// ---------------------------------------------------------------------------

const STATUS_INDICATOR_STYLE: Record<
  MilestoneStatus,
  { background: string; border: string }
> = {
  Complete: { background: 'var(--c3-success)',          border: 'none' },
  Overdue:  { background: 'var(--c3-critical)',         border: 'none' },
  DueSoon:  { background: 'var(--c3-warning)',          border: 'none' },
  Upcoming: { background: 'transparent',                border: '2px solid var(--c3-gray-300)' },
  Blocked:  { background: 'transparent',                border: '2px solid var(--c3-gray-300)' },
};

const StatusDot = ({ status }: { status: MilestoneStatus }) => {
  const { background, border } = STATUS_INDICATOR_STYLE[status];
  return (
    <div
      aria-label={status}
      style={{
        width: 10,
        height: 10,
        borderRadius: '50%',
        background,
        border,
        flexShrink: 0,
        marginTop: 2, // optical alignment with text baseline
      }}
    />
  );
};

// ---------------------------------------------------------------------------
// Date display helpers
// ---------------------------------------------------------------------------

const formatMilestoneDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

const DATE_COLOR: Record<MilestoneStatus, string> = {
  Complete: 'var(--c3-gray-400)',
  Overdue:  'var(--c3-critical)',
  DueSoon:  'var(--c3-warning)',
  Upcoming: 'var(--c3-gray-400)',
  Blocked:  'var(--c3-gray-400)',
};

const renderDateLabel = (m: MissionMilestoneView): string => {
  switch (m.status) {
    case 'Complete':
      return formatMilestoneDate(m.PlannedDate);
    case 'Overdue': {
      const days = Math.abs(m.daysUntilDue as number);
      return `${days}d ago`;
    }
    case 'DueSoon': {
      const days = m.daysUntilDue as number;
      return days === 0 ? 'Today' : `In ${days}d`;
    }
    case 'Upcoming':
    case 'Blocked': {
      const days = m.daysUntilDue as number;
      return `In ${days}d`;
    }
  }
};

// ---------------------------------------------------------------------------
// MilestoneRow
// ---------------------------------------------------------------------------

interface MilestoneRowProps {
  milestone: MissionMilestoneView;
  onMark: (milestoneId: string) => void;
  isMarking: boolean;
}

const MilestoneRow = ({ milestone, onMark, isMarking }: MilestoneRowProps) => {
  const isActionable = milestone.status === 'Overdue' || milestone.status === 'DueSoon';

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--c3-space-3)',
        padding: 'var(--c3-space-2) var(--c3-space-4)',
        borderBottom: '1px solid var(--c3-gray-100)',
        minHeight: 40,
      }}
    >
      {/* Status dot */}
      <StatusDot status={milestone.status} />

      {/* Name + optional owner */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <Text
          size={300}
          weight={isActionable ? 'semibold' : 'regular'}
          style={{
            display: 'block',
            color: milestone.status === 'Complete'
              ? 'var(--c3-gray-400)'
              : 'var(--c3-gray-900)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textDecoration: milestone.status === 'Complete' ? 'line-through' : 'none',
          }}
        >
          {milestone.Name}
        </Text>
        {milestone.Owner && (
          <Text
            size={200}
            style={{
              display: 'block',
              color: 'var(--c3-gray-400)',
              marginTop: 1,
            }}
          >
            {milestone.Owner}
          </Text>
        )}
      </div>

      {/* Category chip */}
      <span
        style={{
          display: 'inline-block',
          padding: '1px 6px',
          borderRadius: 'var(--c3-radius-sm)',
          backgroundColor: 'var(--c3-gray-100)',
          color: 'var(--c3-gray-500)',
          fontSize: 11,
          fontWeight: 500,
          lineHeight: '18px',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
      >
        {milestone.Category}
      </span>

      {/* Date display */}
      <Text
        size={200}
        style={{
          color: DATE_COLOR[milestone.status],
          fontWeight: isActionable ? 600 : 400,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          minWidth: 56,
          textAlign: 'right',
        }}
      >
        {renderDateLabel(milestone)}
      </Text>

      {/* Mark Complete button — actionable milestones only */}
      <div style={{ width: 64, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        {isActionable && (
          <Button
            appearance="subtle"
            size="small"
            disabled={isMarking}
            onClick={() => onMark(milestone.MilestoneID)}
          >
            {isMarking ? '...' : 'Mark'}
          </Button>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// MilestoneSection
// ---------------------------------------------------------------------------

export interface MilestoneSectionProps {
  milestones: MissionMilestoneView[];
  missionId: string;
}

export const MilestoneSection = ({ milestones, missionId }: MilestoneSectionProps) => {
  const [markingId, setMarkingId] = useState<string | null>(null);
  const mutation = useMarkMilestoneComplete();

  const handleMark = (milestoneId: string) => {
    setMarkingId(milestoneId);
    mutation.mutate(
      { milestoneId, missionId },
      { onSettled: () => setMarkingId(null) },
    );
  };

  if (milestones.length === 0) return null;

  const completeCount = milestones.filter(m => m.status === 'Complete').length;
  const overdueCount  = milestones.filter(m => m.status === 'Overdue').length;
  const dueSoonCount  = milestones.filter(m => m.status === 'DueSoon').length;

  const summaryColor =
    overdueCount > 0 ? 'var(--c3-critical)'
    : dueSoonCount > 0 ? 'var(--c3-warning)'
    : 'var(--c3-gray-500)';

  const summaryText =
    overdueCount > 0
      ? `${completeCount} of ${milestones.length} done · ${overdueCount} overdue`
      : dueSoonCount > 0
        ? `${completeCount} of ${milestones.length} done · ${dueSoonCount} due soon`
        : `${completeCount} of ${milestones.length} done`;

  return (
    <div
      style={{
        borderRadius: 'var(--c3-radius-lg)',
        border: '1px solid var(--c3-gray-200)',
        background: 'var(--c3-white)',
        overflow: 'hidden',
      }}
    >
      {/* Section header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--c3-space-3) var(--c3-space-4)',
          borderBottom: '1px solid var(--c3-gray-100)',
          background: 'var(--c3-gray-50)',
        }}
      >
        <Text weight="semibold" size={300} style={{ color: 'var(--c3-gray-700)' }}>
          Planning Milestones
        </Text>
        <Text size={200} style={{ color: summaryColor, fontWeight: 600 }}>
          {summaryText}
        </Text>
      </div>

      {/* Milestone rows */}
      {milestones.map(milestone => (
        <MilestoneRow
          key={milestone.MilestoneID}
          milestone={milestone}
          onMark={handleMark}
          isMarking={markingId === milestone.MilestoneID}
        />
      ))}
    </div>
  );
};
