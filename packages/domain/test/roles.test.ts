import { describe, it, expect } from 'vitest';
import { C3_ROLES, capabilitiesFor, isC3Role } from '../src/roles';

describe('role capability matrix (Sprint 34 Phase 1 authorization spec)', () => {
  it('every role is a total, fully-specified capability set', () => {
    for (const role of C3_ROLES) {
      const c = capabilitiesFor(role);
      expect(typeof c.canReadPeople).toBe('boolean');
      expect(typeof c.canSubmitApproval).toBe('boolean');
      expect(typeof c.canReviewApproval).toBe('boolean');
      expect(typeof c.canExecuteApproval).toBe('boolean');
      expect(typeof c.isReadOnly).toBe('boolean');
    }
  });

  it('all authenticated roles may read People', () => {
    for (const role of C3_ROLES) expect(capabilitiesFor(role).canReadPeople).toBe(true);
  });

  it('Operations may submit but may NOT review or execute', () => {
    const ops = capabilitiesFor('operations');
    expect(ops.canSubmitApproval).toBe(true);
    expect(ops.canReviewApproval).toBe(false);
    expect(ops.canExecuteApproval).toBe(false);
  });

  it('Owner may review and execute', () => {
    const owner = capabilitiesFor('owner');
    expect(owner.canReviewApproval).toBe(true);
    expect(owner.canExecuteApproval).toBe(true);
    expect(owner.canSubmitApproval).toBe(true);
    expect(owner.isReadOnly).toBe(false);
  });

  it('read-only roles may neither submit nor review', () => {
    for (const role of ['legal', 'finance', 'hr', 'management', 'visitor'] as const) {
      const c = capabilitiesFor(role);
      expect(c.isReadOnly).toBe(true);
      expect(c.canSubmitApproval).toBe(false);
      expect(c.canReviewApproval).toBe(false);
      expect(c.canExecuteApproval).toBe(false);
    }
  });

  it('isC3Role rejects unknown strings', () => {
    expect(isC3Role('owner')).toBe(true);
    expect(isC3Role('root')).toBe(false);
    expect(isC3Role(42)).toBe(false);
  });
});
