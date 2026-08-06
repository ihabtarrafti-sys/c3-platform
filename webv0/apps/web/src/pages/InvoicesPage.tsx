import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useInvoices } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  RecordLink,
  StatusBadge,
  RecheckingTruthPanel,
  Field,
  Input,
  GovernedAction,
  isCurrentMoneyWitness,
  moneyActionsAvailable,
  moneyWitnessOf,
  type WitnessState,
} from '../tablework';
import { formatMinor, invoiceStatusOf } from '../labels';
import { useForegroundRewitness } from '../tablework/useForegroundRewitness';

/**
 * Invoices (S6) — the register of outward claims, on the Tablework frame
 * (pivot W2 Lane A; the Fluent page's behaviour, testids and copy verbatim).
 * Each invoice bills exactly one mission income line from one of the org's own
 * entities; numbers are a per-entity yearly series and are never reused (voids
 * keep their number — the gap IS the audit trail). Issuing happens from the
 * mission's P&L; here the paper is read, downloaded, and — with a reason —
 * voided.
 *
 * NOT a wide route (the Lane-A brief: agreements and entities take command
 * width, invoices does not).
 */
export function InvoicesPage() {
  return (
    <TableworkPage record="Invoices" section="Register">
      <InvoicesRegister />
    </TableworkPage>
  );
}

export interface InvoicesRegisterProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly requestKey?: string | number;
  readonly onTruthChange?: (truth: WitnessState) => void;
  readonly linkToMission?: (missionId: string) => string;
}

export function InvoicesRegister({
  enabled = true,
  foreground = true,
  requestKey,
  onTruthChange,
  linkToMission = (missionId) => `/missions/${missionId}`,
}: InvoicesRegisterProps = {}) {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canSee = me?.capabilities.canViewFinancials ?? false;
  const canAct = (me?.capabilities.canManageMissions ?? false) && canSee;
  // THE WIRE LAW: the capability IS the `enabled` flag — a denied role never
  // fetches the register, it does not fetch-and-hide.
  const queryEnabled = enabled && canSee;
  const query = useInvoices(queryEnabled);
  const rewitnessing = useForegroundRewitness({ foreground, enabled: queryEnabled, refetch: query.refetch, requestKey });
  const truth = useMemo(
    () =>
      moneyWitnessOf(
        {
          included: canSee,
          data: query.data,
          error: query.error,
          isLoading: query.isLoading,
          isFetching: query.isFetching || rewitnessing,
          dataUpdatedAt: query.dataUpdatedAt,
        },
        {
          isEmpty: (view) => view.invoices.length === 0,
          omittedReason: 'FINANCIALS_UNAVAILABLE',
          recheckMessage: 'The invoice register is being checked again.',
        },
      ),
    [canSee, query.data, query.dataUpdatedAt, query.error, query.isFetching, query.isLoading, rewitnessing],
  );
  const actionsCurrent = moneyActionsAvailable(canAct && enabled, truth, foreground);
  const invoices = query.data?.invoices ?? [];
  // Polish wave #11: the Actions column exists only while an Issued invoice
  // can still be acted on — a header over uniformly empty cells reads dead.
  const showActions = actionsCurrent && invoices.some((invoice) => invoice.status === 'Issued');
  const [voidReason, setVoidReason] = useState<Record<string, string>>({});

  useEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  useLayoutEffect(() => {
    if (!actionsCurrent) setVoidReason({});
  }, [actionsCurrent]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['invoices'] });
    void qc.invalidateQueries({ queryKey: ['missionPnl'] });
  };

  async function download(invoiceId: string, documentId: string) {
    try {
      const { blob, fileName } = await api.downloadDocument(documentId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : `The PDF for ${invoiceId} could not be downloaded.`);
    }
  }

  async function retryPdf(invoiceId: string) {
    if (!actionsCurrent) {
      notify('error', 'The invoice register must be current before paper can be generated.');
      return;
    }
    try {
      await api.retryInvoicePdf(invoiceId);
      notify('success', `The PDF for ${invoiceId} is stored.`);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The PDF could not be generated.');
    }
  }

  return (
    <CollectionFrame
      kicker="Register"
      title="Invoices"
      count={isCurrentMoneyWitness(truth) ? `${invoices.length} in this view` : undefined}
    >
      <RecheckingTruthPanel
        state={truth}
        rechecking={rewitnessing || (query.isFetching && query.error == null)}
        emptyLabel="No invoices yet. Issue one from a mission's P&L — any income line still Expected."
        testids={{
          loading: 'invoices-loading',
          empty: 'invoices-empty',
          denied: 'invoices-denied',
          failed: 'invoices-error',
          stale: 'invoices-stale',
        }}
      >
        <ComparisonTable label="Invoices register" testId="invoices-table">
          <thead>
            <tr>
              <th>Number</th>
              <th>Entity</th>
              <th>Mission</th>
              <th>Billed to</th>
              <th>Type of income</th>
              <th>Total</th>
              <th>Issued</th>
              <th>Status</th>
              <th>Paper</th>
              {showActions && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {invoices.map((inv) => (
              <tr key={inv.invoiceId} data-testid={`invoice-row-${inv.invoiceId}`}>
                <td className="mono" data-testid={`invoice-number-${inv.invoiceId}`}>
                  {inv.invoiceNumber}
                </td>
                <td>{inv.entityId}</td>
                <td>
                  <RecordLink to={linkToMission(inv.missionId)}>{inv.missionId}</RecordLink>
                </td>
                <td>{inv.billedToName}</td>
                <td>{inv.incomeCategory}</td>
                {/* formatMinor is formatMoney — code-first with a U+00A0 separator
                    ("USD 8,400.00", pinned by settlement.spec). No normalizing. */}
                <td className="mono" data-testid={`invoice-total-${inv.invoiceId}`}>
                  {formatMinor(inv.totalMinor, inv.currency)}
                </td>
                <td className="mono">{inv.issuedOn}</td>
                <td>
                  <StatusBadge
                    variant={invoiceStatusOf(inv.status).variant}
                    data-testid={`invoice-status-${inv.invoiceId}`}
                    title={inv.voidedReason ?? undefined}
                  >
                    {invoiceStatusOf(inv.status).label}
                  </StatusBadge>
                </td>
                <td>
                  {inv.documentId ? (
                    <button
                      className="mini-action"
                      type="button"
                      onClick={() => void download(inv.invoiceId, inv.documentId!)}
                      data-testid={`invoice-pdf-${inv.invoiceId}`}
                    >
                      PDF
                    </button>
                  ) : actionsCurrent && inv.status === 'Issued' ? (
                    <button
                      className="mini-action"
                      type="button"
                      onClick={() => void retryPdf(inv.invoiceId)}
                      data-testid={`invoice-pdf-retry-${inv.invoiceId}`}
                    >
                      Generate PDF
                    </button>
                  ) : (
                    '—'
                  )}
                </td>
                {showActions && (
                  <td>
                    {inv.status === 'Issued' && (
                      <GovernedAction
                        triggerLabel="Void…"
                        triggerTestId={`void-invoice-${inv.invoiceId}`}
                        triggerAppearance="secondary"
                        title={`Void ${inv.invoiceNumber}?`}
                        description="The number is kept forever (the gap is the audit trail) and the income line returns to Expected so corrected paper can be issued fresh. A reason is required and recorded."
                        extra={
                          <Field label="Reason for voiding" required>
                            <Input
                              value={voidReason[inv.invoiceId] ?? ''}
                              onChange={(e) => setVoidReason((c) => ({ ...c, [inv.invoiceId]: e.target.value }))}
                              data-testid={`void-reason-${inv.invoiceId}`}
                            />
                          </Field>
                        }
                        confirmLabel="Void invoice"
                        confirmDisabled={(voidReason[inv.invoiceId] ?? '').trim() === ''}
                        onConfirm={async () => {
                          if (!actionsCurrent) {
                            notify('error', 'The invoice register must be current before an invoice can be voided.');
                            throw new Error('money witness is not current');
                          }
                          try {
                            await api.voidInvoice(inv.invoiceId, (voidReason[inv.invoiceId] ?? '').trim(), inv.version);
                            notify('success', `${inv.invoiceNumber} voided — the line is Expected again.`);
                            invalidate();
                          } catch (err) {
                            notify('error', err instanceof ApiError ? err.message : 'The void failed.');
                            throw err instanceof Error ? err : new Error('failed');
                          }
                        }}
                      />
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </ComparisonTable>
      </RecheckingTruthPanel>
    </CollectionFrame>
  );
}
