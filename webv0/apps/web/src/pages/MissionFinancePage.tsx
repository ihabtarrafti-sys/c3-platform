import { Link } from 'react-router-dom';
import { formatMoney } from '@c3web/domain';
import { useMissionsFinanceSummary } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import {
  TableworkPage,
  RecordBackLink,
  CollectionFrame,
  ComparisonTable,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../tablework';
import { missionFinanceStageOf } from '../labels';

/**
 * MissionFinancePage (S2) — the all-missions finance dashboard: every
 * mission's money on one screen (the owner's literal ask). Line-based blends
 * only — each mission's own P&L page carries the full truth including
 * per-diem roll-ins; this register answers "where does the money stand,
 * org-wide, right now".
 *
 * Tablework conversion (pivot W2, Lane C). M1 MANDATE: breadcrumbs do not port,
 * and the `Missions › Finance` crumb was this screen's ONLY in-page route back
 * to the missions register — so `RecordBackLink` rides the ContextHeader intent
 * bar. It sits on BOTH the denied and permitted branches: a role that fails the
 * financial gate still has to be able to leave.
 *
 * Money is untouched by the conversion: `formatMoney` (code-first, U+00A0
 * separator) stays exactly as it was — `missions.spec` pins
 * `finance-profit-MSN-0001` to `USD 9,500.00` byte-for-byte.
 */
export function MissionFinancePage() {
  return (
    <TableworkPage
      record="Mission finance"
      section="Overview"
      actions={<RecordBackLink to="/missions">Back to missions</RecordBackLink>}
    >
      <MissionFinanceOverview />
    </TableworkPage>
  );
}

function MissionFinanceOverview() {
  const { me } = useSession();
  const canView = me?.capabilities.canViewFinancials ?? false;
  // The wire law: the capability IS the react-query `enabled` flag. Never
  // hoisted to always-on and hidden visually — the register must not reach a
  // browser that has no financial standing.
  const { data, isLoading, isError, error } = useMissionsFinanceSummary(canView);

  if (!canView) {
    return (
      <CollectionFrame title="Mission finance">
        <EmptyState data-testid="mission-finance-denied" message="Financial detail is unavailable for your role." />
      </CollectionFrame>
    );
  }

  const rows = data?.missions ?? [];

  return (
    <CollectionFrame
      kicker="Finance"
      title="Mission finance"
      count={data ? `${rows.length} mission${rows.length === 1 ? '' : 's'}` : undefined}
    >
      {isLoading && <LoadingState label="Loading mission finance…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load mission finance.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && rows.length === 0 && <EmptyState data-testid="mission-finance-empty" message="No missions yet." />}
      {data && rows.length > 0 && (
        <ComparisonTable label="All-missions finance" testId="mission-finance-table">
          <thead>
            <tr>
              <th>Code</th>
              <th>Mission</th>
              <th>Stage</th>
              <th>Income ≈</th>
              <th>Expenses ≈</th>
              <th>Profit ≈</th>
              <th>Outstanding</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.missionId} data-testid={`finance-row-${m.missionId}`}>
                <td className="mono">{m.code ?? '—'}</td>
                <td>
                  {/* A human mission NAME, not a code — a sans link, never
                      RecordLink (mono is reserved for codes, dates, amounts). */}
                  <Link to={`/missions/${m.missionId}`} data-testid={`finance-link-${m.missionId}`}>
                    {m.name}
                  </Link>
                </td>
                <td>
                  <StatusBadge variant={missionFinanceStageOf(m.financeStage).variant} data-testid={`finance-stage-${m.missionId}`}>
                    {missionFinanceStageOf(m.financeStage).label}
                  </StatusBadge>
                </td>
                <td className="mono">{m.blended ? formatMoney(m.blended.incomeUsdMinor, 'USD') : '—'}</td>
                <td className="mono">{m.blended ? formatMoney(m.blended.expenseUsdMinor, 'USD') : '—'}</td>
                <td className="mono" data-testid={`finance-profit-${m.missionId}`}>
                  {m.blended ? (
                    formatMoney(m.blended.profitUsdMinor, 'USD')
                  ) : (
                    // Polish wave (owner ruling #5): a data-quality warning
                    // speaks up in amber — honest numbers are never muted.
                    // NOT a dash: this branch names the missing rates.
                    <span style={{ color: 'var(--c3-state-warning)', fontWeight: 600 }}>
                      rates missing: {m.missingRates.join(', ')}
                    </span>
                  )}
                </td>
                <td data-testid={`finance-outstanding-${m.missionId}`}>
                  {m.outstandingIncomeCount > 0 ? `${m.outstandingIncomeCount} income` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </ComparisonTable>
      )}
    </CollectionFrame>
  );
}
