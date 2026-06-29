import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Text } from '@fluentui/react-components';

import {
  EmptyState,
  PageHeader,
  SkeletonRows,
} from '@c3/components/ui';
import { useAmendments } from '@c3/hooks/useAmendments';
import { useApp } from '@c3/hooks/useApp';
import type { Amendment } from '@c3/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AmendmentWorkspaceProps {
  contractId?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatDate = (value?: string): string => {
  if (!value) return '—';
  return value.split('T')[0];
};

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

const COL_WIDTHS: (number | null)[] = [150, 160, null, 130, 120, 130];

const HEADERS = [
  'Amendment ID',
  'Parent Contract',
  'Type',
  'Effective Date',
  'Status',
  'Approval Status',
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
          width: 160,
          borderRadius: 'var(--c3-radius-sm)',
          backgroundColor: 'var(--c3-gray-200)',
        }}
      />
      <div
        style={{
          height: 12,
          width: 200,
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
// AmendmentRow
// ---------------------------------------------------------------------------

const AmendmentRow = ({
  amendment,
  onClick,
}: {
  amendment: Amendment;
  onClick: () => void;
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <tr
      onClick={onClick}
      tabIndex={0}
      aria-label={`View amendment ${amendment.AmendmentID}`}
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
      {/* Amendment ID */}
      <td style={CELL}>
        <Text
          weight="semibold"
          size={200}
          style={{ fontFamily: 'monospace', letterSpacing: '0.02em', color: 'var(--c3-gray-950)' }}
        >
          {amendment.AmendmentID}
        </Text>
      </td>

      {/* Parent Contract */}
      <td style={CELL}>
        <Text
          size={200}
          style={{ fontFamily: 'monospace', color: 'var(--c3-gray-700)' }}
        >
          {amendment.ParentContractCode ?? amendment.ParentContractID}
        </Text>
      </td>

      {/* Type */}
      <td style={CELL}>
        <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
          {amendment.AmendmentTypeName || amendment.AmendmentTypeCode || '—'}
        </Text>
      </td>

      {/* Effective Date */}
      <td style={CELL}>
        <Text size={300} style={{ color: 'var(--c3-gray-700)', fontFamily: 'monospace' }}>
          {formatDate(amendment.EffectiveDate)}
        </Text>
      </td>

      {/* Status */}
      <td style={CELL}>
        <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
          {amendment.Status ?? '—'}
        </Text>
      </td>

      {/* Approval Status */}
      <td style={CELL}>
        <Text size={300} style={{ color: 'var(--c3-gray-700)' }}>
          {amendment.ApprovalStatus ?? '—'}
        </Text>
      </td>
    </tr>
  );
};

// ---------------------------------------------------------------------------
// AmendmentWorkspace
// ---------------------------------------------------------------------------

export const AmendmentWorkspace = ({ contractId }: AmendmentWorkspaceProps) => {
  void contractId;
  const { navigate } = useApp();
  const { data: amendments = [], isLoading, error } = useAmendments();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => new Date().toISOString(), [amendments]);

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
          title="Amendment Workspace"
          subtitle="Track contract amendments, approval state, and effective changes."
        />
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
          title="Amendment Workspace"
          subtitle="Track contract amendments, approval state, and effective changes."
        />
        <EmptyState
          variant="error"
          title="Could not load amendments"
          description="Check your connection or contact an administrator."
        />
      </div>
    );
  }

  const resultLabel = `${amendments.length} ${amendments.length === 1 ? 'amendment' : 'amendments'}`;

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
        title="Amendment Workspace"
        subtitle="Track contract amendments, approval state, and effective changes."
        lastUpdated={loadedAt}
      />

      {/* Amendment Register */}
      <RegisterPanel title="Amendment Register" subtitle={`${resultLabel} shown`}>
        {amendments.length === 0 ? (
          <div style={{ padding: 'var(--c3-space-6)' }}>
            <EmptyState
              title="No amendments found"
              description="No amendment records are available."
            />
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
                {HEADERS.map(label => (
                  <th key={label} style={TH}>
                    <Text
                      size={200}
                      style={{
                        color: 'var(--c3-gray-500)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        fontWeight: 600,
                      }}
                    >
                      {label}
                    </Text>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {amendments.map(amendment => (
                <AmendmentRow
                  key={amendment.Id}
                  amendment={amendment}
                  onClick={() =>
                    navigate({
                      id: 'amendment-profile',
                      amendmentId: String(amendment.Id),
                    })
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
