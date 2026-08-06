import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CURRENCY_CODES } from '@c3web/api-contracts';
import { CLAIM_CATEGORIES } from '@c3web/domain';
import { useClaims } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
// The pivot (Wave 2, Lane B): the import path IS the conversion for the
// cross-cutting pieces. CollectionFrame's header count is the SINGLE count
// line (M2). `positiveAmountToMinor` is the ruled-safe money consolidation
// for THIS screen only — its zero-policy (> 0) and the local guard it
// replaces are byte-identical, and the name now carries the policy.
import {
  TableworkPage,
  CollectionFrame,
  ComparisonTable,
  RecordLink,
  StatusBadge,
  RecheckingTruthPanel,
  Field,
  Input,
  DateInput,
  Textarea,
  Selector,
  FormDrawer,
  GovernedAction,
  isCurrentMoneyWitness,
  moneyActionsAvailable,
  moneyWitnessOf,
  positiveAmountToMinor,
  type WitnessState,
} from '../tablework';
import { claimStatusOf, formatMinor, lineCategoryOf } from '../labels';
import { useForegroundRewitness } from '../tablework/useForegroundRewitness';

/**
 * Expense claims (S9) — retires the Finance Intelligence Hub. Everyone
 * (except read-only roles) submits their own; finance standing sees and
 * decides ALL — but never their own (the separation law). Receipts live on
 * each claim's page.
 */
export function ClaimsPage() {
  return (
    <TableworkPage record="Claims" section="Register">
      <ClaimsRegister />
    </TableworkPage>
  );
}

export interface ClaimsRegisterProps {
  readonly enabled?: boolean;
  readonly foreground?: boolean;
  readonly requestKey?: string | number;
  readonly onTruthChange?: (truth: WitnessState) => void;
  readonly linkToClaim?: (claimId: string) => string;
}

export function ClaimsRegister({
  enabled = true,
  foreground = true,
  requestKey,
  onTruthChange,
  linkToClaim = (claimId) => `/claims/${claimId}`,
}: ClaimsRegisterProps = {}) {
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canSubmit = me?.capabilities.canSubmitClaim ?? false;
  const canReadClaims = me?.capabilities.canReadClaims ?? false; // M-12: finance/management read the register
  const canDecide = me?.capabilities.canDecideClaim ?? false;
  const canViewFinancials = me?.capabilities.canViewFinancials ?? false;
  // The capability IS the `enabled` flag — the register is never fetched for a
  // role that may not read it, and the denial below is a render of that fact,
  // not a curtain over data already on the wire.
  const queryEnabled = enabled && canReadClaims;
  const query = useClaims(queryEnabled);
  const rewitnessing = useForegroundRewitness({ foreground, enabled: queryEnabled, refetch: query.refetch, requestKey });
  const truth = useMemo(
    () =>
      moneyWitnessOf(
        {
          included: canReadClaims,
          data: query.data,
          error: query.error,
          isLoading: query.isLoading,
          isFetching: query.isFetching || rewitnessing,
          dataUpdatedAt: query.dataUpdatedAt,
        },
        {
          isEmpty: (view) => view.claims.length === 0,
          omittedReason: 'CLAIMS_UNAVAILABLE',
          recheckMessage: 'The claims register is being checked again.',
        },
      ),
    [canReadClaims, query.data, query.dataUpdatedAt, query.error, query.isFetching, query.isLoading, rewitnessing],
  );
  const canSubmitCurrent = moneyActionsAvailable(canSubmit && enabled, truth, foreground);
  const canExportCurrent = moneyActionsAvailable(canViewFinancials && enabled, truth, foreground);
  const claims = query.data?.claims ?? [];

  useEffect(() => {
    onTruthChange?.(truth);
  }, [onTruthChange, truth]);

  async function downloadPayroll(): Promise<void> {
    if (!canExportCurrent) {
      notify('error', 'The claims register must be current before payroll can be exported.');
      return;
    }
    try {
      const { blob, fileName } = await api.downloadPayrollCsv();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'Payroll export failed.');
    }
  }

  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState('Travel');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [expenseOn, setExpenseOn] = useState('');

  useLayoutEffect(() => {
    if (!canSubmitCurrent) setShowForm(false);
  }, [canSubmitCurrent]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['claims'] });

  // M-02: exact-decimal law — excess precision refuses instead of rounding.
  // A zero-value claim is meaningless, so the ZERO-REJECTING parser is the
  // one this site takes; deleting the policy would let 0.00 submit.
  const amountMinor = positiveAmountToMinor(amount);
  const ready = description.trim() !== '' && amountMinor !== null && /^\d{4}-\d{2}-\d{2}$/.test(expenseOn);

  async function submit() {
    if (!canSubmitCurrent) {
      notify('error', 'The claims register must be current before a claim can be submitted.');
      return;
    }
    try {
      const res = await api.submitClaim({
        category,
        description: description.trim(),
        amountMinor: amountMinor!,
        currency,
        expenseOn,
      });
      notify('success', `${res.claim.claimId} submitted — finance will review it.`);
      invalidate();
      setShowForm(false);
      setDescription('');
      setAmount('');
      setExpenseOn('');
    } catch (err) {
      notify('error', err instanceof ApiError ? err.message : 'The claim failed.');
      throw err instanceof Error ? err : new Error('failed');
    }
  }

  return (
    <>
      <CollectionFrame
        kicker="Register"
        title="Claims"
        count={isCurrentMoneyWitness(truth) ? `${claims.length} in this view${canDecide ? ' · all submitters' : ' · yours'}` : undefined}
        actions={
          <>
            {canExportCurrent && (
              <button className="secondary-action" type="button" onClick={() => void downloadPayroll()} data-testid="payroll-export">
                Payroll export
              </button>
            )}
            {canSubmitCurrent && (
              <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="add-claim-toggle">
                Submit claim
              </button>
            )}
          </>
        }
      >
        <RecheckingTruthPanel
          state={truth}
          rechecking={rewitnessing || (query.isFetching && query.error == null)}
          emptyLabel="No claims yet — submit an expense and watch it move."
          testids={{
            loading: 'claims-loading',
            empty: 'claims-empty',
            denied: 'claims-denied',
            failed: 'claims-error',
            stale: 'claims-stale',
          }}
        >
          <ComparisonTable label="Expense claims" testId="claims-table">
            <thead>
              <tr>
                <th>Claim</th>
                <th>Submitted by</th>
                <th>Category</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Expense date</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((c) => (
                <tr key={c.claimId} data-testid={`claim-row-${c.claimId}`}>
                  <td>
                    <RecordLink to={linkToClaim(c.claimId)} data-testid={`claim-link-${c.claimId}`}>
                      {c.claimId}
                    </RecordLink>
                  </td>
                  <td>{c.submittedBy}</td>
                  <td>{lineCategoryOf(c.category)}</td>
                  <td>{c.description}</td>
                  <td className="mono">{formatMinor(c.amountMinor, c.currency)}</td>
                  <td className="mono">{c.expenseOn}</td>
                  <td>
                    <StatusBadge variant={claimStatusOf(c.status).variant} data-testid={`claim-status-${c.claimId}`} title={c.rejectionReason ?? undefined}>
                      {claimStatusOf(c.status).label}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </ComparisonTable>
        </RecheckingTruthPanel>
      </CollectionFrame>

      <FormDrawer
        open={showForm && canSubmitCurrent}
        onClose={() => setShowForm(false)}
        eyebrow="New expense claim"
        mode="direct"
        intro="Your expense, one item per claim. It lands as Submitted; finance reviews, decides, and pays — you can watch every step here. Attach the receipt on the claim's page after submitting."
        footer={
          <GovernedAction
            triggerLabel="Submit claim"
            triggerTestId="add-claim-submit"
            triggerDisabled={!ready}
            title="Submit this expense claim?"
            description="It is recorded immediately and waits for a finance decision. You can never decide your own claim."
            confirmLabel="Submit claim"
            onConfirm={submit}
          />
        }
      >
        <Field label="Category" required>
          <Selector
            data-testid="add-claim-category"
            value={category}
            options={CLAIM_CATEGORIES.map((c) => ({ value: c, label: lineCategoryOf(c) }))}
            onSelect={(value) => setCategory(value)}
          />
        </Field>
        <Field label="What was the expense?" required>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} data-testid="add-claim-description" />
        </Field>
        <Field label="Amount" required>
          <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="add-claim-amount" />
        </Field>
        <Field label="Currency" required>
          <Selector
            data-testid="add-claim-currency"
            value={currency}
            options={CURRENCY_CODES.map((c) => ({ value: c, label: c }))}
            onSelect={(value) => setCurrency(value)}
          />
        </Field>
        <Field label="Expense date" required>
          <DateInput value={expenseOn} onChange={(e) => setExpenseOn(e.target.value)} data-testid="add-claim-date" />
        </Field>
      </FormDrawer>
    </>
  );
}
