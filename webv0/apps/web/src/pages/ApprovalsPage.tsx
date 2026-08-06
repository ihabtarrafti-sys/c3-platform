import { useEffect, useMemo, type ReactNode } from 'react';
import type { ApprovalSummaryDto } from '@c3web/api-contracts';
import { useApprovals } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  RecordLink,
  truthStateOf,
  type WitnessState,
} from '../tablework';
import { useForegroundRewitness } from '../tablework/useForegroundRewitness';
import {
  approvalAuthorityActionOf,
  approvalCapabilityLineOf,
  approvalAuthorityCountsOf,
  approvalAuthorityStageOf,
} from '../tablework/approvalAuthority';
import { approvalStatusOf, operationOf } from '../labels';
import '../tablework/authority-relay.css';

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
  const counts = approvalAuthorityCountsOf(rows);
  const currentlyWitnessed = truth.kind === 'verified';
  const capabilityLine = approvalCapabilityLineOf({
    canSubmitApproval: me?.capabilities.canSubmitApproval ?? false,
    canReviewApproval: me?.capabilities.canReviewApproval ?? false,
    canExecuteApproval: me?.capabilities.canExecuteApproval ?? false,
  });

  const when = (value: string | null): ReactNode => {
    if (!value) return 'not recorded';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : <time dateTime={value}>{date.toLocaleString()}</time>;
  };

  const rowsView =
    data && rows.length > 0 ? (
      <div className="authority-relay" data-testid="authority-relay">
        <header className="authority-relay-intro">
          <span className="authority-relay-mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>
            <small>Request → decision → execution</small>
            <strong>Authority Relay</strong>
            <p>Organization-wide approvals shown beside the current work. This view does not infer that a request belongs to the open mission.</p>
          </span>
        </header>

        <div className="authority-relay-counts" aria-label="Approval stage counts">
          <span data-authority-count="review"><strong>{counts.review}</strong><small>Review required</small></span>
          <span data-authority-count="decision"><strong>{counts.decision}</strong><small>Decision required</small></span>
          <span data-authority-count="execution"><strong>{counts.execution}</strong><small>Execution required</small></span>
          <span data-authority-count="execution-failed"><strong>{counts.executionFailed}</strong><small>Execution failed</small></span>
          <span data-authority-count="closed"><strong>{counts.closed}</strong><small>Closed records</small></span>
        </div>

        <p className="authority-relay-standing" data-testid="authority-session-standing">
          <strong>Effective standing</strong>
          <span>{capabilityLine}</span>
        </p>

        <ol className="authority-relay-records" aria-label="Approvals authority relay" data-testid="approvals-table">
          {rows.map((a) => {
            const st = approvalStatusOf(a.status);
            const stage = approvalAuthorityStageOf(a);
            const authority = approvalAuthorityActionOf(
              a,
              {
                identity: me?.identity,
                canReviewApproval: me?.capabilities.canReviewApproval ?? false,
                canExecuteApproval: me?.capabilities.canExecuteApproval ?? false,
              },
              currentlyWitnessed,
            );
            const sessionLine = authority.reason === 'self'
              ? 'Another authorized person must act on this session\'s request.'
              : authority.reason === 'indeterminate'
                ? 'Actor distinction is unverified; no authority is claimed.'
                : authority.reason === 'not-current'
                  ? 'The register is being rechecked; no action is claimed.'
                  : authority.action === 'begin-review'
                    ? 'This session holds review standing; the detail rechecks the current approval before offering action.'
                    : authority.action === 'decide'
                      ? 'This session holds decision standing; the detail rechecks the current approval before offering action.'
                      : authority.action === 'execute'
                        ? 'This session holds execution standing; the detail rechecks the current approval before offering action.'
                        : 'No action is available to this session at this stage.';
            return (
              <li
                key={a.approvalId}
                data-testid={`approval-row-${a.approvalId}`}
                data-authority-stage={stage.stage}
              >
                <span className="authority-relay-line" aria-hidden="true"><i /></span>
                <span className="authority-relay-record-head">
                  <span>
                    <small>{stage.step} · {a.approvalId}</small>
                    <strong>{operationOf(a.operationType)}</strong>
                  </span>
                  <StatusBadge variant={st.variant} data-testid={`approval-status-${a.approvalId}`}>
                    {st.label}
                  </StatusBadge>
                </span>

                <span className="authority-relay-completion">
                  <strong>{stage.headline}</strong>
                  <span>{stage.detail}</span>
                </span>

                <dl className="authority-relay-provenance">
                  <div>
                    <dt>Requested by</dt>
                    <dd>{a.submittedBy}<small>{when(a.submittedAt)}</small></dd>
                  </div>
                  <div>
                    <dt>Review / decision record</dt>
                    <dd>{a.reviewedBy ?? 'not recorded'}<small>{when(a.reviewedAt)}</small></dd>
                  </div>
                  <div>
                    <dt>Execution record</dt>
                    <dd>{a.executedAt ? 'Recorded' : 'not recorded'}<small>{when(a.executedAt)}</small></dd>
                  </div>
                </dl>

                <span className="authority-relay-session" data-testid={`approval-authority-${a.approvalId}`}>
                  {sessionLine}
                </span>
                <RecordLink to={`/approvals/${a.approvalId}`}>Open record →</RecordLink>
              </li>
            );
          })}
        </ol>

        <p className="authority-relay-boundary">
          Approval summaries are payload-free. Executor identity is not present here; it is shown only when the approval&rsquo;s event history is successfully witnessed.
        </p>
        <p className="collection-count">
          {rows.length} {rows.length === 1 ? 'approval' : 'approvals'}
        </p>
      </div>
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
              {isFetching || rewitnessing
                ? 'Showing the last verified approvals view while a new check is in progress.'
                : `Showing the last verified approvals view because the latest check failed: ${truth.message}`}{' '}
              Treat it as stale; no action is claimed here.
            </p>
            {rows.length === 0 ? (
              <EmptyState
                data-testid="approvals-empty"
                message="The last verified approvals view was empty; the current register is not yet known."
              />
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
