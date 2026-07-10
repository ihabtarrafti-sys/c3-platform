import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Dropdown, Field, Input, Option, Textarea } from '@fluentui/react-components';
import { CURRENCY_CODES } from '@c3web/api-contracts';
import { CLAIM_CATEGORIES } from '@c3web/domain';
import { useClaims } from '../queries';
import { ApiError } from '../api';
import { api } from '../apiClient';
import { useNotify, useSession } from '../session';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState, ErrorState, LoadingState } from '../components/states';
import { useRegisterStyles } from '../components/registerStyles';
import { GovernedAction } from '../components/GovernedAction';
import { FormDrawer } from '../components/FormDrawer';
import { claimStatusOf, formatMinor, lineCategoryOf } from '../labels';

/**
 * Expense claims (S9) — retires the Finance Intelligence Hub. Everyone
 * (except read-only roles) submits their own; finance standing sees and
 * decides ALL — but never their own (the separation law). Receipts live on
 * each claim's page.
 */
export function ClaimsPage() {
  const r = useRegisterStyles();
  const { me } = useSession();
  const { notify } = useNotify();
  const qc = useQueryClient();
  const canSubmit = me?.capabilities.canSubmitClaim ?? false;
  const canDecide = me?.capabilities.canDecideClaim ?? false;
  const { data, isLoading, isError, error } = useClaims(canSubmit);

  const [showForm, setShowForm] = useState(false);
  const [category, setCategory] = useState('Travel');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [expenseOn, setExpenseOn] = useState('');

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['claims'] });

  if (!canSubmit) {
    return (
      <div>
        <PageHeader title="Claims" />
        <EmptyState data-testid="claims-denied" message="Expense claims are unavailable for your role." />
      </div>
    );
  }

  const amountMinor = (() => {
    const n = Number(amount);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
  })();
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
    <div>
      <PageHeader
        kicker="Register"
        title="Claims"
        context={data ? `${data.claims.length} in this view${canDecide ? ' · all submitters' : ' · yours'}` : undefined}
        actions={
          <Button appearance="primary" onClick={() => setShowForm(true)} data-testid="add-claim-toggle">
            Submit Claim
          </Button>
        }
      />

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
          <Dropdown
            value={lineCategoryOf(category)}
            selectedOptions={[category]}
            onOptionSelect={(_, d) => d.optionValue && setCategory(d.optionValue)}
            data-testid="add-claim-category"
          >
            {CLAIM_CATEGORIES.map((c) => (
              <Option key={c} value={c} text={lineCategoryOf(c)}>
                {lineCategoryOf(c)}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label="What was the expense?" required>
          <Textarea value={description} onChange={(_, d) => setDescription(d.value)} data-testid="add-claim-description" />
        </Field>
        <Field label="Amount" required>
          <Input type="number" value={amount} onChange={(_, d) => setAmount(d.value)} data-testid="add-claim-amount" />
        </Field>
        <Field label="Currency" required>
          <Dropdown value={currency} selectedOptions={[currency]} onOptionSelect={(_, d) => d.optionValue && setCurrency(d.optionValue)} data-testid="add-claim-currency">
            {CURRENCY_CODES.map((c) => (
              <Option key={c} value={c} text={c}>
                {c}
              </Option>
            ))}
          </Dropdown>
        </Field>
        <Field label="Expense date" required>
          <Input type="date" value={expenseOn} onChange={(_, d) => setExpenseOn(d.value)} data-testid="add-claim-date" />
        </Field>
      </FormDrawer>

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
        <table className={r.table} data-testid="claims-table" aria-label="Expense claims">
          <thead>
            <tr>
              <th className={r.th}>Claim</th>
              <th className={r.th}>Submitted by</th>
              <th className={r.th}>Category</th>
              <th className={r.th}>Description</th>
              <th className={r.th}>Amount</th>
              <th className={r.th}>Expense date</th>
              <th className={r.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.claims.map((c) => (
              <tr key={c.claimId} className={r.row} data-testid={`claim-row-${c.claimId}`}>
                <td className={r.td}>
                  <Link className={r.idLink} to={`/claims/${c.claimId}`} data-testid={`claim-link-${c.claimId}`}>
                    {c.claimId}
                  </Link>
                </td>
                <td className={r.td}>{c.submittedBy}</td>
                <td className={r.td}>{lineCategoryOf(c.category)}</td>
                <td className={`${r.td} ${r.name}`}>{c.description}</td>
                <td className={`${r.td} ${r.mono}`}>{formatMinor(c.amountMinor, c.currency)}</td>
                <td className={`${r.td} ${r.mono}`}>{c.expenseOn}</td>
                <td className={r.td}>
                  <StatusBadge variant={claimStatusOf(c.status).variant} data-testid={`claim-status-${c.claimId}`} title={c.rejectionReason ?? undefined}>
                    {claimStatusOf(c.status).label}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
