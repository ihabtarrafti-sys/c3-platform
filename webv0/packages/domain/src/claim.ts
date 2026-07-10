/**
 * claim.ts — S9, expense claims (Track A, plan of record). Retires the
 * Power Automate "Finance Intelligence Hub": staff submitted expense rows by
 * MS Form into an Excel log, and the owner flipped Status cells by hand.
 * Here the same flow is a RECORD with a lifecycle and receipts:
 *
 *   Submitted → InReview → Approved → Paid
 *                        ↘ Rejected (reason mandatory)
 *
 *   - A claim is ONE expense item (amount + currency + category + date +
 *     description) — cheap to submit; batches are just several claims.
 *   - ANYONE except read-only roles submits (staff get money back);
 *     DECIDING takes finance standing, and the SUBMITTER may never decide
 *     their own claim (the pipeline's separation law, applied here).
 *   - Receipts are S4 documents owned by the claim (CLM-XXXX).
 *   - Paid records the payment fact with a bank LABEL only (standing law).
 *
 * BUILT AS CORE per the recorded recommendation (Open-Q2 is the owner's:
 * core vs HR-module — the design doc carries the options; the domain
 * boundary here keeps repackaging cheap either way).
 */

import { z } from 'zod';
import { EXPENSE_CATEGORIES } from './missionLine';
import type { CurrencyCode } from './money';
import { currencyCodeSchema } from './money';
import { isoDateSchema } from './credential';

export const CLAIM_STATUSES = ['Submitted', 'InReview', 'Approved', 'Rejected', 'Paid'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

/** Legal transitions (single forward steps; rejection is terminal). */
export const CLAIM_TRANSITIONS: Readonly<Record<string, readonly ClaimStatus[]>> = {
  Submitted: ['InReview'],
  InReview: ['Approved', 'Rejected'],
  Approved: ['Paid'],
  Rejected: [],
  Paid: [],
};

export function canClaimTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return (CLAIM_TRANSITIONS[from] ?? []).includes(to);
}

export interface Claim {
  /** Canonical business identity, e.g. "CLM-0001". */
  readonly claimId: string;
  readonly tenantId: string;
  /** The submitting identity — the person who gets the money back. */
  readonly submittedBy: string;
  /** Optional: whose expense this concerns (a player's per-diem top-up …). */
  readonly personId: string | null;
  /** Optional mission context. */
  readonly missionId: string | null;
  readonly category: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  /** When the expense happened (ISO date). */
  readonly expenseOn: string;
  readonly status: ClaimStatus;
  readonly reviewedBy: string | null;
  readonly rejectionReason: string | null;
  readonly paidOn: string | null;
  /** Bank LABEL only — never an account number. */
  readonly paymentSourceLabel: string | null;
  readonly refNo: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── inputs ───────────────────────────────────────────────────────────────────

/** Claim categories = the expense taxonomy (+ 'Other' is already in it). */
export const CLAIM_CATEGORIES = EXPENSE_CATEGORIES;

export const submitClaimInputSchema = z
  .object({
    category: z.string().refine((v) => (CLAIM_CATEGORIES as readonly string[]).includes(v), 'Unknown expense category'),
    description: z.string().trim().min(1, 'Say what the expense was').max(500),
    amountMinor: z.number().int().positive().max(9_000_000_000_000),
    currency: currencyCodeSchema,
    expenseOn: isoDateSchema,
    personId: z
      .string()
      .regex(/^PER-\d{4,}$/)
      .nullish()
      .transform((v) => v ?? null),
    missionId: z
      .string()
      .regex(/^MSN-\d{4,}$/)
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict();
export type SubmitClaimInput = z.infer<typeof submitClaimInputSchema>;

export const decideClaimInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    decision: z.enum(['beginReview', 'approve', 'reject']),
    /** Mandatory for reject. */
    reason: z
      .string()
      .trim()
      .max(500)
      .nullish()
      .transform((v) => (v === undefined || v === null || v === '' ? null : v)),
  })
  .strict()
  .refine((v) => v.decision !== 'reject' || v.reason !== null, { message: 'A rejection needs a reason', path: ['reason'] });
export type DecideClaimInput = z.infer<typeof decideClaimInputSchema>;

export const payClaimInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    paymentSourceLabel: z.string().trim().min(1, 'A payment-source LABEL is required (never an account number)').max(60),
    refNo: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((v) => (v === undefined || v === null || v === '' ? null : v)),
  })
  .strict();
export type PayClaimInput = z.infer<typeof payClaimInputSchema>;
