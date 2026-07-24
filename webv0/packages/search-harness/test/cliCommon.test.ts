import { describe, expect, it } from 'vitest';

import { SeederGuardError } from '../src/seederGuard.js';
import { safeHarnessCommandError } from '../src/cli/common.js';

describe('safe harness command failure serialization', () => {
  it('suppresses unknown runtime messages and invalid error codes', () => {
    const sentinel = 'HEARTH-PII-9f2c@example.invalid';
    const safe = safeHarnessCommandError(
      Object.assign(new Error(`database failed for q=${sentinel}`), {
        code: `LEAK_${sentinel}`,
      }),
    );
    expect(JSON.stringify(safe)).not.toContain(sentinel);
    expect(safe).toEqual({
      name: 'Error',
      code: 'HARNESS_COMMAND_FAILED',
      message:
        'Harness command failed; sensitive runtime error text was suppressed',
    });
  });

  it('retains the bounded code and reviewed message of a harness error', () => {
    expect(
      safeHarnessCommandError(
        new SeederGuardError(
          'SEED_ACK_REQUIRED',
          'Explicit destructive-seed acknowledgement is required',
        ),
      ),
    ).toEqual({
      name: 'SeederGuardError',
      code: 'SEED_ACK_REQUIRED',
      message: 'Explicit destructive-seed acknowledgement is required',
    });
  });

  it('retains a bounded stage code but still suppresses a plain Error message', () => {
    const safe = safeHarnessCommandError(
      Object.assign(new Error('unsafe operational detail'), {
        code: 'HARNESS_STAGE_H2_REQUIRED',
      }),
    );
    expect(safe.code).toBe('HARNESS_STAGE_H2_REQUIRED');
    expect(safe.message).not.toContain('unsafe operational detail');
  });
});
