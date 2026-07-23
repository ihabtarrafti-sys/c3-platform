import { Link } from 'react-router-dom';
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
} from '../tablework';
import { approvalStatusOf, operationOf } from '../labels';

export function ApprovalsPage() {
  return (
    <TableworkPage record="Approvals" section="Register" wide>
      <ApprovalsRegister />
    </TableworkPage>
  );
}

function ApprovalsRegister() {
  const { me } = useSession();
  const canView = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const { data, isLoading, isError, error } = useApprovals(canView);

  if (!canView) {
    return (
      <CollectionFrame title="Approvals">
        <div className="record-quiet" data-testid="approvals-denied">
          Your role doesn&rsquo;t include access to this area.
        </div>
      </CollectionFrame>
    );
  }

  return (
    <CollectionFrame
      kicker="Register"
      title="Approvals"
      count={data ? `${data.approvals.length} in this view` : undefined}
    >
      {isLoading && <LoadingState label="Loading approvals…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load approvals.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.approvals.length === 0 && (
        <EmptyState data-testid="approvals-empty" message="No approvals in this view." />
      )}
      {data && data.approvals.length > 0 && (
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
              {data.approvals.map((a) => {
                const st = approvalStatusOf(a.status);
                return (
                  <tr key={a.approvalId} data-testid={`approval-row-${a.approvalId}`}>
                    <td>
                      <Link className="mono" to={`/approvals/${a.approvalId}`}>
                        {a.approvalId}
                      </Link>
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
            {data.approvals.length} {data.approvals.length === 1 ? 'approval' : 'approvals'}
          </p>
        </>
      )}
    </CollectionFrame>
  );
}
