import { describe, it, expect } from 'vitest';
import {
  canApply,
  nextStatus,
  allowedActionsFrom,
  isPending,
  isActionable,
  isTerminal,
  APPROVAL_STATUSES,
} from '../src/lifecycle';

describe('approval lifecycle transitions', () => {
  it('Submitted → InReview via beginReview only', () => {
    expect(nextStatus('beginReview', 'Submitted')).toBe('InReview');
    expect(canApply('approve', 'Submitted')).toBe(false);
  });

  it('InReview → Approved via approve; InReview → Rejected via reject', () => {
    expect(nextStatus('approve', 'InReview')).toBe('Approved');
    expect(nextStatus('reject', 'InReview')).toBe('Rejected');
  });

  it('reject is allowed from Submitted or InReview', () => {
    expect(canApply('reject', 'Submitted')).toBe(true);
    expect(canApply('reject', 'InReview')).toBe(true);
    expect(canApply('reject', 'Approved')).toBe(false);
  });

  it('execution success/failure only from Approved or ExecutionFailed (retry)', () => {
    expect(nextStatus('executeSuccess', 'Approved')).toBe('Executed');
    expect(nextStatus('executeFailure', 'Approved')).toBe('ExecutionFailed');
    expect(nextStatus('executeSuccess', 'ExecutionFailed')).toBe('Executed');
    expect(canApply('executeSuccess', 'Submitted')).toBe(false);
    expect(canApply('executeSuccess', 'Executed')).toBe(false);
  });

  it('terminal states allow no further transitions', () => {
    expect(allowedActionsFrom('Executed')).toEqual([]);
    expect(allowedActionsFrom('Rejected')).toEqual([]);
  });

  it('band predicates classify every status', () => {
    for (const s of APPROVAL_STATUSES) {
      expect(typeof isPending(s)).toBe('boolean');
      expect(typeof isActionable(s)).toBe('boolean');
      expect(typeof isTerminal(s)).toBe('boolean');
    }
    expect(isPending('Approved')).toBe(true);
    expect(isActionable('ExecutionFailed')).toBe(true);
    expect(isPending('ExecutionFailed')).toBe(false);
    expect(isTerminal('Executed')).toBe(true);
  });
});
