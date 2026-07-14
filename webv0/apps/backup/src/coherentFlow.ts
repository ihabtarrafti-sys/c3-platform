/**
 * coherentFlow.ts — the COHERENCE orchestration of the dump+census, isolated from the real
 * pg / pg_dump effects so it is unit-testable (R3-N06 residual: the real adapter was stubbed,
 * so nothing exercised the ordering/snapshot logic). Two things are load-bearing and are now
 * provable by a test:
 *   1. the snapshot id from `pg_export_snapshot()` MUST thread into pg_dump (`--snapshot=<id>`);
 *   2. the tx MUST stay open until pg_dump finishes (commit AFTER runDump) — closing it earlier
 *      invalidates the exported snapshot and makes the dump incoherent with the census.
 * R4-N09 lives here too: pg_dump runs with `--lock-wait-timeout` and a bounded retry so an
 * exporter↔DDL lock-queue cycle FAILS FAST + retries, never hangs indefinitely.
 */
import type { BlobArchiveEntry } from './manifest';

export interface CoherentIo {
  /** BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY. */
  begin(): Promise<void>;
  /** pg_export_snapshot() → the snapshot id. */
  exportSnapshot(): Promise<string>;
  /** Enumerate the blob census IN this transaction (same MVCC snapshot as the dump). */
  enumerate(): Promise<BlobArchiveEntry[]>;
  /** Run pg_dump ON the exported snapshot — the id MUST be threaded through as --snapshot. */
  runDump(snapshotId: string): Promise<void>;
  /** COMMIT — only AFTER runDump finishes (an earlier close invalidates the snapshot). */
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /** The produced dump's size in bytes. */
  dumpBytes(): Promise<number>;
  /**
   * R4-N09 ceremony hook: an OPTIONAL pause between the census and the dump — the only window
   * where the hosted lock-queue drill can deterministically queue its ACCESS EXCLUSIVE DDL
   * behind the exporter. Absent (production default) ⇒ the flow is byte-identical to before.
   * Supplied only by `resolveCensusPause` when BACKUP_PAUSE_AFTER_CENSUS is explicitly set.
   */
  pauseBeforeDump?: () => Promise<void>;
}

export async function coherentDumpAndCensusFlow(io: CoherentIo): Promise<{ bytes: number; blobs: BlobArchiveEntry[] }> {
  await io.begin();
  try {
    const snapshotId = await io.exportSnapshot();
    const blobs = await io.enumerate();
    if (io.pauseBeforeDump) await io.pauseBeforeDump(); // R4-N09 ceremony window (inert when absent)
    await io.runDump(snapshotId); // pg_dump ON that exact snapshot
    await io.commit(); // ONLY after the dump has fully finished
    const bytes = await io.dumpBytes();
    return { bytes, blobs };
  } catch (err) {
    await io.rollback().catch(() => {});
    throw err;
  }
}

/**
 * R4-N09: resolve the ceremony pause from the environment. INERT BY DEFAULT — unset/empty ⇒
 * null (no pause step exists at all). An explicit integer 1..600 (seconds) ⇒ a pause fn that
 * logs loudly (the drill operator watches for this line, queues the DDL, then observes it
 * waiting). Anything else ⇒ REFUSE the backup: a mistyped ceremony knob must fail loudly, never
 * produce a silently-paused-or-not backup (the nightly retention margin absorbs one refused run).
 */
export function resolveCensusPause(
  env: NodeJS.ProcessEnv,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  log: (msg: string) => void = (msg) => console.warn(msg),
): (() => Promise<void>) | null {
  const raw = env.BACKUP_PAUSE_AFTER_CENSUS;
  if (raw === undefined || raw.trim() === '') return null;
  const secs = Number(raw.trim());
  if (!Number.isInteger(secs) || secs < 1 || secs > 600) {
    throw new Error(
      `BACKUP_PAUSE_AFTER_CENSUS must be an integer 1..600 seconds (got '${raw}') — refusing a backup with an ambiguous ceremony pause.`,
    );
  }
  return async () => {
    log(JSON.stringify({ event: 'backup.census_pause', seconds: secs, note: 'R4-N09 drill window OPEN — queue the DDL now' }));
    await sleep(secs * 1000);
    log(JSON.stringify({ event: 'backup.census_pause_end', seconds: secs }));
  };
}

/** pg_dump's default lock-wait-timeout (ms): fail fast rather than queue behind a waiter. */
export const PG_DUMP_LOCK_WAIT_MS = 60_000;

/**
 * Build pg_dump's argv. The `--snapshot=<id>` binds the dump to the census's MVCC snapshot;
 * `--lock-wait-timeout` bounds how long pg_dump waits for a table lock (R4-N09). Kept a pure
 * function so a test can assert both are present — dropping either is caught immediately.
 */
export function pgDumpArgs(dumpPath: string, databaseUrl: string, snapshotId: string, lockWaitMs: number = PG_DUMP_LOCK_WAIT_MS): string[] {
  return [
    '-Fc',
    '-Z',
    '6',
    '--no-owner',
    '--no-privileges',
    `--lock-wait-timeout=${lockWaitMs}`,
    `--snapshot=${snapshotId}`,
    '-f',
    dumpPath,
    databaseUrl,
  ];
}

/** Recognise pg_dump's lock-wait-timeout failure (the transient case worth a bounded retry). */
export function isPgLockTimeout(err: unknown): boolean {
  const msg = String((err as { message?: unknown } | null)?.message ?? err ?? '');
  return /lock[_ -]?wait[_ -]?timeout|canceling statement due to lock timeout|could not obtain lock/i.test(msg);
}

export interface LockRetryOptions {
  attempts?: number;
  isLockTimeout?: (err: unknown) => boolean;
  onRetry?: (attempt: number, err: unknown) => void;
}

/**
 * R4-N09: run pg_dump with a BOUNDED retry on a lock-wait-timeout. pg_dump takes ACCESS SHARE
 * on every table; a queued ACCESS EXCLUSIVE (a DDL/migration) makes pg_dump's lock request wait
 * behind it, while the exporter (holding the snapshot tx open in JS) waits on pg_dump — a cycle
 * Postgres can't see. With --lock-wait-timeout pg_dump fails fast; this retries that transient
 * failure up to `attempts`, then surfaces it (alerting) — never an indefinite hang.
 */
export async function runWithLockWaitRetry(runOnce: () => Promise<void>, opts: LockRetryOptions = {}): Promise<void> {
  const attempts = opts.attempts ?? 3;
  const isLockTimeout = opts.isLockTimeout ?? isPgLockTimeout;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await runOnce();
      return;
    } catch (err) {
      if (isLockTimeout(err) && attempt < attempts) {
        opts.onRetry?.(attempt, err);
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}
