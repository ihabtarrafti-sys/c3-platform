import { describe, it, expect } from 'vitest';
import { utcStamp, objectKey, manifestKey, classesFor, isWeekly, STATUS_LATEST_SUCCESS_KEY } from '../src/naming';

const spec = (when: Date, mode: 'daily' | 'manual' = 'daily') => ({
  when,
  mode,
  environmentLabel: 'staging',
  shortSha: 'D133F0F',
});

describe('naming', () => {
  it('produces a deterministic UTC-Z timestamp', () => {
    expect(utcStamp(new Date('2026-07-07T02:15:00.000Z'))).toBe('20260707T021500Z');
  });

  it('builds a deterministic, sortable daily key with lowercased short sha', () => {
    const k = objectKey('daily', spec(new Date('2026-07-07T02:15:00Z')));
    expect(k).toBe('daily/2026/07/07/c3-staging-20260707T021500Z-d133f0f.dump.age');
    expect(manifestKey(k)).toBe(k + '.manifest.json');
  });

  it('two runs at the same instant yield identical keys (determinism)', () => {
    const t = new Date('2026-07-07T02:15:00Z');
    expect(objectKey('daily', spec(t))).toBe(objectKey('daily', spec(t)));
  });

  it('classifies a weekday daily run as [daily] only', () => {
    // 2026-07-07 is a Tuesday.
    const t = new Date('2026-07-07T02:15:00Z');
    expect(isWeekly(t)).toBe(false);
    expect(classesFor('daily', t)).toEqual(['daily']);
  });

  it('classifies a Sunday daily run as [daily, weekly]', () => {
    // 2026-07-05 is a Sunday (UTC).
    const t = new Date('2026-07-05T02:15:00Z');
    expect(t.getUTCDay()).toBe(0);
    expect(isWeekly(t)).toBe(true);
    expect(classesFor('daily', t)).toEqual(['daily', 'weekly']);
  });

  it('classifies a manual run as [manual] regardless of weekday', () => {
    expect(classesFor('manual', new Date('2026-07-05T02:15:00Z'))).toEqual(['manual']);
    const k = objectKey('manual', spec(new Date('2026-07-05T09:00:00Z'), 'manual'));
    expect(k.startsWith('manual/2026/07/05/')).toBe(true);
  });

  it('status marker key is fixed', () => {
    expect(STATUS_LATEST_SUCCESS_KEY).toBe('status/latest-success.json');
  });
});
