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

/**
 * R5-N06: Drizzle WRAPS the driver error, so the SQLSTATE lives on `err.cause.code` (often
 * nested), NOT `err.code` — a top-level-only check silently surfaced every composed 40001
 * instead of retrying (the exact miss savedViewOps.ts:26-32 already worked around for 23505).
 * Walk the cause chain to a bounded depth.
 */
export function isRetryableSerializationError(err: unknown): boolean {
  for (let node: unknown = err, depth = 0; node != null && depth < 8; depth++) {
    const code = (node as { code?: unknown }).code;
    if (typeof code === 'string' && RETRYABLE_SQLSTATES.has(code)) return true;
    node = (node as { cause?: unknown }).cause;
  }
  return false;
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
