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

/** Keyset page size — the export never holds more than this many rows at once. */
const PAYROLL_PAGE = 500;

/**
 * Every APPROVED or PAID claim as a payroll row (approved = to pay, paid =
 * reconciliation, distinguished by the Status column). Finance visibility
 * (owner/ops/finance/management) — the gate keeps a bare submitter out.
 *
 * L-05: the payable filter + payee-name join now run in SQL and stream through
 * keyset pages, so this never materialises the whole claim + person registers.
 * The row shape, order (created_at desc, claim_id desc), and the payee-name
 * fallback (name → personId → '') are identical to the old load-everything path.
 */
export async function exportPayrollCsv(p: Persistence, actor: Actor): Promise<PayrollExport> {
  assertViewFinancials(actor);
  const reads = p.reads.forActor(actor);

  const lines = [PAYROLL_HEADER.map(csvCell).join(',')];
  let count = 0;
  let after: { createdAt: string; claimId: string } | null = null;
  for (;;) {
    const page = await reads.listPayableClaimsWithPayee(after, PAYROLL_PAGE);
    for (const c of page) {
      lines.push(
        [
          c.claimId,
          c.submittedBy,
          c.personId ? `${c.payeeName ?? c.personId}` : '',
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
      count += 1;
    }
    if (page.length < PAYROLL_PAGE) break;
    const last = page[page.length - 1]!;
    after = { createdAt: last.createdAt, claimId: last.claimId };
  }
  return { csv: lines.join('\r\n') + '\r\n', count };
}
