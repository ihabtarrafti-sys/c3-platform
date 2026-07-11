/**
 * invoice.ts — S6 invoice generation (Track A, plan of record). Replaces the
 * VBA generator with the same model GK-Core runs by hand:
 *
 *   - An invoice bills EXACTLY ONE mission income line (income-typed,
 *     tournament-coded). The line stays the single source of payment truth —
 *     the invoice is the outward DOCUMENT that requests the money, never a
 *     second ledger. Issuing flips the line Expected → Invoiced; voiding
 *     flips it back (unless the money already arrived).
 *   - The number is a per-entity, per-year series: {ENTITY.CODE}-INV-{YYYY}-{NNN}
 *     (GKA-INV-2025-001). Numbers are NEVER reused — a voided invoice keeps
 *     its number; the gap is the audit trail.
 *   - Money is integer minor units in the line's native currency. VAT is a
 *     basis-point rate entered per invoice (C3 states no tax law), rounded
 *     HALF-UP to the minor unit. No FX on the document — an invoice is an
 *     outward claim in one currency; ≈USD is internal reporting.
 */

import { z } from 'zod';
import { ConflictError } from './errors';
import type { CurrencyCode } from './money';

export const INVOICE_STATUSES = ['Issued', 'Voided'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface Invoice {
  /** Canonical internal identity, e.g. "INV-0001" (uniform with PER/MSN/…). */
  readonly invoiceId: string;
  readonly tenantId: string;
  /** The outward series number, e.g. "GKA-INV-2026-001". Unique per tenant. */
  readonly invoiceNumber: string;
  /** The issuing entity (ENT-XXXX) — the series owner. */
  readonly entityId: string;
  readonly missionId: string;
  /** The income line billed (PNL-XXXX). One live invoice per line. */
  readonly lineId: string;
  readonly billedToName: string;
  readonly billedToDetails: string | null;
  /** Snapshot of the line's category at issue (the "Type of Income"). */
  readonly incomeCategory: string;
  readonly description: string | null;
  readonly currency: CurrencyCode;
  readonly subtotalMinor: number;
  readonly vatRateBps: number;
  readonly vatMinor: number;
  readonly totalMinor: number;
  readonly status: InvoiceStatus;
  /** ISO date the number was allocated (also the series year). */
  readonly issuedOn: string;
  readonly issuedBy: string;
  readonly voidedReason: string | null;
  /** The stored PDF (DOC-XXXX); null until the artifact is attached. */
  readonly documentId: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── the series number ────────────────────────────────────────────────────────

/** GKA-INV-2026-001: 3-digit pad, grows past 999 without truncation. */
export function formatInvoiceNumber(entityCode: string, year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new RangeError(`Invoice series sequence must be a positive integer, got ${sequence}`);
  }
  return `${entityCode}-INV-${year}-${String(sequence).padStart(3, '0')}`;
}

/** The per-(entity, year) counter kind for allocateSequence. */
export function invoiceSeriesKind(entityId: string, year: number): `invoice-series:${string}` {
  return `invoice-series:${entityId}:${year}`;
}

// ── VAT math ─────────────────────────────────────────────────────────────────

/**
 * VAT on an integer subtotal at a basis-point rate, rounded HALF-UP to the
 * minor unit (the standard for tax documents). HARDEN-2 M-02: the product
 * runs in BigInt, so exactness holds for EVERY contract-valid subtotal — not
 * just while subtotal × 10000 happens to stay under 2^53. The result is ≤ the
 * subtotal, so the return to Number is always exact.
 */
export function computeVatMinor(subtotalMinor: number, vatRateBps: number): number {
  if (!Number.isInteger(subtotalMinor) || subtotalMinor < 0) throw new RangeError('subtotalMinor must be a non-negative integer');
  if (!Number.isInteger(vatRateBps) || vatRateBps < 0 || vatRateBps > 10000) throw new RangeError('vatRateBps must be an integer 0..10000');
  return Number((BigInt(subtotalMinor) * BigInt(vatRateBps) + 5000n) / 10000n);
}

// ── inputs ───────────────────────────────────────────────────────────────────

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v === undefined || v === null || v === '' ? null : v));

export const issueInvoiceInputSchema = z
  .object({
    missionId: z.string().regex(/^MSN-\d{4,}$/, 'missionId must be a canonical MSN id'),
    lineId: z.string().regex(/^PNL-\d{4,}$/, 'lineId must be a canonical PNL id'),
    entityId: z.string().regex(/^ENT-\d{4,}$/, 'entityId must be a canonical ENT id'),
    billedToName: z.string().trim().min(1, 'Billed-to name is required').max(200),
    billedToDetails: trimmedOptional(600),
    vatRateBps: z.number().int().min(0).max(10000),
    description: trimmedOptional(300),
  })
  .strict();
export type IssueInvoiceInput = z.infer<typeof issueInvoiceInputSchema>;

export const voidInvoiceInputSchema = z
  .object({
    reason: z.string().trim().min(1, 'A void reason is required').max(500),
    expectedVersion: z.number().int().min(0),
  })
  .strict();
export type VoidInvoiceInput = z.infer<typeof voidInvoiceInputSchema>;

// ── invariants shared by issue/void (submit-friendly AND in-tx authoritative) ─

/**
 * A refused invoice action — rides the ConflictError branch of the domain
 * taxonomy (HTTP 409): the record is fine, its STATE forbids the action.
 */
export class InvoiceRuleError extends ConflictError {
  constructor(
    public readonly rule: string,
    message: string,
  ) {
    super(message, { rule });
  }
}

/** The line an invoice may bill: income, active, and still Expected. */
export function assertLineInvoiceable(line: {
  readonly direction: string;
  readonly isActive: boolean;
  readonly paymentStatus: string | null;
}): void {
  if (line.direction !== 'Income') throw new InvoiceRuleError('NOT_INCOME', 'Only income lines are invoiced — expenses are paid, not billed.');
  if (!line.isActive) throw new InvoiceRuleError('LINE_REMOVED', 'This line has been removed from the P&L.');
  if (line.paymentStatus === 'Invoiced') throw new InvoiceRuleError('ALREADY_INVOICED', 'This line already has a live invoice — void it first to re-issue.');
  if (line.paymentStatus === 'Received') throw new InvoiceRuleError('ALREADY_RECEIVED', 'This money has already been received — there is nothing to invoice.');
}

/** Voiding is refused once the money arrived: correct the line first. */
export function assertInvoiceVoidable(invoice: Pick<Invoice, 'status'>, line: { readonly paymentStatus: string | null }): void {
  if (invoice.status !== 'Issued') throw new InvoiceRuleError('NOT_ISSUED', 'Only an issued invoice can be voided.');
  if (line.paymentStatus === 'Received') {
    throw new InvoiceRuleError('LINE_RECEIVED', 'The payment on this line is already recorded as received — correct the line before voiding its invoice.');
  }
}
