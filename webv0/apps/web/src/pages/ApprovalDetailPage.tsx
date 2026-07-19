import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input, makeStyles } from '@fluentui/react-components';
import { useApproval, useApprovalEvents } from '../queries';
import { ApiError, type ApprovalDto } from '../api';
import type { ApprovalPayloadDto } from '@c3web/api-contracts';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { DefinitionList, type DefItem } from '../components/DefinitionList';
import { StatusBadge } from '../components/StatusBadge';
import { AuditTimeline, type TimelineEntry } from '../components/AuditTimeline';
import { CommentThread } from '../components/CommentThread';
import { ErrorState, LoadingState } from '../components/states';
import { GovernedAction } from '../components/GovernedAction';
import { CorrectionDialog, isCorrectable } from '../components/RequestCorrections';
import { agreementTermKindOf, approvalStatusOf, operationOf } from '../labels';

const useStyles = makeStyles({
  section: { marginTop: '32px' },
  h2: { fontSize: '20px', lineHeight: '28px', fontWeight: 600, color: 'var(--c3-ink-strong)', margin: '0 0 12px' },
  decision: {
    marginTop: '24px',
    padding: '16px',
    border: '1px solid var(--c3-border-subtle)',
    borderRadius: 'var(--c3-radius)',
    backgroundColor: 'var(--c3-surface-base)',
    maxWidth: '640px',
  },
  decisionNote: { fontSize: '12.5px', color: 'var(--c3-ink-quiet)', marginBottom: '12px' },
  decisionRow: { display: 'flex', columnGap: '10px', rowGap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' },
  ownNote: { fontSize: '13px', color: 'var(--c3-ink-muted)', marginTop: '16px', maxWidth: '640px' },
  idLink: { fontFamily: 'var(--c3-font-mono)', fontSize: '13px', color: 'var(--c3-ink-strong)' },
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
  // H-01: the wire payload is ROLE-PROJECTED — keys beyond this caller's
  // PII/financial standing are ABSENT. One cast to the full union for
  // narrowing; optional access treats withheld keys as absent, which is
  // exactly the truth the projection states.
  const payload = a ? (a.payload as unknown as ApprovalPayloadDto) : null;
  const st = a ? approvalStatusOf(a.status) : null;
  const canReview = me?.capabilities.canReviewApproval ?? false;
  const canExecute = me?.capabilities.canExecuteApproval ?? false;
  const isOwnRequest = a ? me?.identity === a.submittedBy : false;
  const actionable = !isOwnRequest;
  const correctable = a ? isCorrectable(a.operationType) : false;

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
        ...(payload!.operationType === 'AddPerson'
          ? [{ label: 'New person', value: <span data-testid="approval-fullname">{payload!.input.fullName}</span> }]
          : payload!.operationType === 'AddCredential'
            ? [{ label: 'Credential', value: <span data-testid="approval-credential-subject">{`${payload!.input.credentialType} for ${payload!.input.personId}`}</span> }]
            : payload!.operationType === 'DeactivateCredential'
              ? [{ label: 'Credential', value: <span data-testid="approval-credential-subject">{`${payload!.input.credentialId} (${payload!.input.personId})`}</span> }]
              : payload!.operationType === 'ReactivateCredential'
                ? [{ label: 'Credential', value: <span data-testid="approval-credential-subject">{`Restore ${payload!.input.credentialId} — ${payload!.input.reason}`}</span> }]
              : payload!.operationType === 'InitiateJourney'
                ? [{ label: 'Journey', value: <span data-testid="approval-journey-subject">{`${payload!.input.journeyType} for ${payload!.input.personId}`}</span> }]
                : payload!.operationType === 'AddMissionParticipant'
                  ? [{ label: 'Participant', value: <span data-testid="approval-participant-subject">{`${payload!.input.personId} as ${payload!.input.role} on ${payload!.input.missionId}`}</span> }]
                  : payload!.operationType === 'RemoveMissionParticipant'
                    ? [{ label: 'Participant', value: <span data-testid="approval-participant-subject">{`Remove ${payload!.input.personId} from ${payload!.input.missionId}`}</span> }]
                    : payload!.operationType === 'AddAgreement'
                      ? [{ label: 'Agreement', value: <span data-testid="approval-agreement-subject">{`${payload!.input.agreementType} for ${payload!.input.personId ?? payload!.input.entityId}`}</span> }]
                      : payload!.operationType === 'RenewAgreement'
                        ? [{ label: 'Agreement', value: <span data-testid="approval-agreement-subject">{`Renew ${payload!.input.agreementId} to ${payload!.input.newEndsOn}`}</span> }]
                        : payload!.operationType === 'TerminateAgreement'
                          ? [{ label: 'Agreement', value: <span data-testid="approval-agreement-subject">{`Terminate ${payload!.input.agreementId}`}</span> }]
                          : payload!.operationType === 'AddAgreementTerm'
                            ? [{ label: 'Financial term', value: <span data-testid="approval-term-subject">{`Add ${agreementTermKindOf(payload!.input.kind)} to ${payload!.input.agreementId}`}</span> }]
                            : payload!.operationType === 'UpdateAgreementTerm'
                              ? [{ label: 'Financial term', value: <span data-testid="approval-term-subject">{`Change ${payload!.input.termId} on ${payload!.input.agreementId}`}</span> }]
                              : payload!.operationType === 'RemoveAgreementTerm'
                                ? [{ label: 'Financial term', value: <span data-testid="approval-term-subject">{`Remove ${payload!.input.termId} from ${payload!.input.agreementId}`}</span> }]
                                : payload!.operationType === 'ImportBatch'
                                  ? [{ label: 'Import batch', value: <span data-testid="approval-import-subject">{`Import ${payload!.input.rowCount} ${payload!.input.domain} from "${payload!.input.fileName}"`}</span> }]
                                  : payload!.operationType === 'UpdatePersonIdentity'
                                    ? [{ label: 'Identity change', value: <span data-testid="approval-person-subject">{`${payload!.input.personId}: ${Object.keys(payload!.input.patch).join(', ')}`}</span> }]
                                    : payload!.operationType === 'DeactivatePerson'
                                      ? [{ label: 'Lifecycle', value: <span data-testid="approval-person-subject">{`Deactivate ${payload!.input.personId} — ${payload!.input.reason}`}</span> }]
                                      : payload!.operationType === 'ReactivatePerson'
                                        ? [{ label: 'Lifecycle', value: <span data-testid="approval-person-subject">{`Reactivate ${payload!.input.personId} — ${payload!.input.reason}`}</span> }]
                                        : payload!.operationType === 'UpdateCredentialFacts'
                                          ? [{ label: 'Credential facts', value: <span data-testid="approval-credential-subject">{`${payload!.input.credentialId}: ${Object.keys(payload!.input.patch).join(', ')}`}</span> }]
                                          : payload!.operationType === 'AddBeneficiary'
                                            ? [{ label: 'Beneficiary', value: <span data-testid="approval-beneficiary-subject">{`"${payload!.input.label}" (${payload!.input.bankName}) for ${payload!.input.personId}`}</span> }]
                                            : payload!.operationType === 'UpdateBeneficiary'
                                              ? [{ label: 'Beneficiary', value: <span data-testid="approval-beneficiary-subject">{`Change ${payload!.input.beneficiaryId}: ${Object.keys(payload!.input.patch).join(', ')}`}</span> }]
                                              : payload!.operationType === 'RetireBeneficiary'
                                                ? [{ label: 'Beneficiary', value: <span data-testid="approval-beneficiary-subject">{`Retire ${payload!.input.beneficiaryId} — ${payload!.input.reason}`}</span> }]
                                                : [{ label: 'Subject member', value: <span data-testid="approval-member-email">{payload!.input.email}</span> }]),
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
  // Track B1: the corrections record — every pre-review polish is visible.
  if (a && a.editCount > 0) {
    items.push({
      label: 'Corrections',
      value: <StatusBadge variant="neutral" data-testid="edited-badge">{`Edited ×${a.editCount}`}</StatusBadge>,
    });
  }
  if (a?.revisionOf) {
    items.push({
      label: 'Revision of',
      value: (
        <Link className={s.idLink} to={`/approvals/${a.revisionOf}`} data-testid="revision-of-link">
          {a.revisionOf}
        </Link>
      ),
    });
  }
  if (a?.supersededBy) {
    items.push({
      label: 'Superseded by',
      value: (
        <Link className={s.idLink} to={`/approvals/${a.supersededBy}`} data-testid="superseded-by-link">
          {a.supersededBy}
        </Link>
      ),
    });
  }

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

          <ProposedChange payload={payload!} />

          {isOwnRequest && canReview && (
            <p className={s.ownNote} data-testid="own-request-note">
              You submitted this request. Separation of duties requires someone other than the submitter to review and
              execute it.
            </p>
          )}

          {isOwnRequest && (a.status === 'Submitted' || a.status === 'InReview') && (
            <div className={s.decision}>
              <div className={s.decisionNote}>
                {a.status === 'Submitted'
                  ? 'Your request, before review: polish it freely (every change is recorded and shown to the reviewer), or withdraw it.'
                  : 'Review has started, so the request is frozen. You may still withdraw it, or revise & resubmit a corrected copy.'}
              </div>
              <div className={s.decisionRow}>
                {a.status === 'Submitted' && correctable && (
                  <CorrectionDialog
                    mode="edit"
                    operationType={a.operationType}
                    originalInput={(payload!.input ?? {}) as Record<string, unknown>}
                    triggerTestId="edit-request"
                    onSubmit={(input) => run(() => api.editApproval(a.approvalId, a.version, input), 'Request edited — every change is on the record.')}
                  />
                )}
                {a.status === 'InReview' && correctable && (
                  <CorrectionDialog
                    mode="revise"
                    operationType={a.operationType}
                    originalInput={(payload!.input ?? {}) as Record<string, unknown>}
                    triggerTestId="revise-request"
                    onSubmit={(input) =>
                      run(async () => {
                        const res = await api.reviseApproval(a.approvalId, a.version, input);
                        notify('info', `Submitted ${res.approval.approvalId}, superseding ${res.superseded}.`);
                      }, 'Corrected request submitted.')
                    }
                  />
                )}
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

          {isOwnRequest && (a.status === 'Rejected' || a.status === 'Withdrawn') && !a.supersededBy && correctable && (
            <div className={s.decision}>
              <div className={s.decisionNote}>
                {a.status === 'Rejected'
                  ? 'This request was rejected. Fix it and resend — your original input prefills a fresh linked request.'
                  : 'You withdrew this request. If that was premature, resubmit a corrected copy — the original input prefills.'}
              </div>
              <div className={s.decisionRow}>
                <CorrectionDialog
                  mode="revise"
                  operationType={a.operationType}
                  originalInput={(payload!.input ?? {}) as Record<string, unknown>}
                  triggerTestId="revise-request"
                  onSubmit={(input) =>
                    run(async () => {
                      const res = await api.reviseApproval(a.approvalId, a.version, input);
                      notify('info', `Submitted ${res.approval.approvalId}, superseding ${res.superseded}.`);
                    }, 'Corrected request submitted.')
                  }
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
                        // Only name a created person when there is one — most
                        // operations (imports, agreements, journeys…) create
                        // something else or nothing; "Created undefined" lies.
                        if (res.idempotent) notify('info', 'Already executed (idempotent).');
                        else if (res.person) notify('info', `Created ${res.person.personId}.`);
                        return res;
                      }, 'Execution complete.')
                    }
                  />
                )}
              </div>
            </div>
          )}

          <CommentThread subjectType="Approval" subjectId={approvalId} />

          <div className={s.section}>
            <h2 className={s.h2}>History</h2>
            <AuditTimeline entries={entries} testId="approval-events" />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * ProposedChange (HARDEN-0, audit H-07) — the reviewer sees THE VALUES they
 * are deciding, rendered from the immutable payload snapshot. Keys the wire
 * projection withheld for this caller's role render as an explicit
 * "withheld for your role" — a blind decision is at least a VISIBLE one.
 */
function ProposedChange({ payload }: { payload: ApprovalPayloadDto }) {
  const withheld = <em data-testid="proposed-withheld">withheld for your role</em>;
  const v = (x: unknown): React.ReactNode => (x === undefined ? withheld : x === null || x === '' ? '—' : String(x));
  const money = (amountMinor: unknown, currency: unknown): React.ReactNode =>
    amountMinor === undefined ? withheld : `${(Number(amountMinor) / 100).toFixed(2)} ${typeof currency === 'string' ? currency : ''}`.trim();

  let rows: Array<{ label: string; value: React.ReactNode }> = [];
  switch (payload.operationType) {
    case 'AddPerson': {
      const i = payload.input;
      rows = [
        { label: 'Full name', value: v(i.fullName) },
        { label: 'Team / game', value: v([i.currentTeam, i.currentGameTitle].filter(Boolean).join(' · ') || null) },
        { label: 'Role / department', value: v([i.primaryRole, i.primaryDepartment].filter(Boolean).join(' · ') || null) },
      ];
      break;
    }
    case 'AddCredential': {
      const i = payload.input;
      rows = [
        { label: 'Person', value: v(i.personId) },
        { label: 'Type', value: v(i.credentialType) },
        { label: 'Issuer', value: v(i.issuer) },
        { label: 'Issued → expires', value: `${i.issuedOn} → ${i.expiresOn ?? 'no expiry'}` },
      ];
      break;
    }
    case 'DeactivateCredential':
      rows = [{ label: 'Credential', value: v(payload.input.credentialId) }, { label: 'Person', value: v(payload.input.personId) }];
      break;
    case 'InitiateJourney': {
      const i = payload.input;
      rows = [
        { label: 'Person', value: v(i.personId) },
        { label: 'Journey', value: v(i.journeyType) },
        { label: 'Title', value: v(i.title) },
        { label: 'Starts', value: v(i.startedOn) },
      ];
      break;
    }
    case 'AddMissionParticipant':
    case 'RemoveMissionParticipant':
      rows = [
        { label: 'Mission', value: v(payload.input.missionId) },
        { label: 'Person', value: v(payload.input.personId) },
        ...(payload.operationType === 'AddMissionParticipant' ? [{ label: 'Role', value: v(payload.input.role) }] : []),
      ];
      break;
    case 'AddAgreement': {
      const i = payload.input;
      rows = [
        { label: 'Type', value: v(i.agreementType) },
        { label: 'Party', value: v(i.personId ?? i.entityId) },
        { label: 'Window', value: `${i.startsOn} → ${i.endsOn ?? 'open'}` },
        { label: 'Value (USD cents)', value: v((i as Record<string, unknown>).valueUsdCents) },
      ];
      break;
    }
    case 'RenewAgreement':
      rows = [
        { label: 'Agreement', value: v(payload.input.agreementId) },
        { label: 'New end date', value: v(payload.input.newEndsOn) },
      ];
      break;
    case 'TerminateAgreement':
      rows = [
        { label: 'Agreement', value: v(payload.input.agreementId) },
        { label: 'Reason', value: v(payload.input.reason) },
      ];
      break;
    case 'AddAgreementTerm':
    case 'UpdateAgreementTerm': {
      const i = payload.input as Record<string, unknown>;
      rows = [
        { label: 'Agreement', value: v(i.agreementId) },
        ...('termId' in i ? [{ label: 'Term', value: v(i.termId) }] : []),
        { label: 'Kind', value: v(i.kind) },
        { label: 'Amount', value: money(i.amountMinor, i.currency) },
        { label: 'Percent (bps)', value: v(i.percentBps) },
        { label: 'Label', value: v(i.label) },
      ];
      break;
    }
    case 'RemoveAgreementTerm':
      rows = [
        { label: 'Agreement', value: v(payload.input.agreementId) },
        { label: 'Term', value: v(payload.input.termId) },
      ];
      break;
    case 'ImportBatch': {
      const i = payload.input as Record<string, unknown>;
      rows = [
        { label: 'Domain', value: v(i.domain) },
        { label: 'File', value: v(i.fileName) },
        { label: 'Rows', value: v(i.rowCount) },
        ...(i.domain === 'agreements' && i.agreements === undefined ? [{ label: 'Row contents', value: withheld }] : []),
      ];
      break;
    }
    case 'UpdatePersonIdentity': {
      const patch = payload.input.patch as Record<string, unknown>;
      rows = [
        { label: 'Person', value: v(payload.input.personId) },
        ...Object.entries(patch).map(([k, val]) => ({
          label: `New ${k}`,
          value: Array.isArray(val) ? val.join(' · ') : v(val),
        })),
        // the projection strips dateOfBirth for non-PII viewers — say so
        ...(!('dateOfBirth' in patch) ? [] : []),
      ];
      break;
    }
    case 'DeactivatePerson':
    case 'ReactivatePerson':
      rows = [
        { label: 'Person', value: v(payload.input.personId) },
        { label: 'Reason', value: v(payload.input.reason) },
      ];
      break;
    case 'UpdateCredentialFacts': {
      const patch = payload.input.patch as Record<string, unknown>;
      rows = [
        { label: 'Credential', value: v(payload.input.credentialId) },
        ...Object.entries(patch).map(([k, val]) => ({ label: `New ${k}`, value: v(val) })),
        // the projection strips documentNumber for non-PII viewers — name it
        ...('documentNumber' in patch ? [] : []),
      ];
      break;
    }
    case 'AddBeneficiary': {
      const i = payload.input;
      rows = [
        { label: 'Person', value: v(i.personId) },
        { label: 'Label', value: v(i.label) },
        { label: 'Bank', value: `${i.bankName} (${i.bankCountry})` },
        { label: 'Currency', value: v(i.currency) },
        { label: 'Payment type', value: v(i.paymentType) },
        { label: 'Registered with', value: v(i.registeredWithEntityId) },
      ];
      break;
    }
    case 'UpdateBeneficiary': {
      const patch = payload.input.patch as Record<string, unknown>;
      rows = [
        { label: 'Beneficiary', value: v(payload.input.beneficiaryId) },
        ...Object.entries(patch).map(([k, val]) => ({ label: `New ${k}`, value: v(val) })),
      ];
      break;
    }
    case 'RetireBeneficiary':
      rows = [
        { label: 'Beneficiary', value: v(payload.input.beneficiaryId) },
        { label: 'Reason', value: v(payload.input.reason) },
      ];
      break;
    default:
      rows = [{ label: 'Subject', value: v((payload as { input?: { email?: string } }).input?.email) }];
  }

  return (
    <div style={{ marginTop: 20, maxWidth: 640 }} data-testid="proposed-change">
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--c3-ink-muted)',
          marginBottom: 8,
        }}
      >
        Proposed change — decide on these values
      </div>
      <DefinitionList items={rows.map((r) => ({ label: r.label, value: r.value }))} />
    </div>
  );
}
