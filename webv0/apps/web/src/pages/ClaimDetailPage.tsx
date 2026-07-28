import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useClaim, useClaimAudit } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
// The pivot (Wave 2, Lane B): the import path IS the conversion for the
// cross-cutting pieces; FactList replaces DefinitionList (same items API).
// Breadcrumbs do NOT port — and on THIS screen the crumb was the only
// in-page route back to the register, so RecordBackLink is mandatory
// (ruling #5), not decoration.
import {
  TableworkPage,
  RecordBackLink,
  RecordPage,
  FactList,
  StatusBadge,
  AuditTimeline,
  DocumentsSection,
  ErrorState,
  LoadingState,
  Field,
  Input,
  GovernedAction,
  type DefItem,
  type TimelineEntry,
} from '../tablework';
import { auditActionOf, claimStatusOf, formatMinor, lineCategoryOf } from '../labels';

/**
 * Claim page (S9) — the definition of the expense, its receipts (S4
 * documents), the finance decisions (begin review / approve / reject with a
 * reason / pay with a bank LABEL), and the full history. The submitter can
 * never decide their own claim — the buttons say so by absence.
 */

export function ClaimDetailPage() {
  const { claimId = '' } = useParams();
  return (
    <TableworkPage record={claimId} section="Claim" actions={<RecordBackLink to="/claims">Back to claims</RecordBackLink>}>
      <ClaimDetailRecord claimId={claimId} />
    </TableworkPage>
  );
}

function ClaimDetailRecord({ claimId }: { claimId: string }) {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const claim = useClaim(claimId);
  const audit = useClaimAudit(claimId);
  const [rejectReason, setRejectReason] = useState('');
  const [payLabel, setPayLabel] = useState('');
  const [payRef, setPayRef] = useState('');

  const c = claim.data?.claim;
  // The separation law is enforced by NOT RENDERING: a submitter never sees a
  // decision control on their own claim, and the spec asserts count 0.
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
          // Bank data law: the payment fact carries the bank LABEL, never an
          // account number.
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
    <RecordPage
      eyebrow="Claim"
      title={claimId}
      documentTitle={claimId}
      actions={
        c && canDecide ? (
          <>
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
                      <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} data-testid="claim-reject-reason" />
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
                  <>
                    <Field label="Payment source (bank LABEL)" required>
                      <Input value={payLabel} onChange={(e) => setPayLabel(e.target.value)} data-testid="claim-pay-label" />
                    </Field>
                    <Field label="Bank reference">
                      <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} data-testid="claim-pay-ref" />
                    </Field>
                  </>
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
          </>
        ) : undefined
      }
    >
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
          <FactList items={items} />
          {isOwn && c.status !== 'Rejected' && c.status !== 'Paid' && (
            <p className="record-quiet" data-testid="claim-own-note">
              This is your claim — someone else with finance standing decides it. Attach the receipt below.
            </p>
          )}
          <DocumentsSection ownerType="Claim" ownerId={c.claimId} canManage={me?.capabilities.canSubmitApproval ?? false} />
          <section className="record-section">
            <h2>History</h2>
            {/* F04 (instance 21): a denied or failed history fetch surfaces —
                an empty timeline is a CLAIM about what happened here. */}
            {audit.isError ? (
              <ErrorState data-testid="claim-audit-error" message="The history could not be loaded — what happened here may not be shown." correlationId={audit.error instanceof ApiError ? audit.error.correlationId : undefined} />
            ) : (
              <AuditTimeline entries={entries} testId="claim-audit" emptyMessage="No events recorded yet." />
            )}
          </section>
        </>
      )}
    </RecordPage>
  );
}
