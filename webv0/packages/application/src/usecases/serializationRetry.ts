/**
 * serializationRetry — a bounded retry for transactions that fail with a TRANSIENT
 * serialization/deadlock error. Postgres reports these as SQLSTATE 40001 (could not
 * serialize access) and 40P01 (deadlock detected); in both cases the transaction has
 * FULLY rolled back, so re-running the whole thunk (which re-reads a fresh snapshot) is
 * safe and converges. A non-transient error propagates immediately.
 *
 * Used by the distribution revoke/pay writes (R4-N05): 0066 makes those two paths
 * write-conflict on the head, so a REPEATABLE READ caller can see a 40001 — and any
 * caller can hit a 40P01. This turns that into a converged success rather than a 500.
 */
const RETRYABLE_SQLSTATES = new Set(['40001', '40P01']);

export function isRetryableSerializationError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && RETRYABLE_SQLSTATES.has(code);
}

export async function withSerializationRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRetryableSerializationError(err) && attempt < attempts - 1) {
        lastErr = err;
        continue; // the tx rolled back — retry on a fresh snapshot
      }
      throw err;
    }
  }
  // Unreachable in practice (the final retryable attempt throws above), but keeps the
  // type checker satisfied and preserves the last error if attempts <= 0.
  throw lastErr;
}
