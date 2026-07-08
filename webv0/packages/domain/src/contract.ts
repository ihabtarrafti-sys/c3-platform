/**
 * contract.ts — the Contract domain entity and its operation contracts
 * (Sprint 41; design: docs/design/S41-contracts-domain.md).
 *
 * This domain deliberately goes BEYOND the CP: the reference app's contracts
 * were read-only V1 (its capture-renewal write was a mock). Here the material
 * lifecycle is GOVERNED — AddContract / RenewContract / TerminateContract ride
 * the approval pipeline — while NON-MATERIAL fields (code, type, notes) are
 * DIRECT-BUT-AUDITED with the version guard. Dates and value are material
 * terms: they never move through the direct path.
 *
 * Money is integer CENTS end-to-end (never floats). Dates are plain ISO
 * strings end-to-end (the Credentials discipline). Renewal urgency is DERIVED
 * read-side (the credentialStatusOn pattern) — Expired is never stored.
 */

import { z } from 'zod';
import { isoDateSchema } from './credential';

export const CONTRACT_STATUSES = ['Active', 'Terminated'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

/** A Contract as the domain reasons about it (surrogate UUID lives in persistence). */
export interface Contract {
  /** Canonical business identity, e.g. "CTR-0001". */
  readonly contractId: string;
  readonly tenantId: string;
  /** The owning person's canonical id (PER-XXXX). */
  readonly personId: string;
  /** Optional human canonical code (the CP convention, e.g. "GKE-PL-2026-001"). */
  readonly contractCode: string | null;
  readonly contractType: string;
  /** ISO calendar date, YYYY-MM-DD. */
  readonly startsOn: string;
  /** Required: a term contract. Renewal extends it (governed). */
  readonly endsOn: string;
  /**
   * Contract value in integer US cents; null = not recorded. FINANCIAL FIELD:
   * the read model omits it entirely for roles without canViewFinancials —
   * absence, not masking.
   */
  readonly valueUsdCents: number | null;
  readonly notes: string | null;
  /** Terminated is terminal and stored; Expired is DERIVED, never stored. */
  readonly status: ContractStatus;
  /** Optimistic-concurrency token (monotonic integer). */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── derived renewal state (read-side only; no scheduler) ─────────────────────

export type ContractRenewalState = 'Terminated' | 'Expired' | 'Due30' | 'Due60' | 'Due90' | 'Active';

function horizonIso(todayIso: string, days: number): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
}

/**
 * The CP Renewals-center 30/60/90 windows as a pure derivation. Boundary:
 * endsOn == today is Due30 (still active, most urgent window); the day after
 * the end date it becomes Expired.
 */
export function contractRenewalStateOn(
  c: Pick<Contract, 'status' | 'endsOn'>,
  todayIso: string,
): ContractRenewalState {
  if (c.status === 'Terminated') return 'Terminated';
  if (c.endsOn < todayIso) return 'Expired';
  if (c.endsOn <= horizonIso(todayIso, 30)) return 'Due30';
  if (c.endsOn <= horizonIso(todayIso, 60)) return 'Due60';
  if (c.endsOn <= horizonIso(todayIso, 90)) return 'Due90';
  return 'Active';
}

// ── input contracts ──────────────────────────────────────────────────────────

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const personIdField = z.string().regex(/^PER-\d{4,}$/, 'personId must be a canonical PER id');
const contractIdField = z.string().regex(/^CTR-\d{4,}$/, 'contractId must be a canonical CTR id');

/** Integer US cents, non-negative, safely representable. */
const centsField = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

/** AddContract — the governed creation request. */
export const addContractInputSchema = z
  .object({
    personId: personIdField,
    contractCode: trimmedOptional(60),
    contractType: z.string().trim().min(1, 'Contract type is required').max(120),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    valueUsdCents: centsField.nullish().transform((v) => v ?? null),
    notes: trimmedOptional(2000),
  })
  .strict()
  .refine((v) => v.endsOn >= v.startsOn, {
    message: 'End date must be on or after the start date',
    path: ['endsOn'],
  });
export type AddContractInput = z.infer<typeof addContractInputSchema>;

/**
 * RenewContract — governed term extension (the write the CP never shipped).
 * newEndsOn must beat the STORED end date; the boundary check here is shape
 * only — the authoritative comparison happens at submit (friendly) and again
 * inside the execution transaction.
 */
export const renewContractInputSchema = z
  .object({
    contractId: contractIdField,
    newEndsOn: isoDateSchema,
  })
  .strict();
export type RenewContractInput = z.infer<typeof renewContractInputSchema>;

/** TerminateContract — governed, terminal, reason mandatory (audited). */
export const terminateContractInputSchema = z
  .object({
    contractId: contractIdField,
    reason: z.string().trim().min(1, 'A termination reason is mandatory').max(1000),
  })
  .strict();
export type TerminateContractInput = z.infer<typeof terminateContractInputSchema>;

/**
 * Direct-but-audited update — NON-MATERIAL fields only, plus the mandatory
 * expected version. Dates and value are material terms and move ONLY through
 * the governed operations above.
 */
export const contractUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    contractCode: trimmedOptional(60).optional(),
    contractType: z.string().trim().min(1).max(120).optional(),
    notes: trimmedOptional(2000).optional(),
  })
  .strict()
  .refine(
    (v) => ['contractCode', 'contractType', 'notes'].some((k) => k in v && v[k as keyof typeof v] !== undefined),
    { message: 'An update must change at least one field' },
  );
export type ContractUpdateInput = z.infer<typeof contractUpdateInputSchema>;
