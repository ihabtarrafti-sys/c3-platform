import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  Field,
  Input,
  MessageBar,
  MessageBarBody,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableHeaderCell,
  TableRow,
  Text,
  Title2,
  makeStyles,
  tokens,
} from '@fluentui/react-components';
import { useApproval, useApprovalEvents } from '../queries';
import { ApiError, type ApprovalDto } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';

const useStyles = makeStyles({
  back: { marginBottom: '12px', display: 'inline-block' },
  card: { display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '8px 24px', padding: '20px', maxWidth: '620px', margin: '12px 0 20px' },
  label: { color: tokens.colorNeutralForeground3 },
  actions: { display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '20px' },
  note: { color: tokens.colorNeutralForeground3, marginBottom: '16px' },
});

export function ApprovalDetailPage() {
  const s = useStyles();
  const { approvalId = '' } = useParams();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useApproval(approvalId);
  const events = useApprovalEvents(approvalId);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<{ approval: ApprovalDto } | unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      notify('success', success);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['approval', approvalId] }),
        qc.invalidateQueries({ queryKey: ['approvalEvents', approvalId] }),
        qc.invalidateQueries({ queryKey: ['approvals'] }),
        qc.invalidateQueries({ queryKey: ['people'] }),
      ]);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) return <Spinner label="Loading approval..." />;
  if (isError) {
    return (
      <MessageBar intent={error instanceof ApiError && error.status === 404 ? 'warning' : 'error'}>
        <MessageBarBody data-testid="approval-error">
          {error instanceof ApiError && error.status === 404 ? `No approval ${approvalId} in your tenant.` : 'Could not load this approval.'}
        </MessageBarBody>
      </MessageBar>
    );
  }
  if (!data) return null;

  const a = data.approval;
  const canReview = me?.capabilities.canReviewApproval ?? false;
  const canExecute = me?.capabilities.canExecuteApproval ?? false;
  const isOwnRequest = me?.identity === a.submittedBy;
  const actionable = !isOwnRequest;

  return (
    <div>
      <Link to="/approvals" className={s.back}>
        &larr; Approvals
      </Link>
      <Title2>{a.approvalId}</Title2>

      <Card className={s.card}>
        <Text className={s.label}>Status</Text>
        <Badge appearance="filled" data-testid="approval-detail-status">
          {a.status}
        </Badge>
        <Text className={s.label}>Operation</Text>
        <Text>{a.operationType}</Text>
        <Text className={s.label}>New person</Text>
        <Text data-testid="approval-fullname">{a.payload.input.fullName}</Text>
        <Text className={s.label}>Submitted by</Text>
        <Text>{a.submittedBy}</Text>
        <Text className={s.label}>Reviewed by</Text>
        <Text>{a.reviewedBy ?? '-'}</Text>
        <Text className={s.label}>Target person</Text>
        <Text>
          {a.status === 'Executed' && a.targetPersonId.startsWith('PER-') ? (
            <Link to={`/people/${a.targetPersonId}`} data-testid="created-person-link">
              {a.targetPersonId}
            </Link>
          ) : (
            a.targetPersonId
          )}
        </Text>
        {a.rejectionReason && (
          <>
            <Text className={s.label}>Rejection reason</Text>
            <Text>{a.rejectionReason}</Text>
          </>
        )}
        {a.executionError && (
          <>
            <Text className={s.label}>Execution error</Text>
            <Text>{a.executionError}</Text>
          </>
        )}
      </Card>

      {isOwnRequest && canReview && (
        <Text className={s.note} data-testid="own-request-note">
          You submitted this request. Separation of duties requires a different owner to review and execute it.
        </Text>
      )}

      <div className={s.actions}>
        {actionable && canReview && a.status === 'Submitted' && (
          <Button appearance="primary" disabled={busy} data-testid="begin-review" onClick={() => run(() => api.beginReview(a.approvalId, a.version), 'Review started.')}>
            Begin review
          </Button>
        )}
        {actionable && canReview && a.status === 'InReview' && (
          <>
            <Button appearance="primary" disabled={busy} data-testid="approve" onClick={() => run(() => api.approve(a.approvalId, a.version), 'Approved.')}>
              Approve
            </Button>
            <Field label="Rejection reason">
              <Input value={reason} onChange={(_, d) => setReason(d.value)} data-testid="reject-reason" />
            </Field>
            <Button disabled={busy || reason.trim() === ''} data-testid="reject" onClick={() => run(() => api.reject(a.approvalId, a.version, reason), 'Rejected.')}>
              Reject
            </Button>
          </>
        )}
        {actionable && canExecute && (a.status === 'Approved' || a.status === 'ExecutionFailed') && (
          <Button
            appearance="primary"
            disabled={busy}
            data-testid="execute"
            onClick={() =>
              run(async () => {
                const res = await api.execute(a.approvalId, a.version);
                notify('info', res.idempotent ? 'Already executed (idempotent).' : `Created ${res.person?.personId}.`);
                return res;
              }, 'Execution complete.')
            }
          >
            {a.status === 'ExecutionFailed' ? 'Retry execute' : 'Execute'}
          </Button>
        )}
      </div>

      <Title2>History</Title2>
      {events.data && events.data.events.length > 0 ? (
        <Table aria-label="Approval history" data-testid="approval-events">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>When</TableHeaderCell>
              <TableHeaderCell>Transition</TableHeaderCell>
              <TableHeaderCell>Actor</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.data.events.map((e, i) => (
              <TableRow key={i}>
                <TableCell>{new Date(e.at).toLocaleString()}</TableCell>
                <TableCell>{(e.fromStatus ?? 'start') + ' -> ' + e.toStatus}</TableCell>
                <TableCell>{e.actor}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <Text>No history.</Text>
      )}
    </div>
  );
}
