import { useEffect, useMemo } from 'react';
import type { ApprovalSummaryDto } from '@c3web/api-contracts';
import { useApprovals } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  RecordLink,
  truthStateOf,
  type WitnessState,
} from '../tablework';
import { useForegroundRewitness } from '../tablework/useForegroundRewitness';
import { approvalStatusOf, operationOf } from '../labels';

interface ApprovalsView {
  readonly approvals: ApprovalSummaryDto[];
}

export interface ApprovalsTruthFacts {
  readonly canView: boolean;
  readonly data: ApprovalsView | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

/** Approvals owns a witness independently from every other workspace window. */
export function approvalsTruthOf({
  canView,
  data,
  error,
  isLoading,
  isFetching,
  dataUpdatedAt,
}: ApprovalsTruthFacts): WitnessState {
  if (!canView) return { kind: 'denied', reasonClass: 'APPROVALS_UNAVAILABLE' };

  // Authentication and standing refusals revoke any cached register. They may
  // never fall through to stale-with-rows and briefly disclose old approvals.
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return { kind: 'denied', reasonClass: error.code || `HTTP_${error.status}` };
  }

  const base = truthStateOf(
    { data, error, isLoading, dataUpdatedAt },
    (view) => view.approvals.length === 0,
  );

  if (isFetching && data !== undefined && (base.kind === 'verified' || base.kind === 'proven-empty')) {
    return {
      kind: 'stale',
      verifiedAt: new Date(dataUpdatedAt > 0 ? dataUpdatedAt : 0),
      message: 'Approvals are being checked again.',
    };
  }

  return base;
}

export interface ApprovalsRegisterProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly onTruthChange?: (truth: WitnessState) => void;
}

export function ApprovalsPage() {
  return (
    <TableworkPage record="Approvals" section="Register" wide>
      <ApprovalsRegister />
    </TableworkPage>
  );
}

export function ApprovalsRegister({
  enabled = true,
  foreground = true,
  onTruthChange,
}: ApprovalsRegisterProps = {}) {
  const { me } = useSession();
  const canView = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const queryEnabled = enabled && canView;
  // Capability and module lifecycle jointly gate the wire. A hidden denial is
  // not permission to fetch, and a force-closed window owns no live query.
  const query = useApprovals(queryEnabled);
  const { data, isLoading, isFetching, error, dataUpdatedAt, refetch } = query;
  const rewitnessing = useForegroundRewitness({ foreground, enabled: queryEnabled, refetch });
  const truth = useMemo(
    () =>
      approvalsTruthOf({
        canView,
        data,
        error,
        isLoading,
        isFetching: isFetching || rewitnessing,
        dataUpdatedAt,
      }),
    [canView, data, error, isLoading, isFetching, rewitnessing, dataUpdatedAt],
  );

  useEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  if (!canView) {
    return (
      <CollectionFrame title="Approvals">
        <div data-truth="denied">
          <div className="record-quiet" data-testid="approvals-denied">
            Your role doesn&rsquo;t include access to this area.
          </div>
        </div>
      </CollectionFrame>
    );
  }

  const rows = data?.approvals ?? [];
  const countVisible = truth.kind === 'verified' || truth.kind === 'stale';

  const rowsView =
    data && rows.length > 0 ? (
      <>
        <ComparisonTable label="Approvals inbox" testId="approvals-table">
          <thead>
            <tr>
              <th>Approval</th>
              <th>Operation</th>
              <th>Status</th>
              <th>Submitted by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => {
              const st = approvalStatusOf(a.status);
              return (
                <tr key={a.approvalId} data-testid={`approval-row-${a.approvalId}`}>
                  <td>
                    <RecordLink to={`/approvals/${a.approvalId}`}>
                      {a.approvalId}
                    </RecordLink>
                  </td>
                  <td>{operationOf(a.operationType)}</td>
                  <td>
                    <StatusBadge variant={st.variant} data-testid={`approval-status-${a.approvalId}`}>
                      {st.label}
                    </StatusBadge>
                  </td>
                  <td>{a.submittedBy}</td>
                </tr>
              );
            })}
          </tbody>
        </ComparisonTable>
        <p className="collection-count">
          {rows.length} {rows.length === 1 ? 'approval' : 'approvals'}
        </p>
      </>
    ) : null;

  const errorView = (
    <ErrorState
      message={error instanceof ApiError ? error.message : 'Could not load approvals.'}
      correlationId={error instanceof ApiError ? error.correlationId : undefined}
    />
  );

  const truthView = (() => {
    switch (truth.kind) {
      case 'loading':
        return (
          <div data-truth="loading">
            <LoadingState label="Loading approvals…" />
          </div>
        );
      case 'denied':
        return <div data-truth="denied">{errorView}</div>;
      case 'fetch-failed':
        return <div data-truth="fetch-failed">{errorView}</div>;
      case 'proven-empty':
        return (
          <div data-truth="proven-empty">
            <EmptyState data-testid="approvals-empty" message="No approvals in this view." />
          </div>
        );
      case 'verified':
        return <div data-truth="verified">{rowsView}</div>;
      case 'stale':
        return (
          <div data-truth="stale">
            <p className="boundary-note" role="status">
              Showing the last verified approvals view while it is checked again. Treat it as stale.
            </p>
            {rows.length === 0 ? (
              <EmptyState data-testid="approvals-empty" message="No approvals in this view." />
            ) : (
              rowsView
            )}
          </div>
        );
    }
  })();

  return (
    <CollectionFrame
      kicker="Register"
      title="Approvals"
      count={data && countVisible ? `${rows.length} in this view` : undefined}
    >
      {truthView}
    </CollectionFrame>
  );
}
