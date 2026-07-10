/**
 * invoice.test.ts — S6: the series number law, half-up VAT on integers, and
 * the issue/void invariants that keep the line the single source of payment
 * truth.
 */
import { describe, expect, it } from 'vitest';
import {
  assertInvoiceVoidable,
  assertLineInvoiceable,
  computeVatMinor,
  formatInvoiceNumber,
  invoiceSeriesKind,
  issueInvoiceInputSchema,
  voidInvoiceInputSchema,
  InvoiceRuleError,
} from '../src/index';

describe('the series number', () => {
  it('formats {CODE}-INV-{YYYY}-{NNN}, 3-digit padded, growing past 999', () => {
    expect(formatInvoiceNumber('GKA', 2026, 1)).toBe('GKA-INV-2026-001');
    expect(formatInvoiceNumber('GKEC', 2026, 42)).toBe('GKEC-INV-2026-042');
    expect(formatInvoiceNumber('GKA', 2027, 1234)).toBe('GKA-INV-2027-1234');
    expect(() => formatInvoiceNumber('GKA', 2026, 0)).toThrow(RangeError);
  });

  it('the counter kind is per entity per year — separate series never collide', () => {
    expect(invoiceSeriesKind('ENT-0001', 2026)).toBe('invoice-series:ENT-0001:2026');
    expect(invoiceSeriesKind('ENT-0001', 2027)).not.toBe(invoiceSeriesKind('ENT-0001', 2026));
    expect(invoiceSeriesKind('ENT-0002', 2026)).not.toBe(invoiceSeriesKind('ENT-0001', 2026));
  });
});

describe('VAT math (integer, half-up)', () => {
  it('computes exact and rounded cases half-up to the minor unit', () => {
    expect(computeVatMinor(1000, 1500)).toBe(150); // 15% of 10.00 = 1.50 exact
    expect(computeVatMinor(999, 1500)).toBe(150); // 149.85 → 150
    expect(computeVatMinor(33, 1500)).toBe(5); // 4.95 → 5
    expect(computeVatMinor(3, 1500)).toBe(0); // 0.45 → 0
    expect(computeVatMinor(10, 500)).toBe(1); // 0.5 → 1 (half rounds UP)
    expect(computeVatMinor(800000, 500)).toBe(40000); // 5% of 8,000.00
    expect(computeVatMinor(123456789, 0)).toBe(0);
  });

  it('refuses non-integer or out-of-range inputs', () => {
    expect(() => computeVatMinor(10.5, 1500)).toThrow(RangeError);
    expect(() => computeVatMinor(1000, -1)).toThrow(RangeError);
    expect(() => computeVatMinor(1000, 10001)).toThrow(RangeError);
  });
});

describe('inputs', () => {
  it('issue: canonical ids, required billed-to, VAT 0..10000, blanks → null', () => {
    const parsed = issueInvoiceInputSchema.parse({
      missionId: 'MSN-0001',
      lineId: 'PNL-0002',
      entityId: 'ENT-0001',
      billedToName: '  VSPN  ',
      billedToDetails: '',
      vatRateBps: 500,
      description: undefined,
    });
    expect(parsed.billedToName).toBe('VSPN');
    expect(parsed.billedToDetails).toBeNull();
    expect(parsed.description).toBeNull();
    expect(issueInvoiceInputSchema.safeParse({ missionId: 'MSN-1', lineId: 'PNL-0001', entityId: 'ENT-0001', billedToName: 'X', vatRateBps: 0 }).success).toBe(false);
    expect(issueInvoiceInputSchema.safeParse({ missionId: 'MSN-0001', lineId: 'PNL-0001', entityId: 'ENT-0001', billedToName: 'X', vatRateBps: 10001 }).success).toBe(false);
  });

  it('void: a reason is mandatory', () => {
    expect(voidInvoiceInputSchema.safeParse({ reason: '  ', expectedVersion: 0 }).success).toBe(false);
    expect(voidInvoiceInputSchema.parse({ reason: 'Wrong VAT rate', expectedVersion: 3 }).reason).toBe('Wrong VAT rate');
  });
});

describe('invariants', () => {
  it('invoiceable: income + active + Expected; every other state names its refusal', () => {
    expect(() => assertLineInvoiceable({ direction: 'Income', isActive: true, paymentStatus: 'Expected' })).not.toThrow();
    expect(() => assertLineInvoiceable({ direction: 'Expense', isActive: true, paymentStatus: null })).toThrow(InvoiceRuleError);
    expect(() => assertLineInvoiceable({ direction: 'Income', isActive: false, paymentStatus: 'Expected' })).toThrow(/removed/);
    expect(() => assertLineInvoiceable({ direction: 'Income', isActive: true, paymentStatus: 'Invoiced' })).toThrow(/live invoice/);
    expect(() => assertLineInvoiceable({ direction: 'Income', isActive: true, paymentStatus: 'Received' })).toThrow(/already been received/);
  });

  it('voidable: only Issued, and never once the money is recorded as received', () => {
    expect(() => assertInvoiceVoidable({ status: 'Issued' }, { paymentStatus: 'Invoiced' })).not.toThrow();
    expect(() => assertInvoiceVoidable({ status: 'Voided' }, { paymentStatus: 'Invoiced' })).toThrow(/Only an issued/);
    expect(() => assertInvoiceVoidable({ status: 'Issued' }, { paymentStatus: 'Received' })).toThrow(/correct the line/);
  });
});
