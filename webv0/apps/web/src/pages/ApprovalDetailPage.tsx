import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, makeStyles } from '@fluentui/react-components';
import { useApproval, useApprovalEvents } from '../queries';
import { ApiError, type ApprovalDto } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { DefinitionList, type DefItem } from '../components/DefinitionList';
import { StatusBadge } from '../components/StatusBadge';
import { AuditTimeline, type TimelineEntry } from '../components/AuditTimeline';
import { ErrorState, LoadingState } from '../components/states';
import { GovernedAction } from '../components/GovernedAction';
import { approvalStatusOf, operationOf } from '../labels';

const useStyles = makeStyles({
  section: { marginTop: '32px' },
  h2: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, color: 'var(--c3-command-black)', margin: '0 0 12px' },
  decision: {
    marginTop: '24px',
    padding: '16px',
    border: '1px solid var(--c3-hairline)',
    borderRadius: 'var(--c3-radius)',
    backgroundColor: 'var(--c3-identity-white)',
    maxWidth: '640px',
  },
  decisionNote: { fontSize: '12.5px', color: 'var(--c3-ink-50)', marginBottom: '12px' },
  decisionRow: { display: 'flex', columnGap: '10px', rowGap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' },
  ownNote: { fontSize: '13px', color: 'var(--c3-ink-70)', marginTop: '16px', maxWidth: '640px' },
  idLink: { fontFamily: 'var(--c3-font-mono)', fontSize: '13px', color: 'var(--c3-command-black)' },
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

  const crumbs = [{ label: 'Approvals', to: '/approvals' }, { label: approvalId }];

  if (isError) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <div>
        <PageHeader title={approvalId} breadcrumbs={<Breadcrumbs crumbs={crumbs} />} />
        <ErrorState
          data-testid="approval-error"
          message={is404 ? `No approval ${approvalId} in your tenant.` : 'Could not load this approval.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      </div>
    );
  }

  const a = data?.approval;
  const st = a ? approvalStatusOf(a.status) : null;
  const canReview = me?.capabilities.canReviewApproval ?? false;
  const canExecute = me?.capabilities.canExecuteApproval ?? false;
  const isOwnRequest = a ? me?.identity === a.submittedBy : false;
  const actionable = !isOwnRequest;

  const entries: TimelineEntry[] = (events.data?.events ?? []).map((e) => {
    const to = approvalStatusOf(e.toStatus).label;
    const from = e.fromStatus ? approvalStatusOf(e.fromStatus).label : null;
    return { at: e.at, label: from ? `${from} → ${to}` : to, actor: e.actor, detail: e.note };
  });

  const items: DefItem[] = a
    ? [
        {
          label: 'Status',
          value: (
            <StatusBadge variant={st!.variant} data-testid="approval-detail-status">
              {st!.label}
            </StatusBadge>
          ),
        },
        { label: 'Operation', value: operationOf(a.operationType) },
        // The subject row narrows on the payload discriminant: AddPerson shows
        // the person name (testid preserved for E2E); member operations show
        // the subject member's email; credential operations show the
        // credential subject with its owning person.
        ...(a.payload.operationType === 'AddPerson'
          ? [{ label: 'New person', value: <span data-testid="approval-fullname">{a.payload.input.fullName}</span> }]
          : a.payload.operationType === 'AddCredential'
            ? [{ label: 'Credential', value: <span data-testid="approval-credential-subject">{`${a.payload.input.credentialType} for ${a.payload.input.personId}`}</span> }]
            : a.payload.operationType === 'DeactivateCredential'
              ? [{ label: 'Credential', value: <span data-testid="approval-credential-subject">{`${a.payload.input.credentialId} (${a.payload.input.personId})`}</span> }]
              : a.payload.operationType === 'InitiateJourney'
                ? [{ label: 'Journey', value: <span data-testid="approval-journey-subject">{`${a.payload.input.journeyType} for ${a.payload.input.personId}`}</span> }]
                : a.payload.operationType === 'AddMissionParticipant'
                  ? [{ label: 'Participant', value: <span data-testid="approval-participant-subject">{`${a.payload.input.personId} as ${a.payload.input.role} on ${a.payload.input.missionId}`}</span> }]
                  : a.payload.operationType === 'RemoveMissionParticipant'
                    ? [{ label: 'Participant', value: <span data-testid="approval-participant-subject">{`Remove ${a.payload.input.personId} from ${a.payload.input.missionId}`}</span> }]
                    : a.payload.operationType === 'AddAgreement'
                      ? [{ label: 'Agreement', value: <span data-testid="approval-agreement-subject">{`${a.payload.input.agreementType} for ${a.payload.input.personId}`}</span> }]
                      : a.payload.operationType === 'RenewAgreement'
                        ? [{ label: 'Agreement', value: <span data-testid="approval-agreement-subject">{`Renew ${a.payload.input.agreementId} to ${a.payload.input.newEndsOn}`}</span> }]
                        : a.payload.operationType === 'TerminateAgreement'
                          ? [{ label: 'Agreement', value: <span data-testid="approval-agreement-subject">{`Terminate ${a.payload.input.agreementId}`}</span> }]
                          : [{ label: 'Subject member', value: <span data-testid="approval-member-email">{a.payload.input.email}</span> }]),
        { label: 'Submitted by', value: a.submittedBy },
        { label: 'Reviewed by', value: a.reviewedBy ?? null },
        {
          label: 'Target person',
          value:
            a.status === 'Executed' && a.targetPersonId.startsWith('PER-') ? (
              <Link className={s.idLink} to={`/people/${a.targetPersonId}`} data-testid="created-person-link">
                {a.targetPersonId}
              </Link>
            ) : (
              a.targetPersonId || null
            ),
        },
      ]
    : [];
  if (a?.rejectionReason) items.push({ label: 'Rejection reason', value: a.rejectionReason });
  if (a?.executionError) items.push({ label: 'Execution error', value: a.executionError });

  const showDecision =
    !!a &&
    actionable &&
    ((canReview && (a.status === 'Submitted' || a.status === 'InReview')) ||
      (canExecute && (a.status === 'Approved' || a.status === 'ExecutionFailed')));

  return (
    <div>
      <PageHeader title={approvalId} breadcrumbs={<Breadcrumbs crumbs={crumbs} />} />
      {isLoading && <LoadingState label="Loading approval…" />}
      {a && st && (
        <>
          <DefinitionList items={items} />

          {isOwnRequest && canReview && (
            <p className={s.ownNote} data-testid="own-request-note">
              You submitted this request. Separation of duties requires someone other than the submitter to review and
              execute it.
            </p>
          )}

          {isOwnRequest && (a.status === 'Submitted' || a.status === 'InReview') && (
            <div className={s.decision}>
              <div className={s.decisionNote}>
                Changed your mind? You may withdraw your own request while it awaits a decision — nothing has happened
                yet, and withdrawal is recorded.
              </div>
              <div className={s.decisionRow}>
                <GovernedAction
                  triggerLabel="Withdraw my request…"
                  triggerTestId="withdraw"
                  triggerAppearance="secondary"
                  title={`Withdraw ${a.approvalId}?`}
                  description="This cancels your request permanently — it will not be reviewed or executed. Withdrawal is recorded in the approval history."
                  confirmLabel="Withdraw request"
                  onConfirm={() => run(() => api.withdrawApproval(a.approvalId, a.version), 'Request withdrawn and recorded.')}
                />
              </div>
            </div>
          )}

          {showDecision && (
            <div className={s.decision}>
              <div className={s.decisionNote}>Governed action — approval and execution are separate steps.</div>
              <div className={s.decisionRow}>
                {canReview && a.status === 'Submitted' && (
                  <Button
                    appearance="primary"
                    disabled={busy}
                    data-testid="begin-review"
                    onClick={() => run(() => api.beginReview(a.approvalId, a.version), 'Review started.')}
                  >
                    Begin review
                  </Button>
                )}
                {canReview && a.status === 'InReview' && (
                  <>
                    <GovernedAction
                      triggerLabel="Approve"
                      triggerTestId="approve"
                      title="Approve this request?"
                      description="Approving records your decision. It does not execute the change — execution is a separate step."
                      confirmLabel="Approve"
                      onConfirm={() => run(() => api.approve(a.approvalId, a.version), 'Approved.')}
                    />
                    <GovernedAction
                      triggerLabel="Reject"
                      triggerTestId="reject"
                      triggerAppearance="secondary"
                      title="Reject this request?"
                      description="Add a reason. This is recorded in the request’s history."
                      extra={
                        <Field label="Reason for rejection">
                          <Input value={reason} onChange={(_, d) => setReason(d.value)} data-testid="reject-reason" />
                        </Field>
                      }
                      confirmLabel="Reject"
                      confirmDisabled={reason.trim() === ''}
                      onConfirm={() => run(() => api.reject(a.approvalId, a.version, reason), 'Rejected.')}
                    />
                  </>
                )}
                {canExecute && (a.status === 'Approved' || a.status === 'ExecutionFailed') && (
                  <GovernedAction
                    triggerLabel={a.status === 'ExecutionFailed' ? 'Retry execute' : 'Execute'}
                    triggerTestId="execute"
                    title="Execute this approved request?"
                    description="This performs the approved change. Pending and executed are different states — this moves the request to executed."
                    confirmLabel="Execute"
                    onConfirm={() =>
                      run(async () => {
                        const res = await api.execute(a.approvalId, a.version);
                        notify('info', res.idempotent ? 'Already executed (idempotent).' : `Created ${res.person?.personId}.`);
                        return res;
                      }, 'Execution complete.')
                    }
                  />
                )}
              </div>
            </div>
          )}

          <div className={s.section}>
            <h2 className={s.h2}>History</h2>
            <AuditTimeline entries={entries} testId="approval-events" />
          </div>
        </>
      )}
    </div>
  );
}
