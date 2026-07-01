/**
 * SituationRoom — Sprint 8 / Sprint 9 / Sprint 10 / Sprint 12 / Sprint 13
 *
 * The Situation Room answers one question: What requires operational attention right now,
 * and who is responsible for it?
 *
 * Sprint 8:  operational monitoring — surface gaps by urgency.
 * Sprint 9:  operational coordination — surface ownership state alongside gaps.
 * Sprint 10 (Phase 3): Mission scope — select a Mission to see its scoped gap view,
 *   with a mission context header and urgency relative to the mission's EndDate.
 * Sprint 11: initialMissionId prop — Mission pre-selection from Command Center navigation.
 * Sprint 12: Planning Milestones — MilestoneSection rendered below MissionContextHeader
 *   in mission mode. Milestone summary pill added to MissionContextHeader.
 * Sprint 13: Mission Finance — read-only FinanceSection rendered above MilestoneSection.
 *   Finance pill added to MissionContextHeader. Scope selector expanded to include
 *   FinancePending missions. "Approve & Confirm Mission" action bar in header for
 *   FinancePending missions — calls useApproveMission → Mission.Status: Confirmed,
 *   which activates ADR-002 operational obligations for all participants.
 *
 * Architecture:
 *   - "All Gaps" mode: useOperationalGaps() — full org, rolling urgency windows.
 *   - "Mission" mode:  useMissionGaps(missionId) — scoped to participants, horizon-aware urgency.
 *                      useMissionMilestones(missionId) — planning milestones for the mission.
 *                      useMissionFinanceLines(missionId) — finance lines (Sprint 13).
 *                      useMissionFinanceSummary(missionId) — computed summary (Sprint 13).
 *   - Existing All Gaps behaviour is fully preserved when no mission is selected.
 *   - Mission selector shows ADR-002-eligible missions + FinancePending (for plan review).
 *
 * Ref: Sprint 8 — Situation Room
 * Ref: Sprint 9 — Operational Gap Ownership
 * Ref: Sprint 10 — Mission v1: Operational Context
 * Ref: Sprint 12 — Mission Milestones: Planning Spine
 * Ref: Sprint 13 — Mission Finance: Financial Planning Spine
 * Ref: ADR-002 — Mission Activation Gate
 */

import { useState } from 'react';
import { Button, Text } from '@fluentui/react-components';

import { EmptyState, PageHeader, SkeletonBlock } from '@c3/components/ui';
import { OperationalGapRow } from '@c3/components/shared/OperationalGapRow';
import { MilestoneSection } from '@c3/components/shared/MilestoneSection';
import { FinanceSection } from '@c3/components/shared/FinanceSection';
import { useOperationalGaps } from '@c3/hooks/useOperationalGaps';
import { useMissionGaps } from '@c3/hooks/useMissionGaps';
import { useMissions } from '@c3/hooks/useMissions';
import { useMissionParticipants } from '@c3/hooks/useMissionParticipants';
import { useMissionMilestones } from '@c3/hooks/useMissionMilestones';
import { useMissionFinanceLines } from '@c3/hooks/useMissionFinanceLines';
import { useMissionFinanceSummary } from '@c3/hooks/useMissionFinanceSummary';
import { useApproveMission } from '@c3/hooks/useApproveMission';
import type {
  Mission,
  MissionFinanceSummary,
  MissionMilestoneView,
  MissionNavContext,
  MissionStatus,
  OperationalGap,
  OwnershipState,
  UrgencyTier,
} from '@c3/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GapViewFilter = 'all' | 'unrouted' | 'routed' | 'covered';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format ISO date string to "DD MMM YYYY" for display. */
const formatDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const STATUS_LABEL: Record<MissionStatus, string> = {
  Planning:       'Planning',
  FinancePending: 'Finance Pending',
  Confirmed:      'Confirmed',
  Active:         'Active',
  PostMission:    'Post-Mission',
  Settled:        'Settled',
  Canceled:       'Canceled',
};

const STATUS_COLOR: Record<MissionStatus, { bg: string; text: string }> = {
  Planning:       { bg: 'var(--c3-gray-100)',  text: 'var(--c3-gray-600)' },
  FinancePending: { bg: 'var(--c3-gray-100)',  text: 'var(--c3-gray-600)' },
  Confirmed:      { bg: '#e6f4ea',             text: '#1e7e34' },
  Active:         { bg: 'var(--c3-brand-10)',  text: 'var(--c3-brand-60)' },
  PostMission:    { bg: '#fff3cd',             text: '#856404' },
  Settled:        { bg: 'var(--c3-gray-100)',  text: 'var(--c3-gray-500)' },
  Canceled:       { bg: 'var(--c3-gray-100)',  text: 'var(--c3-gray-400)' },
};

// ---------------------------------------------------------------------------
// ScopeSelector — "All Gaps" + one chip per active mission
// ---------------------------------------------------------------------------

interface ScopeSelectorProps {
  missions: Mission[];
  selectedMissionId: string | null;
  onSelect: (id: string | null) => void;
}

const ScopeSelector = ({ missions, selectedMissionId, onSelect }: ScopeSelectorProps) => {
  const chips: Array<{ id: string | null; label: string }> = [
    { id: null, label: 'All Gaps' },
    ...missions.map(m => ({ id: m.MissionID, label: m.MissionID })),
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--c3-space-2)',
        flexWrap: 'wrap',
        alignItems: 'center',
      }}
    >
      <Text size={200} style={{ color: 'var(--c3-gray-500)', marginRight: 'var(--c3-space-1)' }}>
        Scope
      </Text>
      {chips.map(chip => {
        const active = selectedMissionId === chip.id;
        return (
          <button
            key={String(chip.id)}
            onClick={() => onSelect(chip.id)}
            style={{
              padding: '4px 14px',
              borderRadius: 'var(--c3-radius-md)',
              border: active ? '1px solid var(--c3-brand-60)' : '1px solid var(--c3-gray-200)',
              background: active ? 'var(--c3-brand-10)' : 'var(--c3-white)',
              color: active ? 'var(--c3-brand-60)' : 'var(--c3-gray-600)',
              fontWeight: active ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all var(--c3-motion-fast) ease',
              whiteSpace: 'nowrap',
            }}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// MissionContextHeader — shown when a mission scope is active
// ---------------------------------------------------------------------------

interface MilestoneSummary {
  total: number;
  overdue: number;
  dueSoon: number;
}

interface MissionContextHeaderProps {
  mission: Mission;
  participantCount: number;
  /**
   * Milestone summary pill. Shown in the metadata strip when milestones
   * are available for the selected mission. Sprint 12.
   */
  milestoneSummary?: MilestoneSummary;
  /**
   * Finance summary for the finance net pill. Shown when finance lines
   * exist for the selected mission. Sprint 13.
   */
  financeSummary?: MissionFinanceSummary;
  /**
   * ISO 4217 currency code (e.g. 'USD', 'SAR') for the finance pill.
   * Required when financeSummary is provided. Sprint 13.
   */
  financeCurrency?: string;
  /**
   * Approve & Confirm callback. When provided, an action bar is rendered
   * at the bottom of the header card. Only passed for FinancePending missions.
   * Sprint 13 (S13-4).
   */
  onApprove?: () => void;
  /**
   * True while the approval mutation is in flight. Disables the button
   * and shows "Confirming…" label. Sprint 13 (S13-4).
   */
  isApproving?: boolean;
}

const MissionContextHeader = ({
  mission,
  participantCount,
  milestoneSummary,
  financeSummary,
  financeCurrency,
  onApprove,
  isApproving = false,
}: MissionContextHeaderProps) => {
  const { bg, text } = STATUS_COLOR[mission.Status];

  // Milestone pill style
  const milestonePillStyle =
    milestoneSummary && milestoneSummary.overdue > 0
      ? { bg: 'var(--c3-critical-bg)', text: 'var(--c3-critical)' }
      : milestoneSummary && milestoneSummary.dueSoon > 0
        ? { bg: 'var(--c3-warning-bg)', text: 'var(--c3-warning)' }
        : { bg: 'var(--c3-gray-100)', text: 'var(--c3-gray-600)' };

  const milestonePillLabel =
    milestoneSummary && milestoneSummary.overdue > 0
      ? `${milestoneSummary.total} milestones · ${milestoneSummary.overdue} overdue`
      : milestoneSummary && milestoneSummary.dueSoon > 0
        ? `${milestoneSummary.total} milestones · ${milestoneSummary.dueSoon} due soon`
        : milestoneSummary
          ? `${milestoneSummary.total} milestones`
          : null;

  // Finance pill — Sprint 13
  const showFinancePill = Boolean(financeSummary && financeCurrency);
  const financeNet = financeSummary?.plannedNet ?? 0;
  const financePillStyle = !showFinancePill
    ? { bg: '', text: '' }
    : financeNet > 0
      ? { bg: '#e6f4ea', text: '#1e7e34' }
      : financeNet < 0
        ? { bg: 'var(--c3-critical-bg)', text: 'var(--c3-critical)' }
        : { bg: 'var(--c3-gray-100)', text: 'var(--c3-gray-600)' };

  const financePillLabel: string | null =
    showFinancePill && financeCurrency
      ? `Net ${financeNet >= 0 ? '+' : '−'}${new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: financeCurrency,
          maximumFractionDigits: 0,
        }).format(Math.abs(financeNet))}`
      : null;

  return (
    <div
      style={{
        borderRadius: 'var(--c3-radius-lg)',
        border: '1px solid var(--c3-gray-200)',
        background: 'var(--c3-white)',
        overflow: 'hidden',
      }}
    >
      {/* ── Main metadata row ────────────────────────────────────────────── */}
      <div
        style={{
          padding: 'var(--c3-space-4) var(--c3-space-5)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--c3-space-5)',
          flexWrap: 'wrap',
        }}
      >
        {/* Mission name + ID */}
        <div style={{ flex: '1 1 240px', minWidth: 0 }}>
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
            {mission.Name}
          </Text>
          <Text size={200} style={{ display: 'block', color: 'var(--c3-gray-500)', marginTop: 2 }}>
            {mission.MissionID} · {mission.Game} · {mission.Jurisdiction}
          </Text>
        </div>

        {/* Metadata pills */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--c3-space-4)',
            flexShrink: 0,
            flexWrap: 'wrap',
          }}
        >
          {/* Status badge */}
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: '3px 10px',
              borderRadius: 'var(--c3-radius-sm)',
              background: bg,
              color: text,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {STATUS_LABEL[mission.Status]}
          </span>

          {/* Date range */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <Text size={200} weight="semibold" style={{ color: 'var(--c3-gray-700)' }}>
              {formatDate(mission.Span.StartDate)} – {formatDate(mission.Span.EndDate)}
            </Text>
            <Text size={200} style={{ color: 'var(--c3-gray-400)', marginTop: 1 }}>
              Operational window
            </Text>
          </div>

          {/* Divider */}
          <div style={{ width: 1, height: 32, background: 'var(--c3-gray-200)', flexShrink: 0 }} />

          {/* Participant count */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <Text size={200} weight="semibold" style={{ color: 'var(--c3-gray-700)' }}>
              {participantCount}
            </Text>
            <Text size={200} style={{ color: 'var(--c3-gray-400)', marginTop: 1 }}>
              {participantCount === 1 ? 'participant' : 'participants'}
            </Text>
          </div>

          {/* Milestone summary pill — Sprint 12 */}
          {milestonePillLabel && (
            <>
              <div style={{ width: 1, height: 32, background: 'var(--c3-gray-200)', flexShrink: 0 }} />
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 10px',
                  borderRadius: 'var(--c3-radius-sm)',
                  background: milestonePillStyle.bg,
                  color: milestonePillStyle.text,
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {milestonePillLabel}
              </span>
            </>
          )}

          {/* Finance net pill — Sprint 13 */}
          {financePillLabel && (
            <>
              <div style={{ width: 1, height: 32, background: 'var(--c3-gray-200)', flexShrink: 0 }} />
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '3px 10px',
                  borderRadius: 'var(--c3-radius-sm)',
                  background: financePillStyle.bg,
                  color: financePillStyle.text,
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {financePillLabel}
              </span>
            </>
          )}
        </div>
      </div>

      {/* ── Approve & Confirm action bar — Sprint 13 (S13-4) ─────────────── */}
      {/* Rendered only for FinancePending missions (when onApprove is provided). */}
      {/* Approving transitions Mission.Status → Confirmed, which activates        */}
      {/* ADR-002 operational obligations for all mission participants.             */}
      {onApprove && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--c3-space-3) var(--c3-space-5)',
            borderTop: '1px solid var(--c3-gray-100)',
            background: 'var(--c3-gray-50)',
            gap: 'var(--c3-space-4)',
            flexWrap: 'wrap',
          }}
        >
          <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
            Approving confirms the financial plan and activates operational obligations for all participants.
          </Text>
          <Button
            appearance="primary"
            size="small"
            disabled={isApproving}
            onClick={onApprove}
            style={{ whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {isApproving ? 'Confirming…' : 'Approve & Confirm Mission'}
          </Button>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// SummaryStrip
// ---------------------------------------------------------------------------

interface SummaryStripProps {
  critical: number;
  high: number;
  medium: number;
}

const SummaryStrip = ({ critical, high, medium }: SummaryStripProps) => {
  const items: { label: string; count: number; color: string }[] = [
    { label: 'Critical', count: critical, color: 'var(--c3-critical)' },
    { label: 'High',     count: high,     color: 'var(--c3-warning)' },
    { label: 'Medium',   count: medium,   color: 'var(--c3-gray-500)' },
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: 'var(--c3-space-6)',
        padding: 'var(--c3-space-4) var(--c3-space-5)',
        borderRadius: 'var(--c3-radius-lg)',
        border: '1px solid var(--c3-gray-200)',
        background: 'var(--c3-white)',
        alignItems: 'center',
      }}
    >
      {items.map((item, i) => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 'var(--c3-space-3)' }}>
          {i > 0 && (
            <div style={{ width: 1, height: 28, backgroundColor: 'var(--c3-gray-200)' }} />
          )}
          <div>
            <Text
              weight="semibold"
              style={{
                fontSize: 22,
                lineHeight: 1,
                color: item.color,
                display: 'block',
              }}
            >
              {item.count}
            </Text>
            <Text
              size={200}
              style={{
                color: 'var(--c3-gray-500)',
                display: 'block',
                marginTop: 2,
              }}
            >
              {item.label}
            </Text>
          </div>
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  value: GapViewFilter;
  onChange: (v: GapViewFilter) => void;
  counts: Record<GapViewFilter, number>;
}

const FilterBar = ({ value, onChange, counts }: FilterBarProps) => {
  const options: { id: GapViewFilter; label: string }[] = [
    { id: 'all',      label: 'All gaps' },
    { id: 'unrouted', label: 'Unrouted' },
    { id: 'routed',   label: 'Routed' },
    { id: 'covered',  label: 'Covered' },
  ];

  return (
    <div style={{ display: 'flex', gap: 'var(--c3-space-1)' }}>
      {options.map(opt => {
        const active = value === opt.id;
        const count = counts[opt.id];
        return (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            style={{
              padding: '5px 14px',
              borderRadius: 'var(--c3-radius-md)',
              border: active ? '1px solid var(--c3-brand-60)' : '1px solid var(--c3-gray-200)',
              background: active ? 'var(--c3-brand-10)' : 'var(--c3-white)',
              color: active ? 'var(--c3-brand-60)' : 'var(--c3-gray-600)',
              fontWeight: active ? 600 : 400,
              fontSize: 13,
              cursor: 'pointer',
              fontFamily: 'inherit',
              transition: 'all var(--c3-motion-fast) ease',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {opt.label}
            {opt.id !== 'all' && count > 0 && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: active ? 'var(--c3-brand-60)' : 'var(--c3-gray-200)',
                  color: active ? 'var(--c3-white)' : 'var(--c3-gray-600)',
                  fontSize: 11,
                  fontWeight: 600,
                  lineHeight: 1,
                }}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Severity band
// ---------------------------------------------------------------------------

const BAND_COLORS: Record<UrgencyTier, string> = {
  Critical: 'var(--c3-critical)',
  High:     'var(--c3-warning)',
  Medium:   'var(--c3-gray-500)',
};

interface BandProps {
  tier: UrgencyTier;
  gaps: OperationalGap[];
  onNavigate: (personId: string) => void;
}

const Band = ({ tier, gaps, onNavigate }: BandProps) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-2)' }}>
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--c3-space-2)',
        padding: '2px 0',
      }}
    >
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: BAND_COLORS[tier],
          flexShrink: 0,
        }}
      />
      <Text
        size={200}
        weight="semibold"
        style={{
          color: BAND_COLORS[tier],
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        {tier}
      </Text>
      <Text size={200} style={{ color: 'var(--c3-gray-400)' }}>
        {gaps.length} gap{gaps.length !== 1 ? 's' : ''}
      </Text>
    </div>
    {gaps.map(gap => (
      <OperationalGapRow
        key={`${gap.personId}-${gap.obligationId}`}
        gap={gap}
        onNavigate={onNavigate}
      />
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Empty state descriptions
// ---------------------------------------------------------------------------

const ALL_EMPTY_DESCRIPTIONS: Record<GapViewFilter, string> = {
  all:      'No operational gaps detected. All obligations are satisfied across the organisation.',
  unrouted: 'No unrouted gaps. Every gap has an active Journey.',
  routed:   'No routed gaps. Gaps are either unrouted or explicitly covered.',
  covered:  'No gaps are explicitly covered yet. Start a Journey and assign obligations to cover a gap.',
};

const missionEmptyDescription = (filter: GapViewFilter, missionName: string): string => {
  if (filter === 'all') {
    return `No obligation gaps detected for ${missionName}. All participants hold the required credentials for this mission's dates.`;
  }
  return ALL_EMPTY_DESCRIPTIONS[filter];
};

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const SUBTITLE =
  'Operational gaps requiring attention. Continuously computed from credential evaluations across the organisation.';

// ADR-002 eligible statuses for the Mission selector, plus FinancePending so operators
// can review (and approve) the financial plan before the mission is confirmed. Sprint 13.
const SELECTOR_STATUSES: MissionStatus[] = ['FinancePending', 'Confirmed', 'Active', 'PostMission'];

interface SituationRoomProps {
  onNavigateToPerson?: (personId: string, missionContext?: MissionNavContext) => void;
  /**
   * Pre-select a mission scope on mount.
   * Sourced from C3Screen['situation-room'].missionId (Sprint 11).
   */
  initialMissionId?: string;
}

export const SituationRoom = ({ onNavigateToPerson, initialMissionId }: SituationRoomProps) => {
  const [selectedMissionId, setSelectedMissionId] = useState<string | null>(initialMissionId ?? null);
  const [viewFilter, setViewFilter] = useState<GapViewFilter>('all');

  // ── Data ─────────────────────────────────────────────────────────────────

  // Active missions for the scope selector (ADR-002 eligible + FinancePending)
  const { data: activeMissions = [] } = useMissions({ status: SELECTOR_STATUSES });

  // All-org gaps (always computed; powers All Gaps mode)
  const { gaps: allGaps, isLoading: allGapsLoading } = useOperationalGaps();

  // Mission-scoped gaps (suppressed when no mission selected via empty-string gate)
  const {
    gaps: missionGaps,
    mission: selectedMission,
    isLoading: missionGapsLoading,
  } = useMissionGaps(selectedMissionId ?? '');

  // Mission milestones — Sprint 12 (suppressed when no mission selected)
  const { milestones, isLoading: milestonesLoading } = useMissionMilestones(
    selectedMissionId ?? '',
  );

  // Mission finance — Sprint 13 (suppressed when no mission selected)
  const { lines: financeLines, isLoading: financeLinesLoading } = useMissionFinanceLines(
    selectedMissionId ?? '',
  );
  const { summary: financeSummary } = useMissionFinanceSummary(selectedMissionId ?? '');

  // Approve & Confirm mutation — Sprint 13 (S13-4)
  // Only fires when the operator clicks the action bar button on a FinancePending mission.
  const { mutate: approveMission, isPending: isApprovingMission } = useApproveMission();

  // Participant count for the mission header: sourced from MissionParticipant records.
  // S14-2: uses useMissionParticipants (replaces Mission.ParticipantPersonIDs which
  // was removed). The hook shares the TanStack Query cache key with useMissionGaps,
  // so no additional network call is made when useMissionGaps has already fetched.
  // fix(s24-p1): moved before loading guard to satisfy Rules of Hooks (SP async path).
  const { data: selectedMissionParticipants } = useMissionParticipants(
    selectedMission?.MissionID ?? '',
  );
  const missionParticipantCount = selectedMissionParticipants.length;

  // ── Active data source ────────────────────────────────────────────────────
  const isMissionMode = selectedMissionId !== null;
  const gaps = isMissionMode ? missionGaps : allGaps;
  const isLoading = isMissionMode
    ? missionGapsLoading || milestonesLoading || financeLinesLoading
    : allGapsLoading;

  // Reset ownership filter when switching scope
  const handleScopeChange = (id: string | null) => {
    setSelectedMissionId(id);
    setViewFilter('all');
  };

  // ── Milestone summary for MissionContextHeader ────────────────────────────
  const milestoneSummary: MilestoneSummary | undefined =
    isMissionMode && milestones.length > 0
      ? {
          total:   milestones.length,
          overdue: milestones.filter((m: MissionMilestoneView) => m.status === 'Overdue').length,
          dueSoon: milestones.filter((m: MissionMilestoneView) => m.status === 'DueSoon').length,
        }
      : undefined;

  // ── Loading ───────────────────────────────────────────────────────────────
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
        <PageHeader title="Situation Room" subtitle={SUBTITLE} />
        {activeMissions.length > 0 && (
          <ScopeSelector
            missions={activeMissions}
            selectedMissionId={selectedMissionId}
            onSelect={handleScopeChange}
          />
        )}
        <SkeletonBlock height="72px" />
        <SkeletonBlock height="56px" />
        <SkeletonBlock height="48px" />
        <SkeletonBlock height="48px" />
        <SkeletonBlock height="48px" />
      </div>
    );
  }

  // ── Counts ────────────────────────────────────────────────────────────────
  const critical = gaps.filter(g => g.urgencyTier === 'Critical').length;
  const high     = gaps.filter(g => g.urgencyTier === 'High').length;
  const medium   = gaps.filter(g => g.urgencyTier === 'Medium').length;

  const filterCounts: Record<GapViewFilter, number> = {
    all:      gaps.length,
    unrouted: gaps.filter(g => g.ownershipState === 'Unrouted').length,
    routed:   gaps.filter(g => g.ownershipState === 'Routed').length,
    covered:  gaps.filter(g => g.ownershipState === 'Covered').length,
  };

  // ── Ownership filter ──────────────────────────────────────────────────────
  const ownershipFilter: Record<GapViewFilter, OwnershipState | null> = {
    all:      null,
    unrouted: 'Unrouted',
    routed:   'Routed',
    covered:  'Covered',
  };

  const filteredGaps =
    ownershipFilter[viewFilter] !== null
      ? gaps.filter(g => g.ownershipState === ownershipFilter[viewFilter])
      : gaps;

  const criticalGaps = filteredGaps.filter(g => g.urgencyTier === 'Critical');
  const highGaps     = filteredGaps.filter(g => g.urgencyTier === 'High');
  const mediumGaps   = filteredGaps.filter(g => g.urgencyTier === 'Medium');

  const handleNavigate = (personId: string) => {
    const missionCtx: MissionNavContext | undefined =
      isMissionMode && selectedMission
        ? { missionId: selectedMission.MissionID, missionName: selectedMission.Name }
        : undefined;
    onNavigateToPerson?.(personId, missionCtx);
  };

  // ── Empty state copy ──────────────────────────────────────────────────────
  const emptyAllCopy = isMissionMode && selectedMission
    ? missionEmptyDescription('all', selectedMission.Name)
    : ALL_EMPTY_DESCRIPTIONS.all;
  const emptyFilterCopy = isMissionMode && selectedMission
    ? missionEmptyDescription(viewFilter, selectedMission.Name)
    : ALL_EMPTY_DESCRIPTIONS[viewFilter];

  return (
    <div
      style={{
        padding: 'var(--c3-space-8)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--c3-space-5)',
      }}
    >
      <PageHeader title="Situation Room" subtitle={SUBTITLE} />

      {/* ── Scope selector — only rendered when active missions exist ───────── */}
      {activeMissions.length > 0 && (
        <ScopeSelector
          missions={activeMissions}
          selectedMissionId={selectedMissionId}
          onSelect={handleScopeChange}
        />
      )}

      {/* ── Mission context header — only in mission mode ────────────────────── */}
      {isMissionMode && selectedMission && (
        <MissionContextHeader
          mission={selectedMission}
          participantCount={missionParticipantCount}
          milestoneSummary={milestoneSummary}
          financeSummary={financeLines.length > 0 ? financeSummary : undefined}
          financeCurrency={financeLines.length > 0 ? (selectedMission.OperatingCurrency ?? 'USD') : undefined}
          onApprove={
            selectedMission.Status === 'FinancePending'
              ? () => { approveMission({ missionId: selectedMission.MissionID }); }
              : undefined
          }
          isApproving={isApprovingMission}
        />
      )}

      {/* ── Finance section — Sprint 13, mission mode only ────────────────────── */}
      {isMissionMode && selectedMissionId && financeLines.length > 0 && (
        <FinanceSection
          lines={financeLines}
          summary={financeSummary}
          currency={selectedMission?.OperatingCurrency ?? 'USD'}
        />
      )}

      {/* ── Planning milestones — Sprint 12, mission mode only ───────────────── */}
      {isMissionMode && selectedMissionId && milestones.length > 0 && (
        <MilestoneSection
          milestones={milestones}
          missionId={selectedMissionId}
        />
      )}

      {/* ── Gap list ──────────────────────────────────────────────────────────── */}
      {gaps.length === 0 ? (
        <EmptyState
          variant="empty"
          title="All clear"
          description={emptyAllCopy}
        />
      ) : (
        <>
          <SummaryStrip critical={critical} high={high} medium={medium} />

          <FilterBar value={viewFilter} onChange={setViewFilter} counts={filterCounts} />

          {filteredGaps.length === 0 ? (
            <EmptyState
              variant="empty"
              title="No gaps in this view"
              description={emptyFilterCopy}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--c3-space-5)' }}>
              {criticalGaps.length > 0 && <Band tier="Critical" gaps={criticalGaps} onNavigate={handleNavigate} />}
              {highGaps.length > 0     && <Band tier="High"     gaps={highGaps}     onNavigate={handleNavigate} />}
              {mediumGaps.length > 0   && <Band tier="Medium"   gaps={mediumGaps}   onNavigate={handleNavigate} />}
            </div>
          )}
        </>
      )}
    </div>
  );
};
