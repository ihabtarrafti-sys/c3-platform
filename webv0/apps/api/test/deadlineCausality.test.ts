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

describe('HARDEN-3.7 U7 — cause traversal is cycle-safe and depth-bounded', () => {
  const wrappedAtDepth = (reason: Error, depth: number): Error => {
    let current = reason;
    for (let i = 0; i < depth; i += 1) current = new Error(`wrapper-${i}`, { cause: current });
    return current;
  };

  it('still recognizes a reason exactly 32 cause edges deep', () => {
    const reason = new Error('deadline');
    expect(errorCausedBy(wrappedAtDepth(reason, 32), reason)).toBe(true);
  });

  it('never follows a 33rd cause edge', () => {
    const reason = new Error('deadline');
    // RED: the old unbounded traversal returns true for this chain.
    expect(errorCausedBy(wrappedAtDepth(reason, 33), reason)).toBe(false);
  });

  it('terminates on a cycle without finding an unrelated reason', () => {
    const cyclic = new Error('cycle') as Error & { cause?: unknown };
    cyclic.cause = cyclic;
    expect(errorCausedBy(cyclic, new Error('other'))).toBe(false);
  });
});
