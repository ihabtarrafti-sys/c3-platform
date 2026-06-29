import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Text } from '@fluentui/react-components';

import {
  EmptyState,
  MetricCard,
  PageHeader,
  SkeletonMetricStrip,
  SkeletonRows,
} from '@c3/components/ui';
import { useApp } from '@c3/hooks/useApp';
import { usePeople } from '@c3/hooks/usePeople';
import type { Person, PersonFilter } from '@c3/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PeopleWorkspaceProps {
  filter?: PersonFilter;
}

// ---------------------------------------------------------------------------
// Table constants
// ---------------------------------------------------------------------------

const CELL: CSSProperties = {
  padding: '10px 16px',
  verticalAlign: 'middle',
  borderBottom: '1px solid var(--c3-gray-100)',
};

const TH: CSSProperties = {
  padding: '10px 16px',
  backgroundColor: 'var(--c3-gray-50)',
  borderBottom: '1px solid var(--c3-gray-200)',
  textAlign: 'left',
};

const COL_WIDTHS: (number | null)[] = [120, null, 140, 160, 120, 96, 80];

const HEADERS: { label: string; align?: 'left' | 'right' }[] = [
  { label: 'Person ID' },
  { label: 'Full Name' },
  { label: 'IGN' },
  { label: 'Role' },
  { label: 'Nationality' },
  { label: 'Status' },
  { label: 'Contracts', align: 'right' },
];

// ---------------------------------------------------------------------------
// RegisterPanel (no inner padding — table is full-bleed)
// ---------------------------------------------------------------------------

interface RegisterPanelProps {
  title: string;
  subtitle: string;
  children: ReactNode;
}

const RegisterPanel = ({ title, subtitle, children }: RegisterPanelProps) => (
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
      }}
    >
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
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// RegisterPanelSkeleton
// ---------------------------------------------------------------------------

const RegisterPanelSkeleton = () => (
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
          width: 180,
          borderRadius: 'var(--c3-radius-sm)',
          backgroundColor: 'var(--c3-gray-100)',
        }}
      />
    </div>
    <div style={{ padding: 'var(--c3-space-4)' }}>
      <SkeletonRows count={8} />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// PersonRow
// ---------------------------------------------------------------------------

const PersonRow = ({ person, onClick }: { person: Person; onClick: () => void }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <tr
      onClick={onClick}
      tabIndex={0}
      aria-label={`View profile for ${person.FullName}`}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: 'pointer',
        background: hovered ? 'var(--c3-gray-50)' : 'var(--c3-white)',
        transition: 'background var(--c3-motion-fast) var(--c3-motion-ease-out)',
        outline: 'none',
      }}
    >
      {/* Person ID */}
      <td style={CELL}>
        <Text
          weight="semibold"
          size={200}
          style={{ fontFamily: 'monospace', letterSpacing: '0.02em', color: 'var(--c3-gray-950)' }}
        >
          {person.PersonID}
        </Text>
      </td>

      {/* Full Name */}
      <td style={CELL}>
        <Text weight="semibold" size={300} style={{ color: 'var(--c3-gray-950)' }}>
          {person.FullName}
        </Text>
      </td>

      {/* IGN */}
      <td style={CELL}>
        <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
          {person.IGN ?? '—'}
        </Text>
      </td>

      {/* Role */}
      <td style={CELL}>
        <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
          {person.PrimaryRole ?? '—'}
        </Text>
      </td>

      {/* Nationality */}
      <td style={CELL}>
        <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
          {person.Nationality ?? '—'}
        </Text>
      </td>

      {/* Status */}
      <td style={CELL}>
        <span
          style={{
            display: 'inline-block',
            padding: '2px 8px',
            borderRadius: 'var(--c3-radius-sm)',
            fontSize: 12,
            fontWeight: 600,
            background: person.IsActive ? 'var(--c3-success-bg)' : 'var(--c3-gray-100)',
            color: person.IsActive ? 'var(--c3-success)' : 'var(--c3-gray-500)',
            border: `1px solid ${person.IsActive ? 'var(--c3-success-border)' : 'var(--c3-gray-200)'}`,
          }}
        >
          {person.IsActive ? 'Active' : 'Inactive'}
        </span>
      </td>

      {/* Contracts */}
      <td style={{ ...CELL, textAlign: 'right' }}>
        <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
          {person.TotalContracts ?? 0}
        </Text>
      </td>
    </tr>
  );
};

// ---------------------------------------------------------------------------
// PeopleWorkspace
// ---------------------------------------------------------------------------

export const PeopleWorkspace = ({ filter }: PeopleWorkspaceProps) => {
  void filter;
  const { navigate } = useApp();
  const { data: people = [], isLoading, error } = usePeople();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => new Date().toISOString(), [people]);

  const metrics = useMemo(
    () => ({
      total: people.length,
      active: people.filter(p => p.IsActive).length,
      inactive: people.filter(p => !p.IsActive).length,
    }),
    [people],
  );

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
          title="People Workspace"
          subtitle="Contract participants, talent, staff and stakeholders."
        />
        <SkeletonMetricStrip count={3} />
        <RegisterPanelSkeleton />
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
          title="People Workspace"
          subtitle="Contract participants, talent, staff and stakeholders."
        />
        <EmptyState
          variant="error"
          title="Could not load people"
          description="Check your connection or contact an administrator."
        />
      </div>
    );
  }

  const resultLabel = `${people.length} ${people.length === 1 ? 'person' : 'people'}`;

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
        title="People Workspace"
        subtitle="Contract participants, talent, staff and stakeholders."
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
        <MetricCard label="Total People" value={metrics.total} />
        <MetricCard
          label="Active"
          value={metrics.active}
          variant={metrics.active > 0 ? 'success' : 'default'}
        />
        <MetricCard
          label="Inactive"
          value={metrics.inactive}
          variant={metrics.inactive > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* People Register */}
      <RegisterPanel title="People Register" subtitle={`${resultLabel} shown`}>
        {people.length === 0 ? (
          <div style={{ padding: 'var(--c3-space-6)' }}>
            <EmptyState title="No people found" description="No people records are available." />
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <colgroup>
              {COL_WIDTHS.map((w, i) => (
                <col key={i} style={w ? { width: w } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr>
                {HEADERS.map(h => (
                  <th key={h.label} style={{ ...TH, textAlign: h.align ?? 'left' }}>
                    <Text
                      size={200}
                      style={{
                        color: 'var(--c3-gray-500)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        fontWeight: 600,
                      }}
                    >
                      {h.label}
                    </Text>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map(person => (
                <PersonRow
                  key={person.Id}
                  person={person}
                  onClick={() =>
                    navigate({ id: 'person-profile', personId: String(person.Id) })
                  }
                />
              ))}
            </tbody>
          </table>
        )}
      </RegisterPanel>
    </div>
  );
};
