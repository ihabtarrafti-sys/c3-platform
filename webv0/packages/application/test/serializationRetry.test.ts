/**
 * serializationRetry.test — the bounded retry for transient serialization/deadlock
 * failures (R4-N05). A rolled-back 40001/40P01 is retried on a fresh attempt; anything
 * else propagates immediately; a persistent transient error gives up after the bound.
 */
import { describe, expect, it, vi } from 'vitest';
import { isRetryableSerializationError, withSerializationRetry } from '../src/usecases/serializationRetry';

const pgErr = (code: string) => Object.assign(new Error(`pg ${code}`), { code });

describe('withSerializationRetry', () => {
  it('returns the first result when the thunk succeeds (no retry)', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withSerializationRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries a 40001 serialization failure and converges on the next attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(pgErr('40001'))
      .mockResolvedValueOnce('converged');
    await expect(withSerializationRetry(fn, 3)).resolves.toBe('converged');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries a 40P01 deadlock too', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(pgErr('40P01'))
      .mockResolvedValueOnce('ok');
    await expect(withSerializationRetry(fn, 3)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the bound when the transient failure persists, surfacing the error', async () => {
    const fn = vi.fn().mockRejectedValue(pgErr('40001'));
    await expect(withSerializationRetry(fn, 3)).rejects.toMatchObject({ code: '40001' });
    expect(fn).toHaveBeenCalledTimes(3); // bounded — not infinite
  });

  it('does NOT retry a non-transient error (e.g. a conflict) — it propagates immediately', async () => {
    const fn = vi.fn().mockRejectedValue(pgErr('23514')); // check_violation (a real conflict)
    await expect(withSerializationRetry(fn, 3)).rejects.toMatchObject({ code: '23514' });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('classifies retryable SQLSTATEs', () => {
    expect(isRetryableSerializationError(pgErr('40001'))).toBe(true);
    expect(isRetryableSerializationError(pgErr('40P01'))).toBe(true);
    expect(isRetryableSerializationError(pgErr('23514'))).toBe(false);
    expect(isRetryableSerializationError(new Error('no code'))).toBe(false);
    expect(isRetryableSerializationError(null)).toBe(false);
  });
});
