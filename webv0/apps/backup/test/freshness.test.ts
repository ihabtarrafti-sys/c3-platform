import { describe, it, expect } from 'vitest';
import { evaluateFreshness, DEFAULT_STALE_THRESHOLD_HOURS, FUTURE_SKEW_TOLERANCE_HOURS } from '../src/freshness';

const now = new Date('2026-07-07T12:00:00Z');
const marker = (iso: string) => JSON.stringify({ schema: 'c3-backup-latest-success/1', lastSuccessUtc: iso });

describe('freshness monitor', () => {
  it('fresh when the newest backup is within the threshold', () => {
    const r = evaluateFreshness(marker('2026-07-07T02:15:00Z'), now); // ~9.75h
    expect(r.stale).toBe(false);
    expect(r.ageHours).toBeCloseTo(9.75, 1);
  });

  it('stale when older than the threshold', () => {
    const r = evaluateFreshness(marker('2026-07-05T02:15:00Z'), now); // ~57.75h
    expect(r.stale).toBe(true);
    expect(r.reason).toMatch(/threshold/);
  });

  it('exactly the default threshold is the boundary', () => {
    expect(DEFAULT_STALE_THRESHOLD_HOURS).toBe(36);
    const justUnder = new Date(now.getTime() - 35.9 * 3_600_000).toISOString();
    const justOver = new Date(now.getTime() - 36.1 * 3_600_000).toISOString();
    expect(evaluateFreshness(marker(justUnder), now).stale).toBe(false);
    expect(evaluateFreshness(marker(justOver), now).stale).toBe(true);
  });

  it('stale when the marker is missing', () => {
    expect(evaluateFreshness(null, now).stale).toBe(true);
  });

  it('stale when the marker is malformed or lacks a timestamp', () => {
    expect(evaluateFreshness('not json', now).stale).toBe(true);
    expect(evaluateFreshness(JSON.stringify({ schema: 'x' }), now).stale).toBe(true);
    expect(evaluateFreshness(marker('not-a-date'), now).stale).toBe(true);
  });

  it('honours a custom threshold', () => {
    const r = evaluateFreshness(marker('2026-07-07T02:15:00Z'), now, 6); // 9.75h > 6h
    expect(r.stale).toBe(true);
  });
});

describe('CR-012 — a future timestamp is untrustworthy, never fresh', () => {
  it('⛔ a marker dated in the FUTURE is STALE, with the future named as the reason', () => {
    // THE FINDING. The age went negative, `ageHours > threshold` was false, and
    // both independent readers reported FRESH. A future-dated marker is not a
    // newer backup — it is clock skew at best and a corrupted or fabricated
    // pointer at worst, and the one thing it must not do is silence the monitor.
    const r = evaluateFreshness(marker('2026-07-08T12:00:00Z'), now); // 24h ahead
    expect(r.stale).toBe(true);
    expect(r.reason).toMatch(/FUTURE/);
    expect(r.reason).toMatch(/untrustworthy/);
  });

  it('tolerates small clock skew — five minutes ahead is not an alarm', () => {
    const r = evaluateFreshness(marker('2026-07-07T12:05:00Z'), now);
    expect(r.stale).toBe(false);
  });

  it('⚖️ and the boundary is the named constant, not a magic number', () => {
    const justInside = new Date(now.getTime() + (FUTURE_SKEW_TOLERANCE_HOURS - 0.01) * 3_600_000);
    const justBeyond = new Date(now.getTime() + (FUTURE_SKEW_TOLERANCE_HOURS + 0.01) * 3_600_000);
    expect(evaluateFreshness(marker(justInside.toISOString()), now).stale).toBe(false);
    expect(evaluateFreshness(marker(justBeyond.toISOString()), now).stale).toBe(true);
  });
});
