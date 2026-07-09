/**
 * agreementTerm.ts — the typed FINANCIAL TERMS of an agreement (Finance
 * Sprint 3; design: docs/design/FINANCE-S3-agreement-terms.md).
 *
 * An agreement's money is no longer a single headline number: it is a typed
 * sub-collection of terms — a monthly Salary, one-off Performance bonuses,
 * Milestone payments (amount + trigger), and Prize shares (a percentage, both
 * a personal cut and a team cut). Each term is one row.
 *
 * Two shapes, discriminated by kind:
 *   - MONETARY kinds (Salary, PerformanceBonus, Milestone) carry a money
 *     amount — integer minor units + an ISO currency (the money.ts discipline).
 *   - PERCENT kinds (PrizeSharePersonal, PrizeShareTeam) carry a share as
 *     integer BASIS POINTS (1..10000 = 0.01%..100% — never a float).
 * `label` is the free-text descriptor: a bonus's condition, a milestone's
 * trigger (REQUIRED for Milestone), or an optional note on a salary/share.
 *
 * GOVERNANCE: terms are DIRECT-BUT-AUDITED (owner/operations write; the read is
 * gated to canViewFinancials — legal reads agreements WITHOUT terms). This
 * mirrors per-diem: money detail hung on a governed parent. The agreement's
 * MATERIAL lifecycle (existence, term dates, termination) stays governed. Kind
 * is immutable once created (to change it, remove the term and add another).
 */

import { z } from 'zod';
import { currencyCodeSchema, type CurrencyCode, MINOR_UNITS_PER_UNIT } from './money';
import { ValidationError } from './errors';

export const AGREEMENT_TERM_KINDS = [
  'Salary',
  'PerformanceBonus',
  'Milestone',
  'PrizeSharePersonal',
  'PrizeShareTeam',
] as const;
export type AgreementTermKind = (typeof AGREEMENT_TERM_KINDS)[number];

/** Kinds that carry a money amount (amountMinor + currency). */
export const MONETARY_TERM_KINDS = ['Salary', 'PerformanceBonus', 'Milestone'] as const;
/** Kinds that carry a percentage share (percentBps). */
export const PERCENT_TERM_KINDS = ['PrizeSharePersonal', 'PrizeShareTeam'] as const;

export function isMonetaryTermKind(kind: AgreementTermKind): boolean {
  return (MONETARY_TERM_KINDS as readonly string[]).includes(kind);
}
export function isPercentTermKind(kind: AgreementTermKind): boolean {
  return (PERCENT_TERM_KINDS as readonly string[]).includes(kind);
}
/** Milestone is the one kind whose label (the trigger) is mandatory. */
export function termLabelRequired(kind: AgreementTermKind): boolean {
  return kind === 'Milestone';
}

/** A single financial term on an agreement (surrogate UUID lives in persistence). */
export interface AgreementTerm {
  /** Canonical business identity, e.g. "TRM-0001". */
  readonly termId: string;
  readonly tenantId: string;
  /** The parent agreement (AGR-XXXX). */
  readonly agreementId: string;
  readonly kind: AgreementTermKind;
  /** Monetary kinds: integer minor units (> 0). Percent kinds: null. */
  readonly amountMinor: number | null;
  /** Monetary kinds: the currency. Percent kinds: null. */
  readonly currency: CurrencyCode | null;
  /** Percent kinds: basis points (1..10000). Monetary kinds: null. */
  readonly percentBps: number | null;
  /** Condition / trigger / note. Required for Milestone; optional otherwise. */
  readonly label: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── percentage helpers (basis points, no floats stored) ──────────────────────

/** 100% = 10000 basis points. A share is a positive fraction of at most 100%. */
export const MAX_PERCENT_BPS = 10_000;

/** Convert a human percent (e.g. 7.5) to integer basis points (750). */
export function percentToBps(percent: number): number {
  return Math.round(percent * 100);
}

/** Format basis points as a trimmed percent, e.g. 1500 → "15%", 750 → "7.5%". */
export function formatPercentBps(bps: number): string {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
}

/** The normalized column values a term persists — the single storable shape. */
export interface TermValues {
  readonly amountMinor: number | null;
  readonly currency: CurrencyCode | null;
  readonly percentBps: number | null;
  readonly label: string | null;
}

/**
 * THE per-kind shape rule (one source of truth for create and update):
 * monetary kinds require amount+currency and forbid a percentage; percent kinds
 * require a percentage and forbid money; Milestone additionally requires a
 * label (its trigger). Throws ValidationError on any violation. The DB CHECK
 * in migration 0019 is the ultimate backstop.
 */
export function assertTermShape(kind: AgreementTermKind, v: TermValues): void {
  if (isMonetaryTermKind(kind)) {
    if (v.amountMinor == null || v.amountMinor <= 0) {
      throw new ValidationError('This term needs a positive amount.', { kind });
    }
    if (v.currency == null) throw new ValidationError('This term needs a currency.', { kind });
    if (v.percentBps != null) throw new ValidationError('A monetary term does not carry a percentage.', { kind });
    if (termLabelRequired(kind) && (v.label == null || v.label === '')) {
      throw new ValidationError('A milestone needs a trigger.', { kind });
    }
  } else {
    if (v.percentBps == null || v.percentBps <= 0 || v.percentBps > MAX_PERCENT_BPS) {
      throw new ValidationError('A share must be greater than 0% and at most 100%.', { kind });
    }
    if (v.amountMinor != null || v.currency != null) {
      throw new ValidationError('A share term does not carry a money amount.', { kind });
    }
  }
}

// ── input contracts ──────────────────────────────────────────────────────────

const positiveAmountMinor = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const percentBpsField = z.number().int().min(1).max(MAX_PERCENT_BPS);
const labelField = z
  .string()
  .trim()
  .max(200)
  .transform((v) => (v === '' ? null : v))
  .nullish()
  .transform((v) => v ?? null);

/**
 * Create a term. Field-level shapes are validated here; the CROSS-field
 * per-kind rule is enforced by assertTermShape in the use-case (one rule,
 * shared with update) and by the DB CHECK.
 */
export const agreementTermCreateInputSchema = z
  .object({
    kind: z.enum(AGREEMENT_TERM_KINDS),
    amountMinor: positiveAmountMinor.nullish().transform((v) => v ?? null),
    currency: currencyCodeSchema.nullish().transform((v) => v ?? null),
    percentBps: percentBpsField.nullish().transform((v) => v ?? null),
    label: labelField,
  })
  .strict();
export type AgreementTermCreateInput = z.infer<typeof agreementTermCreateInputSchema>;

/**
 * Update a term. Kind is immutable (absent here). The new value set is
 * validated against the STORED kind by assertTermShape in the use-case.
 */
export const agreementTermUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    amountMinor: positiveAmountMinor.nullish().transform((v) => v ?? null),
    currency: currencyCodeSchema.nullish().transform((v) => v ?? null),
    percentBps: percentBpsField.nullish().transform((v) => v ?? null),
    label: labelField,
  })
  .strict();
export type AgreementTermUpdateInput = z.infer<typeof agreementTermUpdateInputSchema>;

// ── governed submit contracts (Finance S3.5: term changes are dual-controlled) ─
// A term change is MATERIAL money and rides the approval pipeline (requester ≠
// approver; the owner executes). These are the immutable payload inputs.

const agreementIdField = z.string().regex(/^AGR-\d{4,}$/, 'agreementId must be a canonical AGR id');
const termIdField = z.string().regex(/^TRM-\d{4,}$/, 'termId must be a canonical TRM id');

/** Submit adding a term: the create fields plus the owning agreement. */
export const submitAddAgreementTermInputSchema = z
  .object({
    agreementId: agreementIdField,
    kind: z.enum(AGREEMENT_TERM_KINDS),
    amountMinor: positiveAmountMinor.nullish().transform((v) => v ?? null),
    currency: currencyCodeSchema.nullish().transform((v) => v ?? null),
    percentBps: percentBpsField.nullish().transform((v) => v ?? null),
    label: labelField,
  })
  .strict();
export type SubmitAddAgreementTermInput = z.infer<typeof submitAddAgreementTermInputSchema>;

/** Submit changing a term's value set (kind immutable; validated at execute). */
export const submitUpdateAgreementTermInputSchema = z
  .object({
    agreementId: agreementIdField,
    termId: termIdField,
    amountMinor: positiveAmountMinor.nullish().transform((v) => v ?? null),
    currency: currencyCodeSchema.nullish().transform((v) => v ?? null),
    percentBps: percentBpsField.nullish().transform((v) => v ?? null),
    label: labelField,
  })
  .strict();
export type SubmitUpdateAgreementTermInput = z.infer<typeof submitUpdateAgreementTermInputSchema>;

/** Submit removing a term. */
export const submitRemoveAgreementTermInputSchema = z
  .object({
    agreementId: agreementIdField,
    termId: termIdField,
  })
  .strict();
export type SubmitRemoveAgreementTermInput = z.infer<typeof submitRemoveAgreementTermInputSchema>;

/** Re-export for callers formatting money terms without importing money.ts too. */
export { MINOR_UNITS_PER_UNIT };
