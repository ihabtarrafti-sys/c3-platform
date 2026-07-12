/**
 * payrollOps — Track B: payroll export. Approved (and paid) expense claims →
 * a payroll-columns CSV. This is the export the retired "Finance Intelligence
 * Hub" produced — EXPORT ONLY: it moves no money, it only lists what payroll
 * owes. Finance-gated; RFC-4180 CSV so it round-trips into any spreadsheet.
 * Payment-source is a LABEL (never an account number — the standing law).
 */
import type { Actor } from '@c3web/domain';
import { neutralizeFormula } from '@c3web/domain';
import { assertViewFinancials } from '@c3web/authz';
import type { Persistence } from '../ports';

/**
 * RFC-4180 cell, formula-injection-safe (M-08): neutralize a leading
 * =/+/-/@/TAB/CR (via the shared domain guard) BEFORE RFC quoting, so a claim
 * description or payee name beginning with `=` opens as inert text.
 */
function csvCell(v: string | number | null | undefined): string {
  const s = neutralizeFormula(v == null ? '' : String(v));
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const PAYROLL_HEADER = [
  'Claim ID', 'Payee', 'Concerns Person', 'Category', 'Description',
  'Amount', 'Currency', 'Expense Date', 'Status', 'Payment Source', 'Ref No', 'Reviewed By',
] as const;

export interface PayrollExport {
  readonly csv: string;
  readonly count: number;
}

/**
 * Every APPROVED or PAID claim as a payroll row (approved = to pay, paid =
 * reconciliation, distinguished by the Status column). Finance visibility
 * (owner/ops/finance/management) — the store returns the full tenant set, the
 * gate keeps a bare submitter out.
 */
export async function exportPayrollCsv(p: Persistence, actor: Actor): Promise<PayrollExport> {
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);
  const [claims, people] = await Promise.all([reads.listClaims(), reads.listPeople()]);
  const nameById = new Map(people.map((x) => [x.personId, x.fullName]));

  const payable = claims.filter((c) => c.status === 'Approved' || c.status === 'Paid');
  const lines = [PAYROLL_HEADER.map(csvCell).join(',')];
  for (const c of payable) {
    lines.push(
      [
        c.claimId,
        c.submittedBy,
        c.personId ? `${nameById.get(c.personId) ?? c.personId}` : '',
        c.category,
        c.description,
        (c.amountMinor / 100).toFixed(2),
        c.currency,
        c.expenseOn,
        c.status,
        c.paymentSourceLabel ?? '',
        c.refNo ?? '',
        c.reviewedBy ?? '',
      ].map(csvCell).join(','),
    );
  }
  return { csv: lines.join('\r\n') + '\r\n', count: payable.length };
}
