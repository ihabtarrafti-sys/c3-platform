import { Link } from 'react-router-dom';
import {
  Badge,
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
import { useApprovals } from '../queries';
import { ApiError } from '../api';
import { useSession } from '../session';

const useStyles = makeStyles({ muted: { color: tokens.colorNeutralForeground3 }, head: { marginBottom: '16px' } });

const STATUS_COLOR: Record<string, 'brand' | 'success' | 'danger' | 'warning' | 'informative'> = {
  Submitted: 'informative',
  InReview: 'brand',
  Approved: 'brand',
  Executed: 'success',
  Rejected: 'danger',
  ExecutionFailed: 'warning',
};

export function ApprovalsPage() {
  const s = useStyles();
  const { me } = useSession();
  const canView = (me?.capabilities.canSubmitApproval || me?.capabilities.canReviewApproval) ?? false;
  const { data, isLoading, isError, error } = useApprovals(canView);

  if (!canView) {
    return (
      <div>
        <Title2 className={s.head}>Approvals</Title2>
        <Text data-testid="approvals-denied" className={s.muted}>
          The approvals inbox is not available for your role.
        </Text>
      </div>
    );
  }

  return (
    <div>
      <Title2 className={s.head}>Approvals</Title2>
      {isLoading && <Spinner label="Loading approvals..." />}
      {isError && (
        <MessageBar intent="error">
          <MessageBarBody>{error instanceof ApiError ? error.message : 'Could not load approvals.'}</MessageBarBody>
        </MessageBar>
      )}
      {data && data.approvals.length === 0 && (
        <Text data-testid="approvals-empty" className={s.muted}>
          No approvals yet.
        </Text>
      )}
      {data && data.approvals.length > 0 && (
        <Table data-testid="approvals-table" aria-label="Approvals inbox">
          <TableHeader>
            <TableRow>
              <TableHeaderCell>Approval</TableHeaderCell>
              <TableHeaderCell>Operation</TableHeaderCell>
              <TableHeaderCell>Status</TableHeaderCell>
              <TableHeaderCell>Submitted by</TableHeaderCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.approvals.map((a) => (
              <TableRow key={a.approvalId} data-testid={`approval-row-${a.approvalId}`}>
                <TableCell>
                  <Link to={`/approvals/${a.approvalId}`}>{a.approvalId}</Link>
                </TableCell>
                <TableCell>{a.operationType}</TableCell>
                <TableCell>
                  <Badge appearance="tint" color={STATUS_COLOR[a.status] ?? 'informative'} data-testid={`approval-status-${a.approvalId}`}>
                    {a.status}
                  </Badge>
                </TableCell>
                <TableCell>{a.submittedBy}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
