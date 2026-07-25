import { useState } from 'react';
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
  EmptyState,
  ErrorState,
  LoadingState,
  Field,
  Input,
  DateInput,
  Textarea,
  Selector,
  FormDrawer,
  GovernedAction,
  positiveAmountToMinor,
} from '../tablework';
import { claimStatusOf, formatMinor, lineCategoryOf } from '../labels';

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

function ClaimsRegister() {
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
  const { data, isLoading, isError, error } = useClaims(canReadClaims);

  async function downloadPayroll(): Promise<void> {
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

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['claims'] });

  if (!canReadClaims) {
    return (
      <CollectionFrame title="Claims">
        <EmptyState data-testid="claims-denied" message="Expense claims are unavailable for your role." />
      </CollectionFrame>
    );
  }

  // M-02: exact-decimal law — excess precision refuses instead of rounding.
  // A zero-value claim is meaningless, so the ZERO-REJECTING parser is the
  // one this site takes; deleting the policy would let 0.00 submit.
  const amountMinor = positiveAmountToMinor(amount);
  const ready = description.trim() !== '' && amountMinor !== null && /^\d{4}-\d{2}-\d{2}$/.test(expenseOn);

  async function submit() {
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
        count={data ? `${data.claims.length} in this view${canDecide ? ' · all submitters' : ' · yours'}` : undefined}
        actions={
          <>
            {canViewFinancials && (
              <button className="secondary-action" type="button" onClick={() => void downloadPayroll()} data-testid="payroll-export">
                Payroll export
              </button>
            )}
            {canSubmit && (
              <button className="primary-action" type="button" onClick={() => setShowForm(true)} data-testid="add-claim-toggle">
                Submit claim
              </button>
            )}
          </>
        }
      >
        {isLoading && <LoadingState label="Loading claims…" />}
        {isError && (
          <ErrorState
            message={error instanceof ApiError ? error.message : 'Could not load claims.'}
            correlationId={error instanceof ApiError ? error.correlationId : undefined}
          />
        )}
        {data && data.claims.length === 0 && (
          <EmptyState data-testid="claims-empty" message="No claims yet — submit an expense and watch it move." />
        )}
        {data && data.claims.length > 0 && (
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
              {data.claims.map((c) => (
                <tr key={c.claimId} data-testid={`claim-row-${c.claimId}`}>
                  <td>
                    <RecordLink to={`/claims/${c.claimId}`} data-testid={`claim-link-${c.claimId}`}>
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
        )}
      </CollectionFrame>

      <FormDrawer
        open={showForm}
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
