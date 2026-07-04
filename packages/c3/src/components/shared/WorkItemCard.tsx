/**
 * WorkItemCard — Sprint 11 (Command Center: Operational Work Queue)
 *
 * Renders a single WorkItem as a list row inside a priority band.
 *
 * Layout:
 *   [priority dot]  [title · semibold]             [action button →]
 *                   [detail · muted]
 *                   [owner badge]  [mission chip?]  [due date chip?]
 *
 * Priority dot colour:
 *   Immediate → critical red    (var(--c3-critical))
 *   High      → warning amber   (var(--c3-warning))
 *   Normal    → gray            (var(--c3-gray-400))
 *
 * Owner badge colour by OwnerSource:
 *   ObligationAssignment → success green  (explicit, committed)
 *   JourneyOwner         → warning amber  (derived, in-progress journey)
 *   ProtocolDefault      → gray           (suggested by protocol)
 *   Unrouted             → critical red   (needs routing — highest urgency signal)
 *
 * Action button label by category:
 *   CredentialRenewal / CredentialAcquisition → "Open Profile"
 *   JourneyInitiation                         → "Start Journey"
 *   ObligationRouting                         → "Assign Owner"
 *   MissionDeparturePressure / MilestoneAlert → "View Mission"
 */

import { Button, Text } from '@fluentui/react-components';
import type { WorkItem, WorkItemPriority, OwnerSource, WorkItemCategory } from '@c3/types';

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const PRIORITY_DOT_COLOUR: Record<WorkItemPriority, string> = {
  Immediate: 'var(--c3-critical)',
  High:      'var(--c3-warning)',
  Normal:    'var(--c3-gray-400)',
};

const PriorityDot = ({ priority }: { priority: WorkItemPriority }) => (
  <div
    aria-label={priority}
    style={{
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: PRIORITY_DOT_COLOUR[priority],
      flexShrink: 0,
      marginTop: 6, // align with first line of title text
    }}
  />
);

// ---------------------------------------------------------------------------

interface BadgeStyle { bg: string; color: string }

const OWNER_BADGE_STYLE: Record<OwnerSource, BadgeStyle> = {
  ObligationAssignment: { bg: 'var(--c3-success-bg)',  color: 'var(--c3-success)'  },
  JourneyOwner:         { bg: 'var(--c3-warning-bg)',  color: 'var(--c3-warning)'  },
  ProtocolDefault:      { bg: 'var(--c3-gray-100)',    color: 'var(--c3-gray-600)' },
  Unrouted:             { bg: 'var(--c3-critical-bg)', color: 'var(--c3-critical)' },
};

const OwnerBadge = ({
  owner,
  ownerSource,
}: {
  owner: string | undefined;
  ownerSource: OwnerSource;
}) => {
  const { bg, color } = OWNER_BADGE_STYLE[ownerSource];
  const label = ownerSource === 'Unrouted' ? 'Unrouted' : (owner ?? ownerSource);

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '1px 6px',
        borderRadius: 'var(--c3-radius-sm)',
        backgroundColor: bg,
        color,
        fontSize: 11,
        fontWeight: 500,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      }}
    >
      {ownerSource === 'Unrouted' && (
        <span
          style={{
            display: 'inline-block',
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: 'var(--c3-critical)',
            flexShrink: 0,
          }}
        />
      )}
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------

const MissionChip = ({ name }: { name: string }) => (
  <span
    style={{
      display: 'inline-block',
      padding: '1px 6px',
      borderRadius: 'var(--c3-radius-sm)',
      backgroundColor: 'var(--c3-brand-10)',
      color: 'var(--c3-brand-70)',
      fontSize: 11,
      fontWeight: 500,
      lineHeight: '18px',
      whiteSpace: 'nowrap',
      maxWidth: 180,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}
  >
    {name}
  </span>
);

// ---------------------------------------------------------------------------

const DueDateChip = ({ dueDate }: { dueDate: string }) => {
  const today = new Date(new Date().toISOString().split('T')[0] + 'T00:00:00Z');
  const due   = new Date(dueDate.split('T')[0] + 'T00:00:00Z');
  const days  = Math.floor((due.getTime() - today.getTime()) / (86_400 * 1_000));
  const label = days <= 0 ? 'Due today' : days === 1 ? 'Due tomorrow' : `Due in ${days}d`;
  const isUrgent = days <= 7;

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 'var(--c3-radius-sm)',
        backgroundColor: isUrgent ? 'var(--c3-critical-bg)' : 'var(--c3-gray-100)',
        color: isUrgent ? 'var(--c3-critical)' : 'var(--c3-gray-600)',
        fontSize: 11,
        fontWeight: 500,
        lineHeight: '18px',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Action button labels
// ---------------------------------------------------------------------------

const ACTION_LABEL: Record<WorkItemCategory, string> = {
  CredentialRenewal:        'Open Profile',
  CredentialAcquisition:    'Open Profile',
  JourneyInitiation:        'Start Journey',
  ObligationRouting:        'Assign Owner',
  MissionDeparturePressure: 'View Mission',
  MilestoneAlert:           'View Mission',
  MissionReadinessGap:      'Assign Participants',
};

// ---------------------------------------------------------------------------
// WorkItemCard
// ---------------------------------------------------------------------------

export interface WorkItemCardProps {
  workItem: WorkItem;
  onAction: (item: WorkItem) => void;
}

export const WorkItemCard = ({ workItem, onAction }: WorkItemCardProps) => {
  const { title, detail, owner, ownerSource, blockingMission, dueDate, priority, category } =
    workItem;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 'var(--c3-space-3)',
        padding: 'var(--c3-space-3) var(--c3-space-4)',
        borderBottom: '1px solid var(--c3-gray-100)',
        transition: `background-color var(--c3-motion-fast)`,
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = 'var(--c3-gray-50)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent';
      }}
    >
      {/* Priority dot */}
      <PriorityDot priority={priority} />

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Title */}
        <Text
          weight="semibold"
          size={300}
          style={{
            display: 'block',
            color: 'var(--c3-gray-950)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </Text>

        {/* Detail */}
        {detail && (
          <Text
            size={200}
            style={{
              display: 'block',
              color: 'var(--c3-gray-500)',
              marginTop: 2,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {detail}
          </Text>
        )}

        {/* Meta row: owner badge, mission chip, due date */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--c3-space-1)',
            flexWrap: 'wrap',
            marginTop: 'var(--c3-space-1)',
          }}
        >
          <OwnerBadge owner={owner} ownerSource={ownerSource} />
          {blockingMission && <MissionChip name={blockingMission} />}
          {dueDate && <DueDateChip dueDate={dueDate} />}
        </div>
      </div>

      {/* Action button */}
      <div style={{ flexShrink: 0, alignSelf: 'center' }}>
        <Button
          appearance="subtle"
          size="small"
          onClick={() => onAction(workItem)}
        >
          {ACTION_LABEL[category]}
        </Button>
      </div>
    </div>
  );
};
