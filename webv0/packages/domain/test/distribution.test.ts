/**
 * distribution.test.ts — S8: the allocation law (org cut + Σ shares == pool,
 * EXACTLY, by largest remainder), the 100% rule, and the input contracts.
 */
import { describe, expect, it } from 'vitest';
import { allocateDistribution, ConflictError, createDistributionInputSchema, markPayoutInputSchema } from '../src/index';

describe('allocateDistribution — the exact-sum law', () => {
  it('splits a clean pool: org floor first, players by bps', () => {
    const { orgCutMinor, rows } = allocateDistribution(1_000_000, 2000, [
      { personId: 'PER-0001', shareBps: 5000 },
      { personId: 'PER-0002', shareBps: 3000 },
      { personId: 'PER-0003', shareBps: 2000 },
    ]);
    expect(orgCutMinor).toBe(200_000);
    expect(rows.map((r) => r.amountMinor)).toEqual([400_000, 240_000, 160_000]);
    expect(orgCutMinor + rows.reduce((n, r) => n + r.amountMinor, 0)).toBe(1_000_000);
  });

  it('largest remainder: ugly thirds still sum exactly; leftover cents go to the largest remainders', () => {
    // Pool 100, no org cut, three equal thirds (3333/3333/3334 bps won't be
    // given — use 3 × 3333 + 1 spare bps on the first).
    const { orgCutMinor, rows } = allocateDistribution(100, 0, [
      { personId: 'PER-0001', shareBps: 3334 },
      { personId: 'PER-0002', shareBps: 3333 },
      { personId: 'PER-0003', shareBps: 3333 },
    ]);
    expect(orgCutMinor).toBe(0);
    expect(rows.reduce((n, r) => n + r.amountMinor, 0)).toBe(100);
    // Deterministic: run twice, same result.
    const again = allocateDistribution(100, 0, [
      { personId: 'PER-0001', shareBps: 3334 },
      { personId: 'PER-0002', shareBps: 3333 },
      { personId: 'PER-0003', shareBps: 3333 },
    ]);
    expect(again.rows).toEqual(rows);
  });

  it('multiple leftover cents go to DISTINCT recipients, never piled on one', () => {
    // Pool 100, no org cut. floors 32/32/34 sum to 98 → TWO leftover cents.
    // The law: each spare cent goes to a distinct largest-remainder recipient
    // (+1 each), never +2 on the top one. Both distributions satisfy the
    // sum invariant, so only the per-row amounts discriminate them.
    const { rows } = allocateDistribution(100, 0, [
      { personId: 'PER-0001', shareBps: 3267 },
      { personId: 'PER-0002', shareBps: 3267 },
      { personId: 'PER-0003', shareBps: 3466 },
    ]);
    expect(rows.map((r) => r.amountMinor)).toEqual([33, 33, 34]);
    const bonuses = rows.map((r, i) => r.amountMinor - [32, 32, 34][i]!);
    expect(bonuses.filter((b) => b === 1)).toHaveLength(2); // two distinct recipients
    expect(bonuses.every((b) => b <= 1)).toBe(true); // never piled (+2) on one
    expect(rows.reduce((n, r) => n + r.amountMinor, 0)).toBe(100);
  });

  it('a rounding storm across many odd shares never loses or invents a cent', () => {
    const shares = Array.from({ length: 7 }, (_, i) => ({ personId: `PER-000${i + 1}`, shareBps: i === 0 ? 1430 : 1428 + (i % 2) }));
    const total = shares.reduce((n, s) => n + s.shareBps, 0);
    shares[0] = { ...shares[0]!, shareBps: shares[0]!.shareBps + (10000 - total) }; // force exact 10000
    for (const pool of [101, 999, 12_345, 1_000_001]) {
      const { orgCutMinor, rows } = allocateDistribution(pool, 250, shares);
      expect(orgCutMinor + rows.reduce((n, r) => n + r.amountMinor, 0)).toBe(pool);
    }
  });

  it('org-only distributions are legal at exactly 100% org share', () => {
    const { orgCutMinor, rows } = allocateDistribution(5000, 10000, []);
    expect(orgCutMinor).toBe(5000);
    expect(rows).toEqual([]);
    expect(() => allocateDistribution(5000, 9000, [])).toThrow(ConflictError);
  });

  it('refusals: shares must sum to exactly 100%; duplicates refused', () => {
    expect(() => allocateDistribution(100, 0, [{ personId: 'PER-0001', shareBps: 9999 }])).toThrow(/sum to exactly 100%/);
    expect(() =>
      allocateDistribution(100, 0, [
        { personId: 'PER-0001', shareBps: 5000 },
        { personId: 'PER-0001', shareBps: 5000 },
      ]),
    ).toThrow(/Duplicate share row/);
  });
});

describe('inputs', () => {
  it('create: canonical ids, bps ranges, notes blank→null', () => {
    const parsed = createDistributionInputSchema.parse({
      missionId: 'MSN-0001',
      lineId: 'PNL-0001',
      orgShareBps: 2000,
      shares: [{ personId: 'PER-0001', shareBps: 10000 }],
      notes: '',
    });
    expect(parsed.notes).toBeNull();
    expect(createDistributionInputSchema.safeParse({ missionId: 'MSN-0001', lineId: 'PNL-0001', orgShareBps: 10001, shares: [] }).success).toBe(false);
  });

  it('payout: paid flips carry the label rule at the boundary shape', () => {
    const parsed = markPayoutInputSchema.parse({ expectedVersion: 0, paid: true, paymentSourceLabel: ' ESA ', refNo: 'FT123' });
    expect(parsed.paymentSourceLabel).toBe('ESA');
  });
});

describe('HARDEN-2 M-02 — allocation in BigInt at the amount cap', () => {
  it('a 9e11 pool splits exactly (org cut + shares == pool) with odd bps', () => {
    const pool = 900_000_000_000; // MAX_AMOUNT_MINOR
    const { orgCutMinor, rows } = allocateDistribution(pool, 3333, [
      { personId: 'PER-0001', shareBps: 3334 },
      { personId: 'PER-0002', shareBps: 3333 },
      { personId: 'PER-0003', shareBps: 3333 },
    ]);
    expect(orgCutMinor + rows.reduce((n, r) => n + r.amountMinor, 0)).toBe(pool);
    expect(orgCutMinor).toBe(Number((BigInt(pool) * 3333n) / 10000n));
  });
});
