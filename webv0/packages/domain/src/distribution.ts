/**
 * distribution.ts — S8, the prize distribution engine (Track A, plan of
 * record). GK-Core does this by hand in the prize mastersheet: tournament
 * income → org cut → per-player shares (individual %s, coach cuts) → a
 * payout list with status + payment-source LABEL. S8 makes it a record:
 *
 *   - A DISTRIBUTION allocates ONE Received income line's landed money
 *     (the pool = what actually arrived). One LIVE distribution per line —
 *     revoking (all payouts still pending) frees the line for a corrected
 *     allocation. Nothing is ever deleted.
 *   - THE INVARIANT: org cut + Σ share amounts == pool, EXACTLY. Amounts are
 *     integers allocated by largest remainder — no cent is ever lost or
 *     invented, no matter how ugly the percentages.
 *   - Share percentages are basis points OF THE PLAYER POOL (pool − org cut)
 *     and must sum to exactly 10000. Seeds come from the roster's active
 *     PrizeShare agreement terms; the human edits before committing.
 *   - Payouts are facts: Pending → Paid with paidOn + paymentSourceLabel
 *     (bank LABEL only — account numbers are never stored, standing law) +
 *     bank reference. Paid → Pending is a legal audited correction.
 *
 * Posture: DIRECT-BUT-AUDITED (the S6/S2 finance standing) — allocation
 * decisions and payment facts, recorded; the money already moved through
 * governed/settled channels upstream.
 */

import { z } from 'zod';
import { ConflictError } from './errors';
import type { CurrencyCode } from './money';

export const DISTRIBUTION_STATUSES = ['Live', 'Revoked'] as const;
export type DistributionStatus = (typeof DISTRIBUTION_STATUSES)[number];

export const PAYOUT_STATUSES = ['Pending', 'Paid'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export interface Distribution {
  /** Canonical business identity, e.g. "DIST-0001". */
  readonly distributionId: string;
  readonly tenantId: string;
  readonly missionId: string;
  /** The Received income line whose landed money is allocated. */
  readonly lineId: string;
  /** The pool: what actually arrived (receivedAmountMinor ?? amountMinor). */
  readonly poolMinor: number;
  readonly currency: CurrencyCode;
  readonly orgShareBps: number;
  readonly orgCutMinor: number;
  readonly status: DistributionStatus;
  readonly revokedReason: string | null;
  readonly notes: string | null;
  readonly createdBy: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DistributionShare {
  readonly tenantId: string;
  readonly distributionId: string;
  readonly personId: string;
  /** Joined display name (read-side enrichment). */
  readonly personName: string;
  /** Basis points of the PLAYER POOL (pool − org cut); all rows sum to 10000. */
  readonly shareBps: number;
  /** The allocated integer amount (largest-remainder; rows + org cut == pool). */
  readonly amountMinor: number;
  readonly payoutStatus: PayoutStatus;
  readonly paidOn: string | null;
  /** Bank LABEL only (ESA, ADCB) — never an account number. */
  readonly paymentSourceLabel: string | null;
  readonly refNo: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── the allocation (exact, integer, deterministic) ───────────────────────────

export interface AllocatedShare {
  readonly personId: string;
  readonly shareBps: number;
  readonly amountMinor: number;
}

/**
 * Allocate a pool: org cut first (bps of the pool, floor — the org never
 * rounds itself UP at the players' expense), then the player pool split by
 * shareBps using LARGEST REMAINDER so the amounts sum to the player pool
 * EXACTLY. Deterministic tie-break: bigger share first, then personId.
 */
export function allocateDistribution(
  poolMinor: number,
  orgShareBps: number,
  shares: ReadonlyArray<{ personId: string; shareBps: number }>,
): { orgCutMinor: number; rows: AllocatedShare[] } {
  if (!Number.isInteger(poolMinor) || poolMinor <= 0) throw new RangeError('poolMinor must be a positive integer');
  if (!Number.isInteger(orgShareBps) || orgShareBps < 0 || orgShareBps > 10000) throw new RangeError('orgShareBps must be 0..10000');
  const totalBps = shares.reduce((n, s) => n + s.shareBps, 0);
  if (shares.length === 0 && orgShareBps !== 10000) {
    throw new ConflictError('With no share rows the org share must be 100%.', { orgShareBps });
  }
  if (shares.length > 0 && totalBps !== 10000) {
    throw new ConflictError(`Share percentages must sum to exactly 100% (got ${(totalBps / 100).toFixed(2)}%).`, { totalBps });
  }
  const seen = new Set<string>();
  for (const s of shares) {
    if (seen.has(s.personId)) throw new ConflictError(`Duplicate share row for ${s.personId}.`, { personId: s.personId });
    seen.add(s.personId);
    if (!Number.isInteger(s.shareBps) || s.shareBps <= 0) throw new RangeError('each shareBps must be a positive integer');
  }

  // HARDEN-2 M-02: the bps products run in BigInt — exact for every
  // contract-valid pool. Floors and remainders return to Number safely
  // (each is ≤ the pool / < 10000 respectively).
  const orgCutMinor = Number((BigInt(poolMinor) * BigInt(orgShareBps)) / 10000n);
  const playerPool = poolMinor - orgCutMinor;

  // Largest remainder: floor everyone, then hand the leftover cents to the
  // largest fractional remainders (ties: bigger share, then personId).
  const exact = shares.map((s) => ({
    personId: s.personId,
    shareBps: s.shareBps,
    floor: Number((BigInt(playerPool) * BigInt(s.shareBps)) / 10000n),
    remainder: Number((BigInt(playerPool) * BigInt(s.shareBps)) % 10000n),
  }));
  let leftover = playerPool - exact.reduce((n, e) => n + e.floor, 0);
  const order = [...exact].sort(
    (a, b) => b.remainder - a.remainder || b.shareBps - a.shareBps || a.personId.localeCompare(b.personId),
  );
  const bonus = new Map<string, number>();
  for (const e of order) {
    if (leftover <= 0) break;
    bonus.set(e.personId, 1);
    leftover -= 1;
  }
  const rows = exact.map((e) => ({ personId: e.personId, shareBps: e.shareBps, amountMinor: e.floor + (bonus.get(e.personId) ?? 0) }));

  // The law, restated as a runtime guarantee.
  const sum = orgCutMinor + rows.reduce((n, r0) => n + r0.amountMinor, 0);
  if (sum !== poolMinor) throw new Error(`allocation invariant broken: ${sum} !== ${poolMinor}`);
  return { orgCutMinor, rows };
}

// ── inputs ───────────────────────────────────────────────────────────────────

const personIdField = z.string().regex(/^PER-\d{4,}$/, 'personId must be a canonical PER id');

export const createDistributionInputSchema = z
  .object({
    missionId: z.string().regex(/^MSN-\d{4,}$/),
    lineId: z.string().regex(/^PNL-\d{4,}$/),
    orgShareBps: z.number().int().min(0).max(10000),
    shares: z
      .array(z.object({ personId: personIdField, shareBps: z.number().int().min(1).max(10000) }).strict())
      .max(100),
    notes: z
      .string()
      .trim()
      .max(2000)
      .nullish()
      .transform((v) => (v === undefined || v === null || v === '' ? null : v)),
  })
  .strict();
export type CreateDistributionInput = z.infer<typeof createDistributionInputSchema>;

export const markPayoutInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    paid: z.boolean(),
    /** Required when paid=true; bank LABEL only, never an account number. */
    paymentSourceLabel: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((v) => (v === undefined || v === null || v === '' ? null : v)),
    refNo: z
      .string()
      .trim()
      .max(60)
      .nullish()
      .transform((v) => (v === undefined || v === null || v === '' ? null : v)),
  })
  .strict();
export type MarkPayoutInput = z.infer<typeof markPayoutInputSchema>;

export const revokeDistributionInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    reason: z.string().trim().min(1, 'A revoke reason is required').max(500),
  })
  .strict();
export type RevokeDistributionInput = z.infer<typeof revokeDistributionInputSchema>;

// ── seed rows (suggestions from agreement PrizeShare terms) ──────────────────

export interface DistributionSeedRow {
  readonly personId: string;
  readonly personName: string;
  /** From the person's ACTIVE agreement's PrizeSharePersonal term, if any. */
  readonly suggestedBps: number | null;
  /** The term the suggestion came from (audit-friendly provenance). */
  readonly sourceTermId: string | null;
}
