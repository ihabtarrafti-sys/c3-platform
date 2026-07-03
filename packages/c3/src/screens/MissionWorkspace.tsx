/**
 * MissionWorkspace — C3 Design System v1.0
 *
 * Sprint 26 (S26-3) — Mission/Event Read Foundation.
 * Sprint 27 (S27-4) — Participant visibility: each card shows its participant
 *   count and expands to a read-only assignment list (name, PersonID, role,
 *   external code, per diem in the mission's operating currency).
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
 *   Mission cards grid — one card per mission, expandable participant list
 *
 * Design constraints:
 *   - Strictly read-only: no mission writes, no participant add/remove/edit,
 *     no lifecycle or approval controls.
 *   - ONE participants query (useAllMissionParticipants) grouped locally by
 *     MissionID — never a per-card query (no N+1).
 *   - ONE people query (usePeople) builds a PersonID → Person map for name
 *     resolution; unknown IDs render "Unknown person (PER-XXXX)".
 *   - Stable hook order; defaults at hook boundaries; no hooks after early
 *     returns (TD-23 lesson).
 *
 * Layer: Screen — consumes hooks, components/ui, components/shared.
 * Do NOT import services, SDK, SharePoint integration, or host-level APIs.
 */

import { useMemo, useState } from 'react';
import { Badge, Text } from '@fluentui/react-components';

import {
  EmptyState,
  MetricCard,
  PageHeader,
  SkeletonMetricStrip,
  SkeletonRows,
} from '@c3/components/ui';
import { useAllKitAssignments } from '@c3/hooks/useAllKitAssignments';
import { useAllMissionParticipants } from '@c3/hooks/useAllMissionParticipants';
import { useApp } from '@c3/hooks/useApp';
import { useMissions } from '@c3/hooks/useMissions';
import { usePeople } from '@c3/hooks/usePeople';
import type { KitAssignment, KitStatus, Mission, MissionParticipant, MissionStatus, Person } from '@c3/types';
import { FULFILLED_KIT_STATUSES, MISSION_OBLIGATION_ACTIVE_STATUSES } from '@c3/types';

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

// ---------------------------------------------------------------------------
// Kit status badge colours (S28-6)
// ---------------------------------------------------------------------------

const KIT_STATUS_COLOR: Record<
  KitStatus,
  'brand' | 'danger' | 'informative' | 'subtle' | 'success' | 'warning'
> = {
  NotOrdered: 'subtle',
  Ordered:    'informative',
  Shipped:    'informative',
  Delivered:  'success',
  Confirmed:  'success',
  Returned:   'warning',
  Replaced:   'warning',
  Missing:    'danger',
};

// ---------------------------------------------------------------------------
// ParticipantKit — read-only kit assignment lines for one participant (S28-6)
//
// Truthful display rule (S27 lesson): zero assignments reads "No kit
// assignments recorded." and NEVER renders a complete/ready state. The
// fulfilled summary only appears when >= 1 assignment exists.
// ---------------------------------------------------------------------------

const ParticipantKit = ({ items }: { items: KitAssignment[] }) => {
  if (items.length === 0) {
    return (
      <Text size={200} style={{ color: 'var(--c3-gray-500)', display: 'block' }}>
        No kit assignments recorded.
      </Text>
    );
  }

  const fulfilled = items.filter(k => FULFILLED_KIT_STATUSES.includes(k.Status)).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Text size={200} weight="semibold" style={{ color: 'var(--c3-gray-600)' }}>
        Kit: {items.length} item{items.length !== 1 ? 's' : ''} · {fulfilled} fulfilled
      </Text>
      {items.map(k => (
        <div
          key={`${k.ItemCategory}|${k.AssignmentKey}`}
          style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--c3-space-2)', flexWrap: 'wrap' }}
        >
          <Badge appearance="outline" size="small">{k.ItemCategory}</Badge>
          <Text size={200} style={{ color: 'var(--c3-gray-700)' }}>
            {k.ItemDescription ?? k.AssignmentKey}
            {k.JerseyNumber ? ` · #${k.JerseyNumber}` : ''}
          </Text>
          <Badge color={KIT_STATUS_COLOR[k.Status]} size="small">{k.Status}</Badge>
          {k.OwnerEmail && (
            <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
              {k.OwnerEmail}
            </Text>
          )}
        </div>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// ParticipantList — read-only assignment rows inside an expanded card (S27-4)
// ---------------------------------------------------------------------------

/** Resolve a display name from the People map; safe fallback for unknown IDs. */
const resolvePersonName = (personId: string, peopleById: Map<string, Person>): string =>
  peopleById.get(personId)?.FullName ?? `Unknown person (${personId})`;

const ParticipantList = ({
  participants,
  peopleById,
  currency,
  kitByPerson,
  onNavigateToPerson,
}: {
  participants: MissionParticipant[];
  peopleById: Map<string, Person>;
  currency?: string;
  /** Kit assignments grouped by PersonID for THIS mission (S28-6). */
  kitByPerson: Map<string, KitAssignment[]>;
  onNavigateToPerson: (personId: string) => void;
}) => (
  <div
    style={{
      borderTop: '1px solid var(--c3-gray-100)',
      paddingTop: 'var(--c3-space-3)',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--c3-space-3)',
    }}
  >
    {participants.map(p => (
      <div
        key={`${p.MissionID}|${p.PersonID}`}
        style={{ display: 'flex', flexDirection: 'column', gap: 4 }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: 'var(--c3-space-3)',
          }}
        >
          <div style={{ minWidth: 0 }}>
            {/* S28-6: name deep-links to PersonProfile (pure navigation). */}
            <button
              onClick={() => onNavigateToPerson(p.PersonID)}
              aria-label={`Open profile for ${resolvePersonName(p.PersonID, peopleById)}`}
              style={{
                border: 'none',
                background: 'transparent',
                padding: 0,
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'inherit',
                display: 'block',
                maxWidth: '100%',
              }}
            >
              <Text
                size={300}
                weight="semibold"
                style={{
                  color: 'var(--c3-brand-80)',
                  display: 'block',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {resolvePersonName(p.PersonID, peopleById)}
              </Text>
            </button>
            <Text
              size={200}
              style={{ color: 'var(--c3-gray-500)', fontFamily: 'monospace', whiteSpace: 'nowrap' }}
            >
              {p.PersonID}
              {p.ExternalCode ? ` · ${p.ExternalCode}` : ''}
            </Text>
          </div>
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'baseline', gap: 'var(--c3-space-2)' }}>
            <Badge appearance="outline">{p.Role}</Badge>
            {p.PerDiemRate !== undefined && (
              <Text size={200} style={{ color: 'var(--c3-gray-600)', whiteSpace: 'nowrap' }}>
                {p.PerDiemRate}{currency ? ` ${currency}` : ''}/day
              </Text>
            )}
          </div>
        </div>

        {/* Kit assignments for this participant (S28-6) */}
        <ParticipantKit items={kitByPerson.get(p.PersonID) ?? []} />
      </div>
    ))}
  </div>
);

const MissionCard = ({
  mission,
  participants,
  peopleById,
  kitByPerson,
  expanded,
  onToggle,
  onNavigateToPerson,
}: {
  mission: Mission;
  participants: MissionParticipant[];
  peopleById: Map<string, Person>;
  kitByPerson: Map<string, KitAssignment[]>;
  expanded: boolean;
  onToggle: () => void;
  onNavigateToPerson: (personId: string) => void;
}) => (
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

    {/* ── Participants (S27-4) — read-only; count row toggles the detail list ── */}
    <button
      onClick={onToggle}
      disabled={participants.length === 0}
      aria-expanded={expanded}
      aria-label={`${participants.length} participant${participants.length !== 1 ? 's' : ''} for ${mission.MissionID}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--c3-space-2)',
        border: 'none',
        background: 'transparent',
        padding: 0,
        cursor: participants.length > 0 ? 'pointer' : 'default',
        textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      <Text size={200} weight="semibold" style={{ color: 'var(--c3-gray-700)' }}>
        {participants.length === 0
          ? 'No participants assigned'
          : `${participants.length} participant${participants.length !== 1 ? 's' : ''}`}
      </Text>
      {participants.length > 0 && (
        <Text size={200} style={{ color: 'var(--c3-gray-500)' }}>
          {expanded ? '▾ hide' : '▸ show'}
        </Text>
      )}
    </button>

    {expanded && participants.length > 0 && (
      <ParticipantList
        participants={participants}
        peopleById={peopleById}
        currency={mission.OperatingCurrency}
        kitByPerson={kitByPerson}
        onNavigateToPerson={onNavigateToPerson}
      />
    )}
  </div>
);

// ---------------------------------------------------------------------------
// MissionWorkspace
// ---------------------------------------------------------------------------

export const MissionWorkspace = () => {
  const { navigate } = useApp();
  const { data: missions = [], isLoading: missionsLoading, error } = useMissions();

  // S27-4: single batch participants query grouped locally — never per-card.
  const { allParticipants, isLoading: participantsLoading } = useAllMissionParticipants();

  // S27-4: single people query for PersonID → name resolution.
  const { data: people = [], isLoading: peopleLoading } = usePeople();

  // S28-6: single batch kit query grouped locally by mission and person.
  const { data: allKit, isLoading: kitLoading } = useAllKitAssignments();

  // Expanded participant lists, keyed by MissionID (screen-local UI state).
  const [expandedMissions, setExpandedMissions] = useState<Set<string>>(new Set());

  // Data freshness timestamp — recomputes on each React Query refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => new Date().toISOString(), [missions]);

  const participantsByMission = useMemo(() => {
    const map = new Map<string, MissionParticipant[]>();
    for (const p of allParticipants) {
      const list = map.get(p.MissionID) ?? [];
      list.push(p);
      map.set(p.MissionID, list);
    }
    return map;
  }, [allParticipants]);

  const peopleById = useMemo(() => {
    const map = new Map<string, Person>();
    for (const person of people) map.set(person.PersonID, person);
    return map;
  }, [people]);

  // Kit assignments grouped mission → person → items (S28-6).
  const kitByMissionPerson = useMemo(() => {
    const map = new Map<string, Map<string, KitAssignment[]>>();
    for (const k of allKit) {
      const perPerson = map.get(k.MissionID) ?? new Map<string, KitAssignment[]>();
      const list = perPerson.get(k.PersonID) ?? [];
      list.push(k);
      perPerson.set(k.PersonID, list);
      map.set(k.MissionID, perPerson);
    }
    return map;
  }, [allKit]);

  const EMPTY_KIT_MAP = useMemo(() => new Map<string, KitAssignment[]>(), []);

  const toggleExpanded = (missionId: string) => {
    setExpandedMissions(prev => {
      const next = new Set(prev);
      if (next.has(missionId)) next.delete(missionId);
      else next.add(missionId);
      return next;
    });
  };

  const isLoading = missionsLoading || participantsLoading || peopleLoading || kitLoading;

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
            <MissionCard
              key={mission.MissionID}
              mission={mission}
              participants={participantsByMission.get(mission.MissionID) ?? []}
              peopleById={peopleById}
              kitByPerson={kitByMissionPerson.get(mission.MissionID) ?? EMPTY_KIT_MAP}
              expanded={expandedMissions.has(mission.MissionID)}
              onToggle={() => toggleExpanded(mission.MissionID)}
              onNavigateToPerson={personId => navigate({ id: 'person-profile', personId })}
            />
          ))}
        </div>
      )}

    </div>
  );
};
