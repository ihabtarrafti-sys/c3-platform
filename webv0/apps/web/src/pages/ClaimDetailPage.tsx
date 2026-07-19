import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Field, Input, makeStyles } from '@fluentui/react-components';
import { useClaim, useClaimAudit } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { Breadcrumbs } from '../components/Breadcrumbs';
import { DefinitionList, type DefItem } from '../components/DefinitionList';
import { StatusBadge } from '../components/StatusBadge';
import { AuditTimeline, type TimelineEntry } from '../components/AuditTimeline';
import { DocumentsSection } from '../components/DocumentsSection';
import { ErrorState, LoadingState } from '../components/states';
import { GovernedAction } from '../components/GovernedAction';
import { auditActionOf, claimStatusOf, formatMinor, lineCategoryOf } from '../labels';

/**
 * Claim page (S9) — the definition of the expense, its receipts (S4
 * documents), the finance decisions (begin review / approve / reject with a
 * reason / pay with a bank LABEL), and the full history. The submitter can
 * never decide their own claim — the buttons say so by absence.
 */

const useStyles = makeStyles({
  section: { marginTop: '28px' },
  h2: { fontSize: '16px', fontWeight: 600, color: 'var(--c3-ink-default)', margin: '0 0 12px' },
  fields: { display: 'flex', flexDirection: 'column', rowGap: '8px', minWidth: '300px' },
  actions: { display: 'flex', columnGap: '8px', flexWrap: 'wrap' },
});

export function ClaimDetailPage() {
  const { claimId = '' } = useParams();
  const s = useStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const claim = useClaim(claimId);
  const audit = useClaimAudit(claimId);
  const [rejectReason, setRejectReason] = useState('');
  const [payLabel, setPayLabel] = useState('');
  const [payRef, setPayRef] = useState('');

  const c = claim.data?.claim;
  const isOwn = c ? me?.identity === c.submittedBy : false;
  const canDecide = (me?.capabilities.canDecideClaim ?? false) && !isOwn;

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['claim', claimId] });
    void qc.invalidateQueries({ queryKey: ['claims'] });
    void qc.invalidateQueries({ queryKey: ['claimAudit', claimId] });
  };

  async function run(fn: () => Promise<unknown>, message: string): Promise<void> {
    try {
      await fn();
      notify('success', message);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The action failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  const items: DefItem[] = c
    ? [
        { label: 'Claim', value: c.claimId, mono: true },
        { label: 'Submitted by', value: c.submittedBy },
        { label: 'Category', value: lineCategoryOf(c.category) },
        { label: 'Description', value: c.description },
        { label: 'Amount', value: <span data-testid="claim-amount">{formatMinor(c.amountMinor, c.currency)}</span> },
        { label: 'Expense date', value: c.expenseOn },
        {
          label: 'Status',
          value: (
            <StatusBadge variant={claimStatusOf(c.status).variant} data-testid="claim-detail-status">
              {claimStatusOf(c.status).label}
            </StatusBadge>
          ),
        },
        { label: 'Reviewed by', value: c.reviewedBy },
        { label: 'Rejection reason', value: c.rejectionReason },
        {
          label: 'Paid',
          value: c.paidOn ? `${c.paidOn} · ${c.paymentSourceLabel}${c.refNo ? ` · ${c.refNo}` : ''}` : null,
        },
      ]
    : [];

  const entries: TimelineEntry[] = (audit.data?.events ?? []).map((e) => ({
    at: e.at,
    label: auditActionOf(e.action),
    actor: e.actor,
  }));

  return (
    <div>
      <PageHeader
        kicker="Claim"
        title={claimId}
        breadcrumbs={<Breadcrumbs crumbs={[{ label: 'Claims', to: '/claims' }, { label: claimId }]} />}
        actions={
          c && canDecide ? (
            <div className={s.actions}>
              {c.status === 'Submitted' && (
                <GovernedAction
                  triggerLabel="Begin review"
                  triggerTestId="claim-begin-review"
                  title={`Review ${c.claimId}?`}
                  description="Marks the claim as in review — recorded."
                  confirmLabel="Begin review"
                  onConfirm={() => run(() => api.decideClaim(c.claimId, { expectedVersion: c.version, decision: 'beginReview' }), 'Review started.')}
                />
              )}
              {c.status === 'InReview' && (
                <>
                  <GovernedAction
                    triggerLabel="Approve"
                    triggerTestId="claim-approve"
                    title={`Approve ${c.claimId}?`}
                    description="Approving records the decision; paying is the separate final step."
                    confirmLabel="Approve claim"
                    onConfirm={() => run(() => api.decideClaim(c.claimId, { expectedVersion: c.version, decision: 'approve' }), 'Claim approved.')}
                  />
                  <GovernedAction
                    triggerLabel="Reject…"
                    triggerTestId="claim-reject"
                    triggerAppearance="secondary"
                    title={`Reject ${c.claimId}?`}
                    description="A reason is required and recorded in the claim's history."
                    extra={
                      <Field label="Reason for rejection" required>
                        <Input value={rejectReason} onChange={(_, d) => setRejectReason(d.value)} data-testid="claim-reject-reason" />
                      </Field>
                    }
                    confirmLabel="Reject claim"
                    confirmDisabled={rejectReason.trim() === ''}
                    onConfirm={() =>
                      run(() => api.decideClaim(c.claimId, { expectedVersion: c.version, decision: 'reject', reason: rejectReason.trim() }), 'Claim rejected (recorded).')
                    }
                  />
                </>
              )}
              {c.status === 'Approved' && (
                <GovernedAction
                  triggerLabel="Mark paid…"
                  triggerTestId="claim-pay"
                  title={`Pay ${c.claimId}?`}
                  description="Record the payment fact: bank LABEL only (never account numbers), plus the bank reference."
                  extra={
                    <div className={s.fields}>
                      <Field label="Payment source (bank LABEL)" required>
                        <Input value={payLabel} onChange={(_, d) => setPayLabel(d.value)} data-testid="claim-pay-label" />
                      </Field>
                      <Field label="Bank reference">
                        <Input value={payRef} onChange={(_, d) => setPayRef(d.value)} data-testid="claim-pay-ref" />
                      </Field>
                    </div>
                  }
                  confirmLabel="Mark paid"
                  confirmDisabled={payLabel.trim() === ''}
                  onConfirm={() =>
                    run(
                      () => api.payClaim(c.claimId, { expectedVersion: c.version, paymentSourceLabel: payLabel.trim(), refNo: payRef.trim() === '' ? null : payRef.trim() }),
                      'Claim paid and recorded.',
                    )
                  }
                />
              )}
            </div>
          ) : undefined
        }
      />

      {claim.isLoading && <LoadingState label="Loading claim…" />}
      {claim.isError && (
        <ErrorState
          message={
            claim.error instanceof ApiError && claim.error.status === 404
              ? `No claim ${claimId} in your tenant.`
              : claim.error instanceof ApiError && claim.error.status === 403
                ? 'This claim belongs to another submitter.'
                : 'Could not load this claim.'
          }
          correlationId={claim.error instanceof ApiError ? claim.error.correlationId : undefined}
        />
      )}

      {c && (
        <>
          <DefinitionList items={items} />
          {isOwn && c.status !== 'Rejected' && c.status !== 'Paid' && (
            <p data-testid="claim-own-note" style={{ fontSize: '13px', color: 'var(--c3-ink-quiet)' }}>
              This is your claim — someone else with finance standing decides it. Attach the receipt below.
            </p>
          )}
          <DocumentsSection ownerType="Claim" ownerId={c.claimId} canManage={me?.capabilities.canSubmitApproval ?? false} />
          <section className={s.section}>
            <h2 className={s.h2}>History</h2>
            <AuditTimeline entries={entries} testId="claim-audit" emptyMessage="No events recorded yet." />
          </section>
        </>
      )}
    </div>
  );
}
