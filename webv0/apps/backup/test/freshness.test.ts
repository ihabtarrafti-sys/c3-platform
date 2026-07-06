import { describe, it, expect } from 'vitest';
import { evaluateFreshness, DEFAULT_STALE_THRESHOLD_HOURS } from '../src/freshness';

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
