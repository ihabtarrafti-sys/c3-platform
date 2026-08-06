import { describe, expect, it } from 'vitest';
import {
  distributionSeedReducer,
  EMPTY_DISTRIBUTION_SEED,
} from '../src/components/distributionSeedModel';

describe('distributionSeedReducer', () => {
  it('keeps a failed seed read distinct from a verified empty seed', () => {
    const loading = distributionSeedReducer(EMPTY_DISTRIBUTION_SEED, {
      type: 'start',
      lineId: 'LINE-1',
      requestToken: 1,
    });
    const failed = distributionSeedReducer(loading, {
      type: 'fail',
      lineId: 'LINE-1',
      requestToken: 1,
      message: 'Seed unavailable.',
    });
    const empty = distributionSeedReducer(loading, {
      type: 'succeed',
      lineId: 'LINE-1',
      requestToken: 1,
      rows: [],
    });

    expect(failed).toEqual({ kind: 'fetch-failed', lineId: 'LINE-1', requestToken: 1, message: 'Seed unavailable.' });
    expect(empty).toEqual({ kind: 'verified', lineId: 'LINE-1', requestToken: 1, rows: [] });
  });

  it('ignores a late response for a line that is no longer selected', () => {
    const first = distributionSeedReducer(EMPTY_DISTRIBUTION_SEED, {
      type: 'start',
      lineId: 'LINE-1',
      requestToken: 1,
    });
    const second = distributionSeedReducer(first, { type: 'start', lineId: 'LINE-2', requestToken: 2 });

    expect(
      distributionSeedReducer(second, {
        type: 'succeed',
        lineId: 'LINE-1',
        requestToken: 1,
        rows: [{ personId: 'PER-1', personName: 'Old row', bps: '100' }],
      }),
    ).toBe(second);
  });

  it('uses request identity, not line identity, across an A to B to A race', () => {
    const firstA = distributionSeedReducer(EMPTY_DISTRIBUTION_SEED, {
      type: 'start',
      lineId: 'LINE-A',
      requestToken: 1,
    });
    const b = distributionSeedReducer(firstA, { type: 'start', lineId: 'LINE-B', requestToken: 2 });
    const currentA = distributionSeedReducer(b, { type: 'start', lineId: 'LINE-A', requestToken: 3 });

    const afterOldA = distributionSeedReducer(currentA, {
      type: 'succeed',
      lineId: 'LINE-A',
      requestToken: 1,
      rows: [{ personId: 'PER-OLD', personName: 'Old A', bps: '100' }],
    });
    expect(afterOldA).toBe(currentA);

    expect(
      distributionSeedReducer(afterOldA, {
        type: 'succeed',
        lineId: 'LINE-A',
        requestToken: 3,
        rows: [{ personId: 'PER-NEW', personName: 'Current A', bps: '100' }],
      }),
    ).toEqual({
      kind: 'verified',
      lineId: 'LINE-A',
      requestToken: 3,
      rows: [{ personId: 'PER-NEW', personName: 'Current A', bps: '100' }],
    });
  });

  it('retains the monotonic token across reset and refuses reused request identity', () => {
    const loading = distributionSeedReducer(EMPTY_DISTRIBUTION_SEED, {
      type: 'start',
      lineId: 'LINE-A',
      requestToken: 4,
    });
    const reset = distributionSeedReducer(loading, { type: 'reset' });
    expect(reset).toEqual({ kind: 'idle', requestToken: 4 });
    expect(distributionSeedReducer(reset, { type: 'start', lineId: 'LINE-B', requestToken: 4 })).toBe(reset);
    expect(distributionSeedReducer(reset, { type: 'start', lineId: 'LINE-B', requestToken: 5 })).toEqual({
      kind: 'loading',
      lineId: 'LINE-B',
      requestToken: 5,
    });
  });

  it('permits row editing only after a successful seed witness', () => {
    const loading = distributionSeedReducer(EMPTY_DISTRIBUTION_SEED, {
      type: 'start',
      lineId: 'LINE-2',
      requestToken: 1,
    });
    expect(
      distributionSeedReducer(loading, {
        type: 'replace-rows',
        rows: [{ personId: 'PER-2', personName: 'Unwitnessed', bps: '100' }],
      }),
    ).toBe(loading);

    const verified = distributionSeedReducer(loading, {
      type: 'succeed',
      lineId: 'LINE-2',
      requestToken: 1,
      rows: [],
    });
    expect(
      distributionSeedReducer(verified, {
        type: 'replace-rows',
        rows: [{ personId: 'PER-2', personName: 'Witnessed', bps: '100' }],
      }),
    ).toEqual({
      kind: 'verified',
      lineId: 'LINE-2',
      requestToken: 1,
      rows: [{ personId: 'PER-2', personName: 'Witnessed', bps: '100' }],
    });
  });
});
