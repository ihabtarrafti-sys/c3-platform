import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney } from '@c3web/domain';
import { useMissionsFinanceSummary } from '../queries';
import { ApiError, type MissionFinanceSummaryDto } from '../api';
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
  truthStateOf,
  type WitnessState,
} from '../tablework';
import { missionFinanceStageOf } from '../labels';

export interface MissionFinanceTruthFacts {
  readonly canView: boolean;
  readonly data: MissionFinanceSummaryDto | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

/** Finance owns its witness independently: it has no Comms live channel. */
export function missionFinanceTruthOf({
  canView,
  data,
  error,
  isLoading,
  isFetching,
  dataUpdatedAt,
}: MissionFinanceTruthFacts): WitnessState {
  if (!canView) return { kind: 'denied', reasonClass: 'FINANCIALS_UNAVAILABLE' };

  // An authoritative client error revokes the cached projection. In
  // particular, a 403/404 may never fall through to stale-with-children.
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return { kind: 'denied', reasonClass: error.code || `HTTP_${error.status}` };
  }

  const base = truthStateOf(
    { data, error, isLoading, dataUpdatedAt },
    (view) => view.missions.length === 0,
  );

  if (isFetching && data !== undefined && (base.kind === 'verified' || base.kind === 'proven-empty')) {
    return {
      kind: 'stale',
      // Cached React Query data normally has a positive witness stamp. Epoch
      // is the honest non-current fallback if an injected/test cache does not.
      verifiedAt: new Date(dataUpdatedAt > 0 ? dataUpdatedAt : 0),
      message: 'Mission finance is being checked again.',
    };
  }

  return base;
}

export interface MissionFinanceOverviewProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly onTruthChange?: (truth: WitnessState) => void;
  readonly linkToMission?: (missionId: string) => string;
}

const directMissionLink = (missionId: string) => `/missions/${missionId}`;

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

export function MissionFinanceOverview({
  enabled = true,
  foreground = true,
  onTruthChange,
  linkToMission = directMissionLink,
}: MissionFinanceOverviewProps = {}) {
  const { me } = useSession();
  const canView = me?.capabilities.canViewFinancials ?? false;
  const queryEnabled = enabled && canView;
  // The wire law: the capability IS the react-query `enabled` flag. Never
  // hoisted to always-on and hidden visually — the register must not reach a
  // browser that has no financial standing.
  const query = useMissionsFinanceSummary(queryEnabled);
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = query;
  const foregroundRef = useRef(foreground);
  const queryEnabledRef = useRef(queryEnabled);
  const previousForeground = useRef(foreground);
  const exposureActive = useRef(
    typeof document === 'undefined'
      ? true
      : document.visibilityState === 'visible' &&
          (typeof document.hasFocus !== 'function' || document.hasFocus()),
  );
  const rewitnessingRef = useRef(false);
  const requestRef = useRef(0);
  const [rewitnessing, setRewitnessing] = useState(false);

  foregroundRef.current = foreground;
  queryEnabledRef.current = queryEnabled;
  const enteredForeground = foreground && !previousForeground.current;

  const rewitness = useCallback(() => {
    if (!foregroundRef.current || !queryEnabledRef.current || rewitnessingRef.current) return;
    const request = ++requestRef.current;
    rewitnessingRef.current = true;
    setRewitnessing(true);
    void refetch().finally(() => {
      if (request !== requestRef.current) return;
      rewitnessingRef.current = false;
      setRewitnessing(false);
    });
  }, [refetch]);

  // useLayoutEffect makes cached content stale before the foreground frame is
  // painted. A regular effect would leave one verified old-data frame.
  useLayoutEffect(() => {
    const wasForeground = previousForeground.current;
    previousForeground.current = foreground;
    if (!wasForeground && foreground) rewitness();
  }, [foreground, rewitness]);

  useEffect(() => {
    if (typeof document === 'undefined' || typeof window === 'undefined') return;

    const restoreExposure = () => {
      if (document.visibilityState !== 'visible' || exposureActive.current) return;
      exposureActive.current = true;
      rewitness();
    };
    const onBlur = () => {
      exposureActive.current = false;
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        exposureActive.current = false;
        return;
      }
      if (typeof document.hasFocus !== 'function' || document.hasFocus()) restoreExposure();
    };

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', restoreExposure);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', restoreExposure);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [rewitness]);

  useEffect(
    () => () => {
      // A force-close unmounts this module. Ignore any refetch completion that
      // was already in flight instead of scheduling state into a dead window.
      requestRef.current += 1;
      rewitnessingRef.current = false;
    },
    [],
  );

  const truth = useMemo(
    () =>
      missionFinanceTruthOf({
        canView,
        data,
        error,
        isLoading,
        isFetching: isFetching || rewitnessing || enteredForeground,
        dataUpdatedAt,
      }),
    [canView, data, error, isLoading, isFetching, rewitnessing, enteredForeground, dataUpdatedAt],
  );

  useEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  if (!canView) {
    return (
      <CollectionFrame title="Mission finance">
        <div data-truth="denied">
          <EmptyState data-testid="mission-finance-denied" message="Financial detail is unavailable for your role." />
        </div>
      </CollectionFrame>
    );
  }

  const rows = data?.missions ?? [];
  const countVisible = truth.kind === 'verified' || truth.kind === 'stale';

  const rowsView =
    data && rows.length > 0 ? (
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
                <Link to={linkToMission(m.missionId)} data-testid={`finance-link-${m.missionId}`}>
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
                  //
                  // K3 CLOSED (marker chapter; tone ruling 2026-07-28): the
                  //   owner-ruled amber rates warning rides the kit's
                  //   `.cell-note.warning.strong` — the cell-scale half of
                  //   the tone family, emphasis as the ruled weight axis.
                  //   TRUE byte-identity at this site: the old inline span
                  //   inherited the cell's 12px (it set no size), and the
                  //   class carries the SAME warning token and the SAME 600.
                  //   The amber treatment and the "rates missing: …" copy
                  //   remain OWNER-RULED (polish wave #5).
                  <span className="cell-note warning strong">rates missing: {m.missingRates.join(', ')}</span>
                )}
              </td>
              <td data-testid={`finance-outstanding-${m.missionId}`}>
                {m.outstandingIncomeCount > 0 ? `${m.outstandingIncomeCount} income` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </ComparisonTable>
    ) : null;

  const errorView = (
    <ErrorState
      message={error instanceof ApiError ? error.message : 'Could not load mission finance.'}
      correlationId={error instanceof ApiError ? error.correlationId : undefined}
    />
  );

  const truthView = (() => {
    switch (truth.kind) {
      case 'loading':
        return (
          <div data-truth="loading">
            <LoadingState label="Loading mission finance…" />
          </div>
        );
      case 'denied':
        return <div data-truth="denied">{errorView}</div>;
      case 'fetch-failed':
        // Exact legacy no-data failure surface; only its truth artifact is new.
        return <div data-truth="fetch-failed">{errorView}</div>;
      case 'proven-empty':
        return (
          <div data-truth="proven-empty">
            <EmptyState data-testid="mission-finance-empty" message="No missions yet." />
          </div>
        );
      case 'verified':
        return <div data-truth="verified">{rowsView}</div>;
      case 'stale':
        return (
          <div data-truth="stale">
            <p className="boundary-note" role="status">
              Showing the last verified finance view while it is checked again. Treat it as stale.
            </p>
            {rows.length === 0 ? <EmptyState data-testid="mission-finance-empty" message="No missions yet." /> : rowsView}
          </div>
        );
    }
  })();

  return (
    <CollectionFrame
      kicker="Finance"
      title="Mission finance"
      count={data && countVisible ? `${rows.length} mission${rows.length === 1 ? '' : 's'}` : undefined}
    >
      {truthView}
    </CollectionFrame>
  );
}
