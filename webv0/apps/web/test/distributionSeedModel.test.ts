import { describe, expect, it } from 'vitest';
import {
  distributionSeedReducer,
  EMPTY_DISTRIBUTION_SEED,
} from '../src/components/distributionSeedModel';

describe('distributionSeedReducer', () => {
  it('keeps a failed seed read distinct from a verified empty seed', () => {
    const loading = distributionSeedReducer(EMPTY_DISTRIBUTION_SEED, { type: 'start', lineId: 'LINE-1' });
    const failed = distributionSeedReducer(loading, {
      type: 'fail',
      lineId: 'LINE-1',
      message: 'Seed unavailable.',
    });
    const empty = distributionSeedReducer(loading, { type: 'succeed', lineId: 'LINE-1', rows: [] });

    expect(failed).toEqual({ kind: 'fetch-failed', lineId: 'LINE-1', message: 'Seed unavailable.' });
    expect(empty).toEqual({ kind: 'verified', lineId: 'LINE-1', rows: [] });
  });

  it('ignores a late response for a line that is no longer selected', () => {
    const first = distributionSeedReducer(EMPTY_DISTRIBUTION_SEED, { type: 'start', lineId: 'LINE-1' });
    const second = distributionSeedReducer(first, { type: 'start', lineId: 'LINE-2' });

    expect(
      distributionSeedReducer(second, {
        type: 'succeed',
        lineId: 'LINE-1',
        rows: [{ personId: 'PER-1', personName: 'Old row', bps: '100' }],
      }),
    ).toBe(second);
  });

  it('permits row editing only after a successful seed witness', () => {
    const loading = distributionSeedReducer(EMPTY_DISTRIBUTION_SEED, { type: 'start', lineId: 'LINE-2' });
    expect(
      distributionSeedReducer(loading, {
        type: 'replace-rows',
        rows: [{ personId: 'PER-2', personName: 'Unwitnessed', bps: '100' }],
      }),
    ).toBe(loading);

    const verified = distributionSeedReducer(loading, { type: 'succeed', lineId: 'LINE-2', rows: [] });
    expect(
      distributionSeedReducer(verified, {
        type: 'replace-rows',
        rows: [{ personId: 'PER-2', personName: 'Witnessed', bps: '100' }],
      }),
    ).toEqual({
      kind: 'verified',
      lineId: 'LINE-2',
      rows: [{ personId: 'PER-2', personName: 'Witnessed', bps: '100' }],
    });
  });
});
