import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Field, Input } from '@fluentui/react-components';
import { useInvoices } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { formatMinor, invoiceStatusOf } from '../labels';

/**
 * Invoices (S6) — the register of outward claims. Each invoice bills exactly
 * one mission income line from one of the org's own entities; numbers are a
 * per-entity yearly series and are never reused (voids keep their number —
 * the gap IS the audit trail). Issuing happens from the mission's P&L; here
 * the paper is read, downloaded, and — with a reason — voided.
 */
export function InvoicesPage() {
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canSee = me?.capabilities.canViewFinancials ?? false;
  const canAct = (me?.capabilities.canManageMissions ?? false) && canSee;
  const { data, isLoading, isError, error } = useInvoices(canSee);
  const [voidReason, setVoidReason] = useState<Record<string, string>>({});

  if (!canSee) {
    return (
      <div>
        <PageHeader title="Invoices" />
        <EmptyState data-testid="invoices-denied" message="Invoices are financial records — unavailable for your role." />
      </div>
    );
  }

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
    try {
      await api.retryInvoicePdf(invoiceId);
      notify('success', `The PDF for ${invoiceId} is stored.`);
      invalidate();
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The PDF could not be generated.');
    }
  }

  return (
    <div>
      <PageHeader kicker="Register" title="Invoices" context={data ? `${data.invoices.length} in this view` : undefined} />

      {isLoading && <LoadingState label="Loading invoices…" />}
      {isError && (
        <ErrorState
          message={error instanceof ApiError ? error.message : 'Could not load invoices.'}
          correlationId={error instanceof ApiError ? error.correlationId : undefined}
        />
      )}
      {data && data.invoices.length === 0 && (
        <EmptyState
          data-testid="invoices-empty"
          message="No invoices yet. Issue one from a mission's P&L — any income line still Expected."
        />
      )}
      {data && data.invoices.length > 0 && (
        <table className={r.table} data-testid="invoices-table" aria-label="Invoices register">
          <thead>
            <tr>
              <th className={r.th}>Number</th>
              <th className={r.th}>Entity</th>
              <th className={r.th}>Mission</th>
              <th className={r.th}>Billed to</th>
              <th className={r.th}>Type of income</th>
              <th className={r.th}>Total</th>
              <th className={r.th}>Issued</th>
              <th className={r.th}>Status</th>
              <th className={r.th}>Paper</th>
              {canAct && <th className={r.th}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {data.invoices.map((inv) => (
              <tr key={inv.invoiceId} className={r.row} data-testid={`invoice-row-${inv.invoiceId}`}>
                <td className={`${r.td} ${r.mono}`} data-testid={`invoice-number-${inv.invoiceId}`}>
                  {inv.invoiceNumber}
                </td>
                <td className={r.td}>{inv.entityId}</td>
                <td className={r.td}>
                  <Link className={r.idLink} to={`/missions/${inv.missionId}`}>
                    {inv.missionId}
                  </Link>
                </td>
                <td className={`${r.td} ${r.name}`}>{inv.billedToName}</td>
                <td className={r.td}>{inv.incomeCategory}</td>
                <td className={`${r.td} ${r.mono}`} data-testid={`invoice-total-${inv.invoiceId}`}>
                  {formatMinor(inv.totalMinor, inv.currency)}
                </td>
                <td className={`${r.td} ${r.mono}`}>{inv.issuedOn}</td>
                <td className={r.td}>
                  <StatusBadge
                    variant={invoiceStatusOf(inv.status).variant}
                    data-testid={`invoice-status-${inv.invoiceId}`}
                    title={inv.voidedReason ?? undefined}
                  >
                    {invoiceStatusOf(inv.status).label}
                  </StatusBadge>
                </td>
                <td className={r.td}>
                  {inv.documentId ? (
                    <Button size="small" appearance="secondary" onClick={() => void download(inv.invoiceId, inv.documentId!)} data-testid={`invoice-pdf-${inv.invoiceId}`}>
                      PDF
                    </Button>
                  ) : canAct && inv.status === 'Issued' ? (
                    <Button size="small" appearance="secondary" onClick={() => void retryPdf(inv.invoiceId)} data-testid={`invoice-pdf-retry-${inv.invoiceId}`}>
                      Generate PDF
                    </Button>
                  ) : (
                    '—'
                  )}
                </td>
                {canAct && (
                  <td className={r.td}>
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
                              onChange={(_, d) => setVoidReason((c) => ({ ...c, [inv.invoiceId]: d.value }))}
                              data-testid={`void-reason-${inv.invoiceId}`}
                            />
                          </Field>
                        }
                        confirmLabel="Void invoice"
                        confirmDisabled={(voidReason[inv.invoiceId] ?? '').trim() === ''}
                        onConfirm={async () => {
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
        </table>
      )}
    </div>
  );
}
