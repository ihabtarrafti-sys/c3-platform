import { describe, expect, it } from 'vitest';
import { COMMENT_SUBJECT_TYPES, postCommentInputSchema, subjectRoute } from '../src/index';

describe('Track B4 — comment domain shapes', () => {
  it('validates a comment: known subject, non-empty body, bounded mentions', () => {
    expect(postCommentInputSchema.safeParse({ subjectType: 'Person', subjectId: 'PER-0001', body: 'hi' }).success).toBe(true);
    expect(postCommentInputSchema.safeParse({ subjectType: 'Agreement', subjectId: 'AGR-0001', body: 'x', mentions: ['a@b.com'] }).success).toBe(true);
    expect(postCommentInputSchema.safeParse({ subjectType: 'Nope', subjectId: 'X', body: 'x' }).success).toBe(false);
    expect(postCommentInputSchema.safeParse({ subjectType: 'Person', subjectId: 'PER-0001', body: '   ' }).success).toBe(false);
    // mentions default to []
    expect(postCommentInputSchema.parse({ subjectType: 'Mission', subjectId: 'MSN-0001', body: 'go' }).mentions).toEqual([]);
  });

  it('every subject type routes to a real detail page', () => {
    for (const t of COMMENT_SUBJECT_TYPES) {
      expect(subjectRoute(t, 'X-0001')).toMatch(/^\/(people|missions|agreements|approvals)\/X-0001$/);
    }
    expect(subjectRoute('Approval', 'APR-0007')).toBe('/approvals/APR-0007');
  });
});
