import { describe, expect, it } from 'vitest';
import { errorCausedBy } from '../src/app';

describe('HARDEN-3.6 T6 — causal deadline mapping', () => {
  it('recognizes the deadline reason through an error cause chain', () => {
    const reason = new Error('deadline');
    expect(errorCausedBy(reason, reason)).toBe(true);
    expect(errorCausedBy(new Error('wrapped', { cause: reason }), reason)).toBe(true);
  });

  it('does not relabel an unrelated post-deadline error', () => {
    const reason = new Error('deadline');
    const validation = Object.assign(new Error('validation'), { statusCode: 422, code: 'VALIDATION' });
    expect(errorCausedBy(validation, reason)).toBe(false);
  });
});
