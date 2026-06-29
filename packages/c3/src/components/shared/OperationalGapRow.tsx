/**
 * OperationalGapRow — Situation Room row component.
 *
 * Renders a single OperationalGap as a structured row with three columns:
 *   1. Person — name, role, team
 *   2. Gap — obligation requirement + blockingReason (first-class explanation)
 *   3. Status — urgency tier, days chip, and ownership state badge
 *
 * Ownership state badge (Sprint 9 three-state model):
 *   Unrouted — no Journey; gap needs routing. Shows suggested owner.
 *   Routed   — Journey exists with assignedTo; coverage not yet explicit.
 *   Covered  — Journey explicitly owns this obligation. (Phase 3)
 *
 * Sprint 9: row is now clickable via optional onNavigate prop (S9-4).
 *
 * Layer: shared (domain-aware: knows OperationalGap, UrgencyTier, OwnershipState)
 */

import { Text } from '@fluentui/react-components';
import type { OperationalGap, OwnershipState, UrgencyTier } from '@c3/types';

// ---------------------------------------------------------------------------
// Urgency accent colors
// ---------------------------------------------------------------------------

const URGENCY_BORDER: Record<UrgencyTier, string> = {
  Critical: 'var(--c3-critical)',
  High:     'var(--c3-warning)',
  Medium:   'var(--c3-gray-400)',
};

const URGENCY_LABEL: Record<UrgencyTier, string> = {
  Critical: 'Critical',
  High:     'High',
  Medium:   'Medium',
};

const URGENCY_COLOR: Record<UrgencyTier, string> = {
  Critical: 'var(--c3-critical)',
  High:     'var(--c3-warning)',
  Medium:   'var(--c3-gray-500)',
};

// ---------------------------------------------------------------------------
// Ownership badge (three-state)
// ---------------------------------------------------------------------------

const OWNERSHIP_DOT_COLOR: Record<OwnershipState, string> = {
  Unrouted: 'var(--c3-gray-400)',
  Routed:   'var(--c3-warning)',
  Covered:  'var(--c3-success)',
};

const OWNERSHIP_LABEL: Record<OwnershipState, string> = {
  Unrouted: 'Unrouted',
  Routed:   'Routed',
  Covered:  'Covered',
};

const OWNERSHIP_TEXT_COLOR: Record<OwnershipState, string> = {
  Unrouted: 'var(--c3-gray-500)',
  Routed:   'var(--c3-warning)',
  Covered:  'var(--c3-success)',
};

interface OwnershipBadgeProps {
  gap: OperationalGap;
}

const OwnershipBadge = ({ gap }: OwnershipBadgeProps) => {
  const { ownershipState, assignedTo, defaultOwner } = gap;

  // Secondary line: who has it (or who should)
  const ownerText =
    ownershipState === 'Covered' ? assignedTo :
    ownershipState === 'Routed'  ? assignedTo :
    `Suggested: ${defaultOwner}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      {/* State label + dot */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-1)' }}>
        <span
          style={{
            display: 'inline-block',
            width: 7,
            height: 7,
            borderRadius: '50%',
            backgroundColor: OWNERSHIP_DOT_COLOR[ownershipState],
            flexShrink: 0,
            marginTop: 1,
          }}
        />
        <Text
          size={200}
          weight="semibold"
          style={{ color: OWNERSHIP_TEXT_COLOR[ownershipState] }}
        >
          {OWNERSHIP_LABEL[ownershipState]}
        </Text>
      </div>
      {/* Owner or suggestion */}
      {ownerText && (
        <Text size={200} style={{ color: 'var(--c3-gray-500)', textAlign: 'right' }}>
          {ownerText}
        </Text>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// DaysChip — compact "11d" or "Expired" indicator for AtRisk rows
// ---------------------------------------------------------------------------

const DaysChip = ({ days }: { days: number | null }) => {
  if (days === null) return null;
  const label = days < 0 ? 'Expired' : `${days}d`;
  const color = days < 0 ? 'var(--c3-critical)' : days <= 30 ? 'var(--c3-warning)' : 'var(--c3-gray-500)';

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 6px',
        borderRadius: 'var(--c3-radius-sm)',
        border: `1px solid ${color}`,
        color,
        fontSize: 11,
        fontWeight: 600,
        lineHeight: '18px',
        letterSpacing: '0.01em',
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// OperationalGapRow
// ---------------------------------------------------------------------------

export interface OperationalGapRowProps {
  gap: OperationalGap;
  /** Sprint 9 S9-4: navigate to this gap's person when provided. */
  onNavigate?: (personId: string) => void;
}

export const OperationalGapRow = ({ gap, onNavigate }: OperationalGapRowProps) => {
  const personContext = [gap.personId, gap.personRole].filter(Boolean).join(' · ');
  const isClickable = Boolean(onNavigate);

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? () => onNavigate!(gap.personId) : undefined}
      onKeyDown={
        isClickable
          ? e => { if (e.key === 'Enter' || e.key === ' ') onNavigate!(gap.personId); }
          : undefined
      }
      style={{
        display: 'grid',
        gridTemplateColumns: '200px 1fr 220px',
        alignItems: 'start',
        gap: 'var(--c3-space-4)',
        padding: 'var(--c3-space-3) var(--c3-space-4)',
        borderRadius: 'var(--c3-radius-md)',
        border: '1px solid var(--c3-gray-200)',
        borderLeft: `3px solid ${URGENCY_BORDER[gap.urgencyTier]}`,
        background: 'var(--c3-white)',
        cursor: isClickable ? 'pointer' : 'default',
        transition: isClickable ? 'background var(--c3-motion-fast) ease' : undefined,
      }}
      onMouseEnter={isClickable ? e => {
        (e.currentTarget as HTMLElement).style.background = 'var(--c3-gray-50)';
      } : undefined}
      onMouseLeave={isClickable ? e => {
        (e.currentTarget as HTMLElement).style.background = 'var(--c3-white)';
      } : undefined}
    >
      {/* ── Column 1: Person ──────────────────────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <Text
          weight="semibold"
          style={{
            display: 'block',
            color: 'var(--c3-gray-950)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {gap.personName}
        </Text>
        {personContext && (
          <Text
            size={200}
            style={{
              display: 'block',
              color: 'var(--c3-gray-500)',
              marginTop: 'var(--c3-space-1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {personContext}
          </Text>
        )}
      </div>

      {/* ── Column 2: Gap ─────────────────────────────────────────────────── */}
      <div style={{ minWidth: 0 }}>
        <Text
          weight="semibold"
          style={{
            display: 'block',
            color: 'var(--c3-gray-950)',
          }}
        >
          {gap.requirement}
        </Text>
        <Text
          size={300}
          style={{
            display: 'block',
            color: 'var(--c3-gray-600)',
            marginTop: 'var(--c3-space-1)',
          }}
        >
          {gap.blockingReason}
        </Text>
      </div>

      {/* ── Column 3: Urgency + Ownership ─────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--c3-space-2)',
          alignItems: 'flex-end',
        }}
      >
        {/* Urgency tier + days chip */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-2)' }}>
          <Text
            size={200}
            weight="semibold"
            style={{ color: URGENCY_COLOR[gap.urgencyTier] }}
          >
            {URGENCY_LABEL[gap.urgencyTier]}
          </Text>
          <DaysChip days={gap.daysToExpiry} />
        </div>

        {/* Ownership badge */}
        <OwnershipBadge gap={gap} />
      </div>
    </div>
  );
};
