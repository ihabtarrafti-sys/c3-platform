/**
 * ContractsList — C3 Design System v1.0
 *
 * The operational contract register. Denser than Command Center and Renewals
 * because it is a working tool — operators need to scan many rows quickly.
 *
 * Layout:
 *   PageHeader (title + subtitle + last-updated + New Contract action)
 *   KPI strip (4 MetricCards — total / active / renewing / archived)
 *   Register panel — filter bar + table
 *
 * Design constraints:
 *   - Tabular layout; DataRow cards are too card-like for a dense register.
 *   - Filter bar is full-bleed within the panel (no outer padding).
 *   - Table rows use local ContractRow with inline hover state (useState),
 *     consistent with the DataRow pattern already established in C3.
 *   - All filter state, navigation, and business logic preserved verbatim.
 *
 * Layer: Screen — consumes hooks, components/ui, components/shared.
 * Do NOT import services, SDK, SharePoint integration, or host-level APIs.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Button, Input, Select, Text } from '@fluentui/react-components';

import {
  EmptyState,
  MetricCard,
  PageHeader,
  SkeletonMetricStrip,
  SkeletonRows,
} from '@c3/components/ui';
import { DaysPill } from '@c3/components/shared/DaysPill';
import { DispositionBadge } from '@c3/components/shared/DispositionBadge';
import { OpsStatusBadge } from '@c3/components/shared/OpsStatusBadge';
import { StageBadge } from '@c3/components/shared/StageBadge';
import { useApp } from '@c3/hooks/useApp';
import { useContracts } from '@c3/hooks/useContracts';
import { isActiveDisposition } from '@c3/intelligence/contractKpis';
import type { Contract, ContractFilter, ContractStage, Disposition } from '@c3/types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ContractsListProps {
  filter?: ContractFilter;
}

// ---------------------------------------------------------------------------
// RegisterPanel — full-bleed panel for the contracts table.
// Unlike the standard Panel used in CommandCenter / RenewalsCenter, this
// variant renders children without inner padding so the filter bar and table
// can span the full panel width.
// ---------------------------------------------------------------------------

type RegisterPanelProps = {
  title: string;
  subtitle: string;
  actions?: ReactNode;
  children: ReactNode;
};

const RegisterPanel = ({ title, subtitle, actions, children }: RegisterPanelProps) => (
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
      {actions && <div style={{ flexShrink: 0 }}>{actions}</div>}
    </div>
    {/* children rendered without inner padding — panel content manages its own spacing */}
    {children}
  </div>
);

// ---------------------------------------------------------------------------
// RegisterPanelSkeleton — loading placeholder for the register panel
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
    {/* Panel header skeleton */}
    <div
      style={{
        padding: 'var(--c3-space-4)',
        borderBottom: '1px solid var(--c3-gray-100)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div
          style={{
            height: 16,
            width: 180,
            borderRadius: 'var(--c3-radius-sm)',
            backgroundColor: 'var(--c3-gray-200)',
          }}
        />
        <div
          style={{
            height: 12,
            width: 120,
            borderRadius: 'var(--c3-radius-sm)',
            backgroundColor: 'var(--c3-gray-100)',
          }}
        />
      </div>
      <div
        style={{
          height: 32,
          width: 120,
          borderRadius: 'var(--c3-radius-md)',
          backgroundColor: 'var(--c3-gray-200)',
        }}
      />
    </div>
    {/* Filter bar skeleton */}
    <div
      style={{
        display: 'flex',
        gap: 'var(--c3-space-2)',
        padding: 'var(--c3-space-3) var(--c3-space-4)',
        background: 'var(--c3-gray-50)',
        borderBottom: '1px solid var(--c3-gray-200)',
      }}
    >
      {[280, 140, 160].map((w, i) => (
        <div
          key={i}
          style={{
            height: 32,
            width: w,
            borderRadius: 'var(--c3-radius-md)',
            backgroundColor: 'var(--c3-gray-200)',
          }}
        />
      ))}
    </div>
    {/* Row skeletons */}
    <div style={{ padding: 'var(--c3-space-3) var(--c3-space-4) var(--c3-space-4)' }}>
      <SkeletonRows count={8} />
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// ContractRow — a single interactive row in the contracts table.
// Uses the same hover-via-useState pattern as DataRow for consistency.
// Dense padding (10px / 16px) keeps the register compact.
// ---------------------------------------------------------------------------

const CELL: React.CSSProperties = {
  padding: '10px 16px',
  verticalAlign: 'middle',
  borderBottom: '1px solid var(--c3-gray-100)',
};

const ContractRow = ({
  contract,
  onClick,
}: {
  contract: Contract;
  onClick: () => void;
}) => {
  const [hovered, setHovered] = useState(false);

  return (
    <tr
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      tabIndex={0}
      aria-label={`${contract.ContractID} — ${contract.FullName}`}
      style={{
        cursor: 'pointer',
        background: hovered ? 'var(--c3-gray-50)' : 'var(--c3-white)',
        transition: `background var(--c3-motion-fast) var(--c3-motion-ease-out)`,
        outline: 'none',
      }}
    >
      {/* Contract ID */}
      <td style={CELL}>
        <Text
          weight="semibold"
          style={{
            fontFamily: 'monospace',
            fontSize: 13,
            color: 'var(--c3-gray-950)',
            display: 'block',
            whiteSpace: 'nowrap',
          }}
        >
          {contract.ContractID}
        </Text>
      </td>

      {/* Person */}
      <td style={CELL}>
        <Text style={{ color: 'var(--c3-gray-950)' }}>
          {contract.FullName}
        </Text>
      </td>

      {/* Type */}
      <td style={CELL}>
        <Text size={300} style={{ color: 'var(--c3-gray-700)', whiteSpace: 'nowrap' }}>
          {contract.ContractTypeName}
        </Text>
      </td>

      {/* Stage */}
      <td style={CELL}>
        <StageBadge stage={contract.ContractStage1} />
      </td>

      {/* Ops Status */}
      <td style={CELL}>
        <OpsStatusBadge status={contract.OpsStatus} />
      </td>

      {/* Disposition */}
      <td style={CELL}>
        <DispositionBadge disposition={contract.Disposition1} />
      </td>

      {/* Expiry */}
      <td style={CELL}>
        <DaysPill endDate={contract.EndDate} />
      </td>

      {/* Owner */}
      <td style={CELL}>
        <Text size={300} style={{ color: 'var(--c3-gray-500)', whiteSpace: 'nowrap' }}>
          {contract.ContractOwner?.Title ?? 'Unassigned'}
        </Text>
      </td>
    </tr>
  );
};

// ---------------------------------------------------------------------------
// ContractsList
// ---------------------------------------------------------------------------

export const ContractsList = ({ filter }: ContractsListProps) => {
  void filter; // reserved for future deep-link filter pre-population

  const { navigate } = useApp();
  const { data: contracts = [], isLoading, error } = useContracts();

  // Data freshness timestamp — recomputes on each React Query refetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadedAt = useMemo(() => new Date().toISOString(), [contracts]);

  // ── Filter state ───────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<'all' | ContractStage>('all');
  const [disposition, setDisposition] = useState<'all' | Exclude<Disposition, null>>('all');

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filteredContracts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return contracts.filter(contract => {
      const matchesSearch =
        q === '' ||
        contract.ContractID.toLowerCase().includes(q) ||
        contract.FullName.toLowerCase().includes(q) ||
        contract.ContractTypeName.toLowerCase().includes(q);

      const matchesStage = stage === 'all' || contract.ContractStage1 === stage;

      const matchesDisposition =
        disposition === 'all' || contract.Disposition1 === disposition;

      return matchesSearch && matchesStage && matchesDisposition;
    });
  }, [contracts, search, stage, disposition]);

  // ── KPI metrics ────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const total    = contracts.length;
    const active   = contracts.filter(isActiveDisposition).length;
    const renewing = contracts.filter(c => c.Disposition1 === 'Renewing').length;
    const archived = contracts.filter(c => c.Disposition1 === 'Archived').length;
    return { total, active, renewing, archived };
  }, [contracts]);

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
        <RegisterPanelSkeleton />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div style={{ padding: 'var(--c3-space-8)' }}>
        <EmptyState
          variant="error"
          title="Could not load contracts"
          description="The contract register could not be retrieved. Check your connection or try refreshing the page."
        />
      </div>
    );
  }

  // ── Result count label ─────────────────────────────────────────────────────
  const resultLabel =
    filteredContracts.length === contracts.length
      ? `${contracts.length} contract${contracts.length !== 1 ? 's' : ''}`
      : `${filteredContracts.length} of ${contracts.length}`;

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 'var(--c3-space-8)' }}>

      {/* ── Page header ──────────────────────────────────────────────── */}
      <PageHeader
        title="Contracts Workspace"
        subtitle="Operational register for contract lifecycle tracking."
        lastUpdated={loadedAt}
        actions={<Button appearance="primary">New Contract</Button>}
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
          label="Total Contracts"
          value={metrics.total}
          variant="default"
          onClick={() => navigate({ id: 'contracts' })}
        />
        <MetricCard
          label="Active"
          value={metrics.active}
          variant="success"
          context="In good standing"
          onClick={() => navigate({ id: 'contracts' })}
        />
        <MetricCard
          label="Renewing"
          value={metrics.renewing}
          variant={metrics.renewing > 0 ? 'info' : 'default'}
          context={metrics.renewing > 0 ? 'Active renewal processing' : 'None in progress'}
          onClick={() => navigate({ id: 'contracts' })}
        />
        <MetricCard
          label="Archived"
          value={metrics.archived}
          variant="default"
          context="Closed lifecycle"
          onClick={() => navigate({ id: 'contracts' })}
        />
      </div>

      {/* ── Contract register ─────────────────────────────────────────── */}
      <RegisterPanel
        title="Contract Register"
        subtitle={resultLabel}
        actions={null}
      >

        {/* Filter bar — full-bleed, visually separated from table */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--c3-space-3)',
            padding: 'var(--c3-space-3) var(--c3-space-4)',
            background: 'var(--c3-gray-50)',
            borderBottom: '1px solid var(--c3-gray-200)',
          }}
        >
          <Input
            placeholder="Search by ID, person, or type…"
            value={search}
            onChange={(_, data) => setSearch(data.value)}
            style={{ minWidth: 280 }}
          />

          <Select
            value={stage}
            onChange={event => setStage(event.target.value as 'all' | ContractStage)}
          >
            <option value="all">All stages</option>
            <option value="Draft">Draft</option>
            <option value="In Review">In Review</option>
            <option value="Pending Approval">Pending Approval</option>
            <option value="Pending Signature">Pending Signature</option>
            <option value="Signed">Signed</option>
          </Select>

          <Select
            value={disposition}
            onChange={event =>
              setDisposition(event.target.value as 'all' | Exclude<Disposition, null>)
            }
          >
            <option value="all">All dispositions</option>
            <option value="Active">Active</option>
            <option value="Renewing">Renewing</option>
            <option value="Terminated">Terminated</option>
            <option value="Archived">Archived</option>
          </Select>

          <Text
            size={200}
            style={{
              marginLeft: 'auto',
              color: 'var(--c3-gray-400)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {resultLabel}
          </Text>
        </div>

        {/* Table — or empty state */}
        {filteredContracts.length === 0 ? (
          <div style={{ padding: 'var(--c3-space-6) var(--c3-space-4)' }}>
            <EmptyState
              variant="empty"
              title={
                contracts.length === 0
                  ? 'No contracts yet'
                  : 'No contracts match your filters'
              }
              description={
                contracts.length === 0
                  ? 'Contracts will appear here once they are created.'
                  : 'Try adjusting your search term or clearing a stage or disposition filter.'
              }
              compact
            />
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              style={{
                width: '100%',
                borderCollapse: 'collapse',
                borderSpacing: 0,
              }}
            >
              <thead>
                <tr
                  style={{
                    background: 'var(--c3-gray-50)',
                    borderBottom: '1px solid var(--c3-gray-200)',
                  }}
                >
                  {(
                    [
                      ['Contract ID', 130],
                      ['Person',      null],
                      ['Type',        160],
                      ['Stage',       120],
                      ['Ops Status',  110],
                      ['Disposition', 120],
                      ['Expiry',       90],
                      ['Owner',       140],
                    ] as [string, number | null][]
                  ).map(([label, width]) => (
                    <th
                      key={label}
                      scope="col"
                      style={{
                        padding: '8px 16px',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        fontWeight: 'normal',
                        whiteSpace: 'nowrap',
                        ...(width !== null ? { width } : {}),
                      }}
                    >
                      <Text
                        size={200}
                        style={{
                          color: 'var(--c3-gray-500)',
                          letterSpacing: '0.04em',
                          textTransform: 'uppercase',
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
                {filteredContracts.map(contract => (
                  <ContractRow
                    key={contract.Id}
                    contract={contract}
                    onClick={() =>
                      navigate({
                        id: 'contract-profile',
                        contractId: String(contract.Id),
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </RegisterPanel>

    </div>
  );
};
