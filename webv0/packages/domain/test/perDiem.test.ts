import { describe, expect, it } from 'vitest';
import { missionDayCount, setParticipantPerDiemInputSchema } from '../src/mission';

describe('missionDayCount — inclusive per-diem day span', () => {
  it('counts both ends (Sep 12 → Sep 21 = 10 days)', () => {
    expect(missionDayCount('2026-09-12', '2026-09-21')).toBe(10);
  });
  it('a single-day mission is 1 day', () => {
    expect(missionDayCount('2026-09-12', '2026-09-12')).toBe(1);
  });
  it('null end (open-ended mission) yields null — total is unknowable', () => {
    expect(missionDayCount('2026-09-12', null)).toBeNull();
  });
  it('an end before the start yields null (not a negative count)', () => {
    expect(missionDayCount('2026-09-21', '2026-09-12')).toBeNull();
  });
});

describe('setParticipantPerDiem — amount and currency move together', () => {
  const base = { missionId: 'MSN-0001', personId: 'PER-0001', expectedVersion: 0 };
  it('accepts a paired amount+currency', () => {
    expect(setParticipantPerDiemInputSchema.safeParse({ ...base, perDiemAmountMinor: 5000, perDiemCurrency: 'SAR' }).success).toBe(true);
  });
  it('accepts a full clear (both null)', () => {
    expect(setParticipantPerDiemInputSchema.safeParse({ ...base, perDiemAmountMinor: null, perDiemCurrency: null }).success).toBe(true);
  });
  it('rejects a lone amount or a lone currency', () => {
    expect(setParticipantPerDiemInputSchema.safeParse({ ...base, perDiemAmountMinor: 5000, perDiemCurrency: null }).success).toBe(false);
    expect(setParticipantPerDiemInputSchema.safeParse({ ...base, perDiemAmountMinor: null, perDiemCurrency: 'SAR' }).success).toBe(false);
  });
});
