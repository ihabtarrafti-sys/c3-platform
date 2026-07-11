import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, decodeActivityCursor, encodeActivityCursor, humanizeActivityAction } from '../src/index';

describe('Track B3 — activity projection', () => {
  it('humanizes PascalCase actions into sentence case, for every known action', () => {
    expect(humanizeActivityAction('PersonDeactivated')).toBe('Person deactivated');
    expect(humanizeActivityAction('ApprovalExecutionFailed')).toBe('Approval execution failed');
    expect(humanizeActivityAction('FxRateSet')).toBe('Fx rate set');
    expect(humanizeActivityAction('PerDiemPresetsSet')).toBe('Per diem presets set');
    // it never throws and never returns empty for any action in the enum
    for (const a of AUDIT_ACTIONS) expect(humanizeActivityAction(a).length).toBeGreaterThan(0);
  });

  it('the keyset cursor round-trips and rejects malformed input', () => {
    const c = { at: '2026-07-11T10:00:00.000Z', id: 'abc-123' };
    expect(decodeActivityCursor(encodeActivityCursor(c))).toEqual(c);
    expect(decodeActivityCursor('nopipe')).toBeNull();
    expect(decodeActivityCursor('|noAt')).toBeNull();
    expect(decodeActivityCursor('noId|')).toBeNull();
  });
});
