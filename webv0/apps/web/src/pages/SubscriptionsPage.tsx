import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle,
  Dropdown, Field, Input, Option, Textarea, makeStyles,
} from '@fluentui/react-components';
import { CURRENCY_CODES, SUBSCRIPTION_CADENCES, parseDecimalToMinor } from '@c3web/domain';
import type { SubscriptionDto } from '@c3web/api-contracts';
import { useSubscriptions } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { StatusBadge } from '../components/StatusBadge';
import { GovernedAction } from '../components/GovernedAction';
import { useRegisterStyles } from '../components/registerStyles';

/**
 * Recurring subscriptions (Track B) — a small register of the org's recurring
 * costs (SaaS, infra, office). Direct-audited: create/edit/cancel run
 * immediately for owner/operations. Viewing is finance-gated. The vendor is a
 * name for now; renewal dates show up on the Calendar. No payment credentials.
 */

const useStyles = makeStyles({
  intro: { fontSize: '13px', lineHeight: '20px', color: 'var(--c3-ink-mid)', maxWidth: '660px', marginBottom: '16px' },
  bar: { display: 'flex', justifyContent: 'flex-end', marginBottom: '12px' },
  amount: { fontFamily: 'var(--c3-font-mono)', fontSize: '13px', color: 'var(--c3-ink)' },
  cadence: { fontSize: '11.5px', color: 'var(--c3-ink-muted)', fontFamily: 'var(--c3-font-mono)' },
  vendor: { fontSize: '12px', color: 'var(--c3-ink-muted)' },
  meta: { fontSize: '12.5px', color: 'var(--c3-ink-mid)' },
  actions: { display: 'flex', gap: '6px' },
  form: { display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: '12px', rowGap: '12px', minWidth: '440px' },
  full: { gridColumn: '1 / -1' },
});

interface FormState {
  name: string; vendorName: string; amount: string; currency: string; cadence: string;
  category: string; startedOn: string; nextRenewalOn: string; notes: string;
}
const EMPTY: FormState = { name: '', vendorName: '', amount: '', currency: 'USD', cadence: 'Monthly', category: '', startedOn: '', nextRenewalOn: '', notes: '' };

const fmt = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

export function SubscriptionsPage() {
  const s = useStyles();
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canView = me?.capabilities.canViewFinancials ?? false;
  const canManage = me?.capabilities.canManageSubscriptions ?? false;
  const { data, isLoading, isError, error } = useSubscriptions(canView);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionDto | null>(null);
  const [f, setF] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormState) => (_: unknown, d: { value: string }) => setF((p) => ({ ...p, [k]: d.value }));

  if (!canView) {
    return (
      <div>
        <PageHeader title="Subscriptions" />
        <EmptyState data-testid="subs-denied" message="Recurring subscriptions are available to finance-visible roles." />
      </div>
    );
  }

  const openAdd = () => { setEditing(null); setF(EMPTY); setOpen(true); };
  const openEdit = (sub: SubscriptionDto) => {
    setEditing(sub);
    setF({ name: sub.name, vendorName: sub.vendorName, amount: (sub.amountMinor / 100).toFixed(2), currency: sub.currency, cadence: sub.cadence, category: sub.category ?? '', startedOn: sub.startedOn, nextRenewalOn: sub.nextRenewalOn ?? '', notes: sub.notes ?? '' });
    setOpen(true);
  };

  async function submit(): Promise<void> {
    const amountMinor = parseDecimalToMinor(f.amount);
    if (amountMinor === null) return notify('error', 'Enter a valid amount (up to 2 decimals).');
    if (!f.name.trim() || !f.vendorName.trim() || !f.startedOn) return notify('error', 'Name, vendor, and start date are required.');
    setBusy(true);
    try {
      const base = {
        name: f.name.trim(), vendorName: f.vendorName.trim(), amountMinor, currency: f.currency, cadence: f.cadence,
        category: f.category.trim() || null, startedOn: f.startedOn, nextRenewalOn: f.nextRenewalOn || null, notes: f.notes.trim() || null,
      };
      if (editing) await api.updateSubscription(editing.subscriptionId, { expectedVersion: editing.version, ...base });
      else await api.createSubscription(base);
      notify('success', editing ? 'Subscription updated.' : 'Subscription added.');
      setOpen(false);
      await qc.invalidateQueries({ queryKey: ['subscriptions'] });
      await qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not save the subscription.');
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(sub: SubscriptionDto, action: 'cancel' | 'reactivate'): Promise<void> {
    try {
      if (action === 'cancel') await api.cancelSubscription(sub.subscriptionId, sub.version);
      else await api.reactivateSubscription(sub.subscriptionId, sub.version);
      notify('success', action === 'cancel' ? 'Subscription cancelled.' : 'Subscription reactivated.');
      await qc.invalidateQueries({ queryKey: ['subscriptions'] });
      await qc.invalidateQueries({ queryKey: ['calendar'] });
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Could not change the status.');
    }
  }

  const subs = data?.subscriptions ?? [];

  return (
    <div>
      <PageHeader kicker="Recurring costs" title="Subscriptions" />
      <p className={s.intro}>
        The org’s recurring costs — SaaS, infrastructure, office. Renewal dates surface on the Calendar. Vendor is a
        name for now (payment routing comes with the finance layer); no account numbers, ever.
      </p>

      {canManage && (
        <div className={s.bar}>
          <Button appearance="primary" onClick={openAdd} data-testid="subs-add">Add subscription</Button>
        </div>
      )}

      {isLoading && <LoadingState label="Loading subscriptions…" />}
      {isError && <ErrorState message={error instanceof ApiError ? error.message : 'Could not load subscriptions.'} />}
      {data && subs.length === 0 && <EmptyState data-testid="subs-empty" message="No subscriptions yet." />}

      {data && subs.length > 0 && (
        <table className={r.table} data-testid="subs-table" aria-label="Subscriptions register">
          <thead>
            <tr>
              <th className={r.th}>Subscription</th>
              <th className={r.th}>Cost</th>
              <th className={r.th}>Next renewal</th>
              <th className={r.th}>Status</th>
              {canManage && <th className={r.th}></th>}
            </tr>
          </thead>
          <tbody>
            {subs.map((sub) => (
              <tr key={sub.subscriptionId} className={r.row} data-testid={`subs-row-${sub.subscriptionId}`}>
                <td className={r.td}>
                  <div>{sub.name}</div>
                  <div className={s.vendor}>{sub.vendorName}{sub.category ? ` · ${sub.category}` : ''}</div>
                </td>
                <td className={r.td}>
                  <span className={s.amount}>{fmt(sub.amountMinor, sub.currency)}</span>
                  <div className={s.cadence}>{sub.cadence}</div>
                </td>
                <td className={r.td}><span className={s.meta}>{sub.nextRenewalOn ?? '—'}</span></td>
                <td className={r.td}><StatusBadge variant={sub.status === 'Active' ? 'ready' : 'neutral'}>{sub.status}</StatusBadge></td>
                {canManage && (
                  <td className={r.td}>
                    <div className={s.actions}>
                      <Button appearance="subtle" size="small" onClick={() => openEdit(sub)} data-testid={`subs-edit-${sub.subscriptionId}`}>Edit</Button>
                      {sub.status === 'Active' ? (
                        <GovernedAction
                          triggerLabel="Cancel"
                          triggerTestId={`subs-cancel-${sub.subscriptionId}`}
                          triggerAppearance="secondary"
                          title={`Cancel ${sub.name}?`}
                          description="It stops appearing on the renewal horizon. You can reactivate it later."
                          confirmLabel="Cancel subscription"
                          onConfirm={() => setStatus(sub, 'cancel')}
                        />
                      ) : (
                        <Button appearance="secondary" size="small" onClick={() => setStatus(sub, 'reactivate')} data-testid={`subs-reactivate-${sub.subscriptionId}`}>Reactivate</Button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <Dialog open={open} onOpenChange={(_, d) => setOpen(d.open)}>
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{editing ? `Edit ${editing.subscriptionId}` : 'Add subscription'}</DialogTitle>
            <DialogContent>
              <div className={s.form}>
                <Field label="Name" required className={s.full}><Input value={f.name} onChange={set('name')} data-testid="subs-f-name" /></Field>
                <Field label="Vendor" required><Input value={f.vendorName} onChange={set('vendorName')} data-testid="subs-f-vendor" /></Field>
                <Field label="Category"><Input value={f.category} onChange={set('category')} placeholder="Software" /></Field>
                <Field label="Amount" required><Input value={f.amount} onChange={set('amount')} placeholder="99.00" data-testid="subs-f-amount" /></Field>
                <Field label="Currency">
                  <Dropdown value={f.currency} selectedOptions={[f.currency]} onOptionSelect={(_, d) => setF((p) => ({ ...p, currency: d.optionValue ?? 'USD' }))} data-testid="subs-f-currency">
                    {CURRENCY_CODES.map((c) => <Option key={c} value={c}>{c}</Option>)}
                  </Dropdown>
                </Field>
                <Field label="Cadence">
                  <Dropdown value={f.cadence} selectedOptions={[f.cadence]} onOptionSelect={(_, d) => setF((p) => ({ ...p, cadence: d.optionValue ?? 'Monthly' }))} data-testid="subs-f-cadence">
                    {SUBSCRIPTION_CADENCES.map((c) => <Option key={c} value={c}>{c}</Option>)}
                  </Dropdown>
                </Field>
                <Field label="Started on (YYYY-MM-DD)" required><Input value={f.startedOn} onChange={set('startedOn')} placeholder="2026-01-01" data-testid="subs-f-started" /></Field>
                <Field label="Next renewal (YYYY-MM-DD)"><Input value={f.nextRenewalOn} onChange={set('nextRenewalOn')} placeholder="2026-08-01" data-testid="subs-f-renewal" /></Field>
                <Field label="Notes" className={s.full}><Textarea value={f.notes} onChange={set('notes')} /></Field>
              </div>
            </DialogContent>
            <DialogActions>
              <Button appearance="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button appearance="primary" onClick={submit} disabled={busy} data-testid="subs-save">{busy ? 'Saving…' : editing ? 'Save changes' : 'Add'}</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}
