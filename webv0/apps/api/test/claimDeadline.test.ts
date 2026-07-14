import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { submitGuestIntake, type Persistence } from '@c3web/application';

describe('HARDEN-3.6 T4 — deadline gates claim dispatch', () => {
  it('a fired deadline refuses before claimAndInsert is dispatched', async () => {
    const claimAndInsert = vi.fn();
    const reason = new Error('REQUEST_DEADLINE_EXCEEDED');
    const controller = new AbortController();
    controller.abort(reason);
    const persistence = { guest: { claimAndInsert } } as unknown as Persistence;

    await expect(submitGuestIntake(persistence, {
      tokenHash: 'token', submissionId: randomUUID(), kind: 'Onboarding',
      payload: { fullName: 'Deadline Test', email: 'deadline@example.test' },
      uploads: [], submitterFingerprint: null, signal: controller.signal,
    })).rejects.toBe(reason);
    expect(claimAndInsert).not.toHaveBeenCalled();
  });
});
