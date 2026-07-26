import { useState, type ChangeEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CURRENCY_CODES, SUBSCRIPTION_CADENCES, parseDecimalToMinor } from '@c3web/domain';
import type { SubscriptionDto } from '@c3web/api-contracts';
import { useSubscriptions } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  StatusBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  Field,
  Input,
  Textarea,
  Selector,
  FormDrawer,
  GovernedAction,
} from '../tablework';

/**
 * Recurring subscriptions (Track B) — a small register of the org's recurring
 * costs (SaaS, infra, office), on the Tablework frame (pivot W2; the Fluent
 * page's behaviour, testids, and copy verbatim). Direct-audited: create/edit/
 * cancel run immediately for owner/operations. Viewing is finance-gated. The
 * vendor is a name for now; renewal dates show up on the Calendar. No payment
 * credentials.
 */

interface FormState {
  name: string; vendorName: string; amount: string; currency: string; cadence: string;
  category: string; startedOn: string; nextRenewalOn: string; notes: string;
}
const EMPTY: FormState = { name: '', vendorName: '', amount: '', currency: 'USD', cadence: 'Monthly', category: '', startedOn: '', nextRenewalOn: '', notes: '' };

/**
 * ⚖️ THE MONEY SEAM — deliberately NOT consolidated onto the kit (Wave-2 rule:
 * a money parser may be replaced only when the replacement's zero-policy AND
 * output order are identical).
 *
 *  - PARSER: this register accepts `0.00` today — `parseDecimalToMinor('0')`
 *    returns `0` and the guard below is `=== null`. The kit's
 *    `positiveAmountToMinor` REJECTS zero, so adopting it would make a 0.00
 *    subscription unsaveable. Kept local.
 *  - FORMATTER: `fmt` renders "99.00 USD"; the kit's `formatMoney` renders
 *    "USD 99.00" (and with U+00A0). Consolidating would reverse every visible
 *    amount on this screen. The ordering inconsistency is a known product item
 *    with the owner — NOT conversion work. Kept local, byte-identical.
 */
// KIT-GAP WORKAROUND (provisional — remove when the gap closes).
// GAP: the frozen kit has NO money DISPLAY capability at all — `tablework/
//   money.ts` is parse-only. The product's only formatter, `formatMoney`
//   (@c3web/domain), renders code-FIRST separated by U+00A0 ("USD 99.00"),
//   which is the reverse of this register's frozen output ("99.00 USD").
// WORKAROUND: a screen-local `fmt` that renders amount-then-code, kept
//   byte-identical to the Fluent page so no visible amount moves.
// CLASS: contractual — the honest fix is ONE order for the whole product, and
//   settling it (either way) changes what every already-converted, already-
//   gated money screen renders. It is not something a screen can opt into.
const fmt = (minor: number, currency: string) => `${(minor / 100).toFixed(2)} ${currency}`;

export function SubscriptionsPage() {
  return (
    <TableworkPage record="Subscriptions" section="Register">
      <SubscriptionsRegister />
    </TableworkPage>
  );
}

function SubscriptionsRegister() {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canView = me?.capabilities.canViewFinancials ?? false;
  const canManage = me?.capabilities.canManageSubscriptions ?? false;
  // THE WIRE LAW: the capability IS the `enabled` flag — never hoisted to
  // always-on and hidden visually.
  const { data, isLoading, isError, error } = useSubscriptions(canView);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionDto | null>(null);
  const [f, setF] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  if (!canView) {
    return (
      <CollectionFrame title="Subscriptions">
        <EmptyState data-testid="subs-denied" message="Recurring subscriptions are available to finance-visible roles." />
      </CollectionFrame>
    );
  }

  const openAdd = () => { setEditing(null); setF(EMPTY); setOpen(true); };
  const openEdit = (sub: SubscriptionDto) => {
    setEditing(sub);
    setF({ name: sub.name, vendorName: sub.vendorName, amount: (sub.amountMinor / 100).toFixed(2), currency: sub.currency, cadence: sub.cadence, category: sub.category ?? '', startedOn: sub.startedOn, nextRenewalOn: sub.nextRenewalOn ?? '', notes: sub.notes ?? '' });
    setOpen(true);
  };

  async function submit(): Promise<void> {
    // KIT-GAP WORKAROUND (provisional — remove when the gap closes).
    // GAP: the kit ships exactly one amount parser — `positiveAmountToMinor` —
    //   and it REJECTS zero. This register accepts 0.00 today, so adopting it
    //   would make a 0.00 subscription unsaveable. money.ts already ships the
    //   zero-allowed / zero-rejected PAIR on the percent side (percentToBps /
    //   positivePercentToBps); the amount side has only the rejecting half.
    // WORKAROUND: bypass the kit and call the domain's `parseDecimalToMinor`
    //   directly, guarded with `=== null` (not `== null`, not falsy) so 0 lives.
    // CLASS: additive — an `amountToMinor` export beside `positiveAmountToMinor`
    //   completes the pair the module's own naming already implies, and changes
    //   no converted call site.
    const amountMinor = parseDecimalToMinor(f.amount);
    // `=== null` (not `== null`, not falsy): 0 is a valid amount here.
    if (amountMinor === null) return notify('error', 'Enter a valid amount (up to 2 decimals).');
    if (!f.name.trim() || !f.vendorName.trim() || !f.startedOn) return notify('error', 'Name, vendor, and start date are required.');
    setBusy(true);
    try {
      const base = {
        name: f.name.trim(), vendorName: f.vendorName.trim(), amountMinor, currency: f.currency, cadence: f.cadence,
        category: f.category.trim() || null, startedOn: f.startedOn, nextRenewalOn: f.nextRenewalOn || null, notes: f.notes.trim() || null,
      };
      // expectedVersion comes from the SERVER row being edited — a stale or
      // dropped version turns a rejected concurrent edit into a silent overwrite.
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
    <>
      <CollectionFrame
        kicker="Recurring costs"
        title="Subscriptions"
        scope={
          <>
            The org’s recurring costs — SaaS, infrastructure, office. Renewal dates surface on the Calendar. Vendor is a
            name for now (payment routing comes with the finance layer); no account numbers, ever.
          </>
        }
        actions={
          canManage ? (
            <button className="primary-action" type="button" onClick={openAdd} data-testid="subs-add">Add subscription</button>
          ) : undefined
        }
      >
        {isLoading && <LoadingState label="Loading subscriptions…" />}
        {isError && (
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not load subscriptions.'}
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
          />
        )}
        {data && subs.length === 0 && <EmptyState data-testid="subs-empty" message="No subscriptions yet." />}

        {data && subs.length > 0 && (
          <ComparisonTable label="Subscriptions register" testId="subs-table">
            <thead>
              <tr>
                <th>Subscription</th>
                <th>Cost</th>
                <th>Next renewal</th>
                <th>Status</th>
                {canManage && <th></th>}
              </tr>
            </thead>
            <tbody>
              {subs.map((sub) => (
                <tr key={sub.subscriptionId} data-testid={`subs-row-${sub.subscriptionId}`}>
                  <td>
                    <div>{sub.name}</div>
                    {/* The vendor is a human/proper name — SANS, never `mono`
                        (mono is reserved for codes, dates and amounts). */}
                    <div className="collection-scope">{sub.vendorName}{sub.category ? ` · ${sub.category}` : ''}</div>
                  </td>
                  {/* `mono` belongs on the CELL (`.data-grid td.mono`) — it does
                      nothing on an inner element. The money format is local and
                      the date is raw ISO (the date formatter is a NEGATIVE
                      contract). */}
                  <td className="mono">
                    <div>{fmt(sub.amountMinor, sub.currency)}</div>
                    <div className="record-row-meta">{sub.cadence}</div>
                  </td>
                  <td className="mono">{sub.nextRenewalOn ?? '—'}</td>
                  <td><StatusBadge variant={sub.status === 'Active' ? 'ready' : 'neutral'}>{sub.status}</StatusBadge></td>
                  {canManage && (
                    <td>
                      {/*
                        // KIT-GAP WORKAROUND (provisional — remove when the gap closes).
                        // GAP: the kit has no margin-free inline action group. Its only
                        //   generic one, `panel-actions`, adds `margin-top: var(--c3-space-5)`
                        //   — a panel-FOOT margin that reads as stray vertical space when the
                        //   group sits inside a table cell.
                        // WORKAROUND: borrow `message-actions`, which shares the identical
                        //   flex rule minus the margin but is named for the Comms Message.
                        // CLASS: additive — the two classes already share one declaration
                        //   block; a neutrally-named margin-free action group breaks nothing
                        //   already converted. (Dropping the margin from `panel-actions`
                        //   instead WOULD be contractual — it is load-bearing on panel feet.)
                      */}
                      <div className="message-actions">
                        <button className="quiet-action" type="button" onClick={() => openEdit(sub)} data-testid={`subs-edit-${sub.subscriptionId}`}>Edit</button>
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
                          <button className="secondary-action" type="button" onClick={() => void setStatus(sub, 'reactivate')} data-testid={`subs-reactivate-${sub.subscriptionId}`}>Reactivate</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </ComparisonTable>
        )}
      </CollectionFrame>

      <FormDrawer
        open={open}
        onClose={() => setOpen(false)}
        eyebrow={editing ? `Edit ${editing.subscriptionId}` : 'Add subscription'}
        mode="direct"
        intro="Subscriptions are created and edited immediately, and recorded in the audit history."
        footer={
          <>
            <button className="secondary-action" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="primary-action" type="button" onClick={() => void submit()} disabled={busy} data-testid="subs-save">{busy ? 'Saving…' : editing ? 'Save changes' : 'Add'}</button>
          </>
        }
      >
        <Field label="Name" required><Input value={f.name} onChange={set('name')} data-testid="subs-f-name" /></Field>
        <Field label="Vendor" required><Input value={f.vendorName} onChange={set('vendorName')} data-testid="subs-f-vendor" /></Field>
        <Field label="Category"><Input value={f.category} onChange={set('category')} placeholder="Software" /></Field>
        <Field label="Amount" required><Input value={f.amount} onChange={set('amount')} placeholder="99.00" data-testid="subs-f-amount" /></Field>
        <Field label="Currency">
          <Selector
            data-testid="subs-f-currency"
            value={f.currency}
            options={CURRENCY_CODES.map((c) => ({ value: c, label: c }))}
            onSelect={(value) => setF((p) => ({ ...p, currency: value }))}
          />
        </Field>
        <Field label="Cadence">
          <Selector
            data-testid="subs-f-cadence"
            value={f.cadence}
            options={SUBSCRIPTION_CADENCES.map((c) => ({ value: c, label: c }))}
            onSelect={(value) => setF((p) => ({ ...p, cadence: value }))}
          />
        </Field>
        <Field label="Started on (YYYY-MM-DD)" required><Input value={f.startedOn} onChange={set('startedOn')} placeholder="2026-01-01" data-testid="subs-f-started" /></Field>
        <Field label="Next renewal (YYYY-MM-DD)"><Input value={f.nextRenewalOn} onChange={set('nextRenewalOn')} placeholder="2026-08-01" data-testid="subs-f-renewal" /></Field>
        <Field label="Notes"><Textarea value={f.notes} onChange={set('notes')} /></Field>
      </FormDrawer>
    </>
  );
}
