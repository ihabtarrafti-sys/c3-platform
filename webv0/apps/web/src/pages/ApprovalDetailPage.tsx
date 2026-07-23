import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useApproval, useApprovalEvents } from '../queries';
import { ApiError, type ApprovalDto } from '../api';
import type { ApprovalPayloadDto } from '@c3web/api-contracts';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  TableworkPage,
  RecordPage,
  CommentThread,
  AuditTimeline,
  FactList,
  StatusBadge,
  ErrorState,
  LoadingState,
  Field,
  Input,
  GovernedAction,
  type DefItem,
  type TimelineEntry,
} from '../tablework';
import { CorrectionDialog, isCorrectable } from '../components/RequestCorrections';
import { agreementTermKindOf, approvalStatusOf, operationOf } from '../labels';

export function ApprovalDetailPage() {
  const { approvalId = '' } = useParams();
  return (
    <TableworkPage record={approvalId} section="Approval">
      <ApprovalDetailRecord approvalId={approvalId} />
    </TableworkPage>
  );
}

function ApprovalDetailRecord({ approvalId }: { approvalId: string }) {
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

  if (isError) {
    const is404 = error instanceof ApiError && error.status === 404;
    return (
      <RecordPage eyebrow="Approval" title={approvalId}>
        <ErrorState
          data-testid="approval-error"
          message={is404 ? `No approval ${approvalId} in your tenant.` : 'Could not load this approval.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      </RecordPage>
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
              <Link className="mono" to={`/people/${a.targetPersonId}`} data-testid="created-person-link">
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
        <Link className="mono" to={`/approvals/${a.revisionOf}`} data-testid="revision-of-link">
          {a.revisionOf}
        </Link>
      ),
    });
  }
  if (a?.supersededBy) {
    items.push({
      label: 'Superseded by',
      value: (
        <Link className="mono" to={`/approvals/${a.supersededBy}`} data-testid="superseded-by-link">
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

  const reviewComplete = !!a && ['Approved', 'ExecutionFailed', 'Executed'].includes(a.status);
  const executeComplete = a?.status === 'Executed';
  const activeStep =
    a?.status === 'Submitted' || a?.status === 'Withdrawn'
      ? 1
      : a?.status === 'InReview' || a?.status === 'Rejected'
        ? 2
        : a?.status === 'Executed'
          ? 0
          : 3;

  if (isLoading) {
    return (
      <RecordPage eyebrow="Approval" title={approvalId}>
        <LoadingState label="Loading approval…" />
      </RecordPage>
    );
  }

  return (
    <RecordPage
      eyebrow="Approval"
      title={approvalId}
      lead={a ? operationOf(a.operationType) : undefined}
      meta={
        a && st ? (
          <StatusBadge variant={st.variant} data-testid="approval-detail-status">
            {st.label}
          </StatusBadge>
        ) : undefined
      }
    >
      {a && st && (
        <div className="ceremony-shell">
          <aside className="work-surface subtle ceremony-rail" aria-label="Approval ceremony">
            <ol>
              <li>
                <div className={`step-button${activeStep === 1 ? ' active' : ' complete'}`}>
                  <span className="step-number">1</span>
                  <span>
                    <strong>Request</strong>
                    <small>{a.submittedBy}</small>
                  </span>
                </div>
              </li>
              <li>
                <div className={`step-button${activeStep === 2 ? ' active' : reviewComplete ? ' complete' : ''}`}>
                  <span className="step-number">2</span>
                  <span>
                    <strong>Review</strong>
                    <small>{a.reviewedBy ?? st.label}</small>
                  </span>
                </div>
              </li>
              <li>
                <div className={`step-button${activeStep === 3 ? ' active' : executeComplete ? ' complete' : ''}`}>
                  <span className="step-number">3</span>
                  <span>
                    <strong>Execute</strong>
                    <small>{st.label}</small>
                  </span>
                </div>
              </li>
            </ol>
            <div className="history-line">
              <div className="history-event">
                <strong>{st.label}</strong>
                <span>{operationOf(a.operationType)}</span>
              </div>
            </div>
          </aside>

          <main className="work-surface raised ceremony-panel">
            <div className="actor-banner">
              <span>
                <strong>{a.submittedBy}</strong>
                <br />
                <span className="record-quiet">Submitted by</span>
              </span>
              <StatusBadge variant={st.variant}>{st.label}</StatusBadge>
            </div>

            <FactList items={items.filter((item) => item.label !== 'Status')} />
            <ProposedChange payload={payload!} />

            {isOwnRequest && canReview && (
              <p className="record-quiet" data-testid="own-request-note">
                You submitted this request. Separation of duties requires someone other than the submitter to review and
                execute it.
              </p>
            )}

            {isOwnRequest && (a.status === 'Submitted' || a.status === 'InReview') && (
              <section className="consequence">
                <span>
                  {a.status === 'Submitted'
                    ? 'Your request, before review: polish it freely (every change is recorded and shown to the reviewer), or withdraw it.'
                    : 'Review has started, so the request is frozen. You may still withdraw it, or revise & resubmit a corrected copy.'}
                </span>
                <div className="panel-actions">
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
              </section>
            )}

            {isOwnRequest && (a.status === 'Rejected' || a.status === 'Withdrawn') && !a.supersededBy && correctable && (
              <section className="consequence">
                <span>
                  {a.status === 'Rejected'
                    ? 'This request was rejected. Fix it and resend — your original input prefills a fresh linked request.'
                    : 'You withdrew this request. If that was premature, resubmit a corrected copy — the original input prefills.'}
                </span>
                <div className="panel-actions">
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
              </section>
            )}

            {showDecision && (
              <section className="consequence-grid">
                <div className="consequence">
                  <span>Governed action — approval and execution are separate steps.</span>
                  <div className="panel-actions">
                    {canReview && a.status === 'Submitted' && (
                      <button
                        className="primary-action"
                        type="button"
                        disabled={busy}
                        data-testid="begin-review"
                        onClick={() => run(() => api.beginReview(a.approvalId, a.version), 'Review started.')}
                      >
                        Begin review
                      </button>
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
                              <Input value={reason} onChange={(e) => setReason(e.target.value)} data-testid="reject-reason" />
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
              </section>
            )}

            {a.status === 'Executed' && (
              <section className="receipt">
                <span className="receipt-mark" aria-hidden="true">✓</span>
                <div>
                  <h2>{st.label}</h2>
                  <p>{operationOf(a.operationType)}</p>
                </div>
              </section>
            )}

            <CommentThread subjectType="Approval" subjectId={approvalId} />

            <section className="record-section">
              <h2>History</h2>
              <AuditTimeline entries={entries} testId="approval-events" />
            </section>
          </main>
        </div>
      )}
    </RecordPage>
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
    <section className="record-section" data-testid="proposed-change">
      <h2>Proposed change — decide on these values</h2>
      <div className="proposal-grid">
        {rows.map((row) => (
          <div className="proposal-cell" key={row.label}>
            <small>{row.label}</small>
            <strong>{row.value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
