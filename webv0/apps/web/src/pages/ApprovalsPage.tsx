import { Link } from 'react-router-dom';
import { makeStyles } from '@fluentui/react-components';
import { useApprovals } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge, type StatusVariant } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';

/** Approval status → human label + StatusBadge variant (D.4). Raw enum never renders. */
const STATUS: Record<string, { label: string; variant: StatusVariant }> = {
  Submitted: { label: 'Submitted', variant: 'pending' },
  InReview: { label: 'In review', variant: 'pending' },
  Approved: { label: 'Approved', variant: 'ready' },
  Rejected: { label: 'Rejected', variant: 'blocked' },
  Executed: { label: 'Executed', variant: 'ready' },
  ExecutionFailed: { label: 'Execution failed', variant: 'blocked' },
};

/** Operation type → human label (D.5). */
const OPERATION: Record<string, string> = { AddPerson: 'Add Person' };

const useStyles = makeStyles({ denied: { fontSize: '14px', color: 'var(--c3-ink-70)' } });

export function ApprovalsPage() {
  const r = useRegisterStyles();
  const s = useStyles();
  const { me } = useSession();
  const canView = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const { data, isLoading, isError, error } = useApprovals(canView);

  if (!canView) {
    return (
      <div>
        <PageHeader title="Approvals" />
        <div className={s.denied} data-testid="approvals-denied">
          Your role doesn&rsquo;t include access to this area.
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Approvals" context={data ? `${data.approvals.length} in this view` : undefined} />

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
          <table className={r.table} data-testid="approvals-table" aria-label="Approvals inbox">
            <thead>
              <tr>
                <th className={r.th}>Approval</th>
                <th className={r.th}>Operation</th>
                <th className={r.th}>Status</th>
                <th className={r.th}>Submitted by</th>
              </tr>
            </thead>
            <tbody>
              {data.approvals.map((a) => {
                const st = STATUS[a.status] ?? { label: a.status, variant: 'neutral' as StatusVariant };
                return (
                  <tr key={a.approvalId} className={r.row} data-testid={`approval-row-${a.approvalId}`}>
                    <td className={r.td}>
                      <Link className={r.idLink} to={`/approvals/${a.approvalId}`}>
                        {a.approvalId}
                      </Link>
                    </td>
                    <td className={`${r.td} ${r.name}`}>{OPERATION[a.operationType] ?? a.operationType}</td>
                    <td className={r.td}>
                      <StatusBadge variant={st.variant} data-testid={`approval-status-${a.approvalId}`}>
                        {st.label}
                      </StatusBadge>
                    </td>
                    <td className={r.td}>{a.submittedBy}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={r.count}>
            {data.approvals.length} {data.approvals.length === 1 ? 'approval' : 'approvals'}
          </div>
        </>
      )}
    </div>
  );
}
