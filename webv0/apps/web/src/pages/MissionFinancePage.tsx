import { Link } from 'react-router-dom';
import { formatMoney } from '@c3web/domain';
import { useMissionsFinanceSummary } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { missionFinanceStageOf } from '../labels';

/**
 * MissionFinancePage (S2) — the all-missions finance dashboard: every
 * mission's money on one screen (the owner's literal ask). Line-based blends
 * only — each mission's own P&L page carries the full truth including
 * per-diem roll-ins; this register answers "where does the money stand,
 * org-wide, right now".
 */
export function MissionFinancePage() {
  const r = useRegisterStyles();
  const { me } = useSession();
  const canView = me?.capabilities.canViewFinancials ?? false;
  const { data, isLoading, isError, error } = useMissionsFinanceSummary(canView);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Mission finance" />
        <EmptyState data-testid="mission-finance-denied" message="Financial detail is unavailable for your role." />
      </div>
    );
  }

  const rows = data?.missions ?? [];

  return (
    <div>
      <PageHeader
        kicker="Finance"
        title="Mission finance"
        context={data ? `${rows.length} mission${rows.length === 1 ? '' : 's'}` : undefined}
        breadcrumbs={<Breadcrumbs crumbs={[{ label: 'Missions', to: '/missions' }, { label: 'Finance' }]} />}
      />
      {isLoading && <LoadingState label="Loading mission finance…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load mission finance.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && rows.length === 0 && <EmptyState data-testid="mission-finance-empty" message="No missions yet." />}
      {data && rows.length > 0 && (
        <table className={r.table} data-testid="mission-finance-table" aria-label="All-missions finance">
          <thead>
            <tr>
              <th className={r.th}>Code</th>
              <th className={r.th}>Mission</th>
              <th className={r.th}>Stage</th>
              <th className={r.th}>Income ≈</th>
              <th className={r.th}>Expenses ≈</th>
              <th className={r.th}>Profit ≈</th>
              <th className={r.th}>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.missionId} className={r.row} data-testid={`finance-row-${m.missionId}`}>
                <td className={`${r.td} ${r.mono}`}>{m.code ?? '—'}</td>
                <td className={r.td}>
                  <Link className={r.nameLink} to={`/missions/${m.missionId}`} data-testid={`finance-link-${m.missionId}`}>
                    {m.name}
                  </Link>
                </td>
                <td className={r.td}>
                  <StatusBadge variant={missionFinanceStageOf(m.financeStage).variant} data-testid={`finance-stage-${m.missionId}`}>
                    {missionFinanceStageOf(m.financeStage).label}
                  </StatusBadge>
                </td>
                <td className={`${r.td} ${r.mono}`}>{m.blended ? formatMoney(m.blended.incomeUsdMinor, 'USD') : '—'}</td>
                <td className={`${r.td} ${r.mono}`}>{m.blended ? formatMoney(m.blended.expenseUsdMinor, 'USD') : '—'}</td>
                <td className={`${r.td} ${r.mono}`} data-testid={`finance-profit-${m.missionId}`}>
                  {m.blended ? (
                    formatMoney(m.blended.profitUsdMinor, 'USD')
                  ) : (
                    // Polish wave (owner ruling #5): a data-quality warning
                    // speaks up in amber — honest numbers are never muted.
                    <span style={{ color: 'var(--c3-state-warning)', fontWeight: 600 }}>
                      rates missing: {m.missingRates.join(', ')}
                    </span>
                  )}
                </td>
                <td className={r.td} data-testid={`finance-outstanding-${m.missionId}`}>
                  {m.outstandingIncomeCount > 0 ? `${m.outstandingIncomeCount} income` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
