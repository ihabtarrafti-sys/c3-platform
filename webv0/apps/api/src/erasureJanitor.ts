/**
 * HARDEN-3.7 J′ — permanent post-finalize erasure janitor.
 *
 * `erased_tenant_prefix` is intentionally platform-level and permanent. The
 * API's least-privileged role may read its opaque DEAD-tenant prefixes and
 * update telemetry, but cannot create, retarget, retire, or delete authority.
 * A row lock makes one instance own each pass; storage list/delete is
 * idempotent, so multiple API instances are safe.
 */
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import type { DocumentStorage } from './storage';

export const DEFAULT_ERASURE_JANITOR_INTERVAL_MS = 24 * 60 * 60 * 1_000;
export const MAX_ERASURE_JANITOR_INTERVAL_MS = DEFAULT_ERASURE_JANITOR_INTERVAL_MS;
export const DEFAULT_ERASURE_JANITOR_PROGRESS_TIMEOUT_MS = 120_000;
export const DEFAULT_ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS = 30_000;
export const MAX_ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS = 300_000;
// R10-N01 condition 4: a screaming-provider pathology (an unbounded, growing
// pending-destroy backlog for one dead tenant) should be LOUD, not a silently
// growing jsonb. No behaviour change — just a structured warning past this bound.
export const ERASURE_PENDING_DESTROY_LOUD_THRESHOLD = 1_000;

export type ErasureJanitorTrigger = 'boot' | 'interval' | 'owner';

export interface ErasureJanitorResult {
  readonly recordsSeen: number;
  readonly recordsSwept: number;
  readonly recordsSkipped: number;
  readonly stragglersDestroyed: number;
  readonly failures: number;
  /** True means an owner must rerun: a row skipped/failed, or no fresh owner pass was performed. */
  readonly incomplete: boolean;
}

export interface ErasureJanitorService {
  readonly intervalMs: number;
  run(trigger: ErasureJanitorTrigger): Promise<ErasureJanitorResult>;
}

interface ErasedPrefixRow {
  tenant_ref: string;
  doc_prefix: string;
  intake_prefix: string;
  pending_destroy: string[];
}

interface ErasureJanitorPassOptions {
  readonly progressTimeoutMs?: number;
}

function validatePositiveTimeout(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer`);
  }
}

/**
 * An idle-progress deadline, armed only while a row lock is held. Storage
 * implementations receive its AbortSignal, while Promise.race also releases
 * the database lock when a buggy/non-cooperative driver ignores cancellation.
 */
function createProgressDeadline(timeoutMs: number): {
  readonly signal: AbortSignal;
  readonly onProgress: () => void;
  waitFor<T>(operation: Promise<T>): Promise<T>;
  close(): void;
} {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let closed = false;
  let rejectDeadline!: (reason: Error) => void;
  const deadline = new Promise<never>((_resolve, reject) => { rejectDeadline = reject; });

  const arm = () => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (closed) return;
      closed = true;
      const error = new Error(`post-finalize erasure janitor storage progress deadline exceeded after ${timeoutMs}ms`);
      controller.abort(error);
      rejectDeadline(error);
    }, timeoutMs);
    timer.unref();
  };
  arm();

  return {
    signal: controller.signal,
    onProgress: arm,
    waitFor<T>(operation: Promise<T>) {
      return Promise.race([operation, deadline]);
    },
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}

async function recordFailedPass(client: PoolClient, tenantRef: string, trigger: ErasureJanitorTrigger): Promise<void> {
  // Keep durable telemetry bounded and non-sensitive. The raw provider/driver
  // error belongs in the operational log below, never in the permanent row.
  const result = JSON.stringify({ status: 'failed', trigger });
  await client.query(
    `UPDATE erased_tenant_prefix SET last_result = $2 WHERE tenant_ref = $1`,
    [tenantRef, result],
  );
}

/** One complete database/storage pass. Exported so the real-driver test can
 * exercise the exact production primitive used by boot, interval, and owner. */
export async function runErasureJanitorPass(
  pool: Pool,
  storage: DocumentStorage,
  logger: Logger,
  trigger: ErasureJanitorTrigger,
  options: ErasureJanitorPassOptions = {},
): Promise<ErasureJanitorResult> {
  const progressTimeoutMs = options.progressTimeoutMs ?? DEFAULT_ERASURE_JANITOR_PROGRESS_TIMEOUT_MS;
  validatePositiveTimeout(progressTimeoutMs, 'erasure janitor progress timeout');
  const candidates = await pool.query<{ tenant_ref: string }>(
    `SELECT tenant_ref FROM erased_tenant_prefix ORDER BY finalized_at, tenant_ref`,
  );
  let recordsSwept = 0;
  let recordsSkipped = 0;
  let stragglersDestroyed = 0;
  let failures = 0;

  for (const candidate of candidates.rows) {
    let client: PoolClient | undefined;
    let inTransaction = false;
    let lockedRow: ErasedPrefixRow | undefined;
    let progressDeadline: ReturnType<typeof createProgressDeadline> | undefined;
    const caught = new Set<string>();
    const destroyed = new Set<string>();
    try {
      // Checkout belongs to this candidate's accounting boundary. A transient
      // pool failure must not abort the entire pass without a failure result.
      client = await pool.connect();
      await client.query('BEGIN');
      inTransaction = true;
      const locked = await client.query<ErasedPrefixRow>(
        `SELECT tenant_ref, doc_prefix, intake_prefix, pending_destroy
           FROM erased_tenant_prefix
          WHERE tenant_ref = $1
          FOR UPDATE SKIP LOCKED`,
        [candidate.tenant_ref],
      );
      lockedRow = locked.rows[0];
      if (!lockedRow) {
        recordsSkipped += 1;
        await client.query('COMMIT');
        inTransaction = false;
        continue;
      }
      progressDeadline = createProgressDeadline(progressTimeoutMs);

      const prefixes = [lockedRow.doc_prefix, lockedRow.intake_prefix];
      // R10-N01: the OUTBOX. `pending` holds keys whose catch is already durable but whose byte
      // is not yet confirmed destroyed — seeded from pending_destroy so a key caught by a prior
      // pass that died before its confirming commit is re-destroyed and NEVER re-counted.
      const pending = new Set<string>(Array.isArray(lockedRow.pending_destroy) ? lockedRow.pending_destroy : []);

      // ── PHASE 1 — COMMIT every catch BEFORE any byte is destroyed. ─────────────────────────
      // A publication may become visible between lists; keep converging until a full two-prefix
      // list adds nothing NEW to pending. A key already in `pending` is excluded from newlyCaught,
      // so a re-discovered key produces no second count and no second audit event.
      for (;;) {
        const present = new Set<string>();
        for (const prefix of prefixes) {
          const keys = await progressDeadline.waitFor(storage.listKeys(prefix, {
            signal: progressDeadline.signal,
            onProgress: progressDeadline.onProgress,
          }));
          progressDeadline.onProgress();
          for (const key of keys) {
            if (!key.startsWith(prefix)) {
              throw new Error(`storage driver returned key outside erased prefix '${prefix}'`);
            }
            present.add(key);
          }
        }
        const newlyCaught = [...present].filter((key) => !pending.has(key));
        if (newlyCaught.length === 0) break;
        for (const key of newlyCaught) { pending.add(key); caught.add(key); }
        // R10-N02: the gateway owns count + event as one least-privileged transition; only the
        // COUNT and trigger cross it. R10-N01 condition 2: the caught KEYS go to pending_destroy,
        // NEVER to audit_event (the 0080 event shape stays key-free and tenant-independent).
        const telemetry = await client.query(
          `SELECT append_post_finalize_erasure_straggler_audit($1, $2::bigint, $3::text) AS audit_id`,
          [lockedRow.tenant_ref, newlyCaught.length, trigger],
        );
        if (telemetry.rowCount !== 1) {
          throw new Error('post-finalize erasure telemetry authority disappeared while locked');
        }
        await client.query(
          `UPDATE erased_tenant_prefix SET pending_destroy = pending_destroy || $2::jsonb WHERE tenant_ref = $1`,
          [lockedRow.tenant_ref, JSON.stringify(newlyCaught)],
        );
        logger.warn(
          { event: 'post_finalize_erasure_straggler_caught', tenantRef: lockedRow.tenant_ref, trigger, stragglersCaught: newlyCaught.length },
          'post-finalize erasure janitor caught storage straggler(s)',
        );
        if (pending.size > ERASURE_PENDING_DESTROY_LOUD_THRESHOLD) {
          logger.warn(
            { event: 'post_finalize_erasure_pending_destroy_high', tenantRef: lockedRow.tenant_ref, pendingDestroy: pending.size },
            'post-finalize erasure pending-destroy backlog exceeds the sanity threshold',
          );
        }
      }
      await client.query(`UPDATE erased_tenant_prefix SET last_swept_at = now() WHERE tenant_ref = $1`, [lockedRow.tenant_ref]);
      await client.query('COMMIT'); // ← THE CATCH IS NOW DURABLE; the bytes still exist.
      inTransaction = false;

      // ── PHASE 2 — destroy + confirm, per key, idempotent. ─────────────────────────────────
      // A key leaves pending_destroy ONLY after ITS delete returns success-or-absent (S3 delete
      // is idempotent). A partial failure leaves the remaining keys pending and the pass
      // incomplete — never a batch-confirm on partial success.
      let unconfirmed = pending.size;
      {
        await client.query('BEGIN');
        inTransaction = true;
        const confirmed: string[] = [];
        let destroyError: unknown;
        for (const key of pending) {
          try {
            await progressDeadline.waitFor(storage.delete(key, { signal: progressDeadline.signal }));
          } catch (e) {
            destroyError = e;
            break; // leave this key and the rest pending for the next pass
          }
          progressDeadline.onProgress();
          destroyed.add(key);
          confirmed.push(key);
        }
        await client.query(
          `UPDATE erased_tenant_prefix
              SET pending_destroy = coalesce(
                    (SELECT jsonb_agg(k) FROM jsonb_array_elements_text(pending_destroy) AS k WHERE NOT (k = ANY($2::text[]))),
                    '[]'::jsonb),
                  last_result = $3
            WHERE tenant_ref = $1`,
          [
            lockedRow.tenant_ref,
            confirmed,
            JSON.stringify({ status: destroyed.size > 0 ? 'stragglers_destroyed' : 'clean', trigger, stragglersCaught: caught.size }),
          ],
        );
        await client.query('COMMIT');
        inTransaction = false;
        unconfirmed = pending.size - confirmed.length;
        if (destroyError) {
          logger.error(
            { err: destroyError, event: 'post_finalize_erasure_janitor_destroy_failure', tenantRef: lockedRow.tenant_ref, trigger, unconfirmed },
            'post-finalize erasure janitor delete failed; caught keys remain pending (audit already durable)',
          );
        }
      }
      stragglersDestroyed += destroyed.size;
      if (unconfirmed > 0) {
        // pending_destroy non-empty at pass end ⇒ this candidate is incomplete (owner must rerun).
        failures += 1;
        logger.warn(
          { event: 'post_finalize_erasure_pending_destroy_unconfirmed', tenantRef: lockedRow.tenant_ref, trigger, unconfirmed },
          'post-finalize erasure janitor left straggler(s) pending destroy for the next pass',
        );
      } else {
        recordsSwept += 1;
      }
      if (destroyed.size > 0) {
        logger.info(
          { event: 'post_finalize_erasure_straggler_destroyed', tenantRef: lockedRow.tenant_ref, trigger, stragglersDestroyed: destroyed.size },
          'post-finalize erasure janitor destroyed storage straggler(s)',
        );
      }
    } catch (err) {
      failures += 1;
      stragglersDestroyed += destroyed.size;
      if (client && inTransaction && lockedRow) {
        try {
          await recordFailedPass(client, lockedRow.tenant_ref, trigger);
          await client.query('COMMIT');
          inTransaction = false;
        } catch {
          // A database failure can leave the transaction aborted. The permanent
          // row still exists; rollback and let the next pass retry it.
        }
      }
      if (client && inTransaction) await client.query('ROLLBACK').catch(() => {});
      logger.error(
        { err, event: 'post_finalize_erasure_janitor_failure', tenantRef: candidate.tenant_ref, trigger },
        'post-finalize erasure janitor record failed; permanent authority retained for retry',
      );
    } finally {
      progressDeadline?.close();
      client?.release();
    }
  }

  const result: ErasureJanitorResult = {
    recordsSeen: candidates.rows.length,
    recordsSwept,
    recordsSkipped,
    stragglersDestroyed,
    failures,
    incomplete: recordsSkipped > 0 || failures > 0,
  };
  logger.info({ event: 'post_finalize_erasure_janitor_pass', trigger, ...result }, 'post-finalize erasure janitor pass complete');
  return result;
}

export function createErasureJanitorService(options: {
  readonly pool: Pool;
  readonly storage: DocumentStorage;
  readonly logger: Logger;
  readonly intervalMs?: number;
  readonly progressTimeoutMs?: number;
}): ErasureJanitorService {
  const intervalMs = options.intervalMs ?? DEFAULT_ERASURE_JANITOR_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0 || intervalMs > MAX_ERASURE_JANITOR_INTERVAL_MS) {
    throw new Error(`erasure janitor interval must be a positive safe integer no greater than ${MAX_ERASURE_JANITOR_INTERVAL_MS}ms`);
  }
  const progressTimeoutMs = options.progressTimeoutMs ?? DEFAULT_ERASURE_JANITOR_PROGRESS_TIMEOUT_MS;
  validatePositiveTimeout(progressTimeoutMs, 'erasure janitor progress timeout');
  let active: Promise<ErasureJanitorResult> | undefined;
  let activeTrigger: ErasureJanitorTrigger | undefined;
  let queuedOwner: Promise<ErasureJanitorResult> | undefined;

  const launch = (trigger: ErasureJanitorTrigger): Promise<ErasureJanitorResult> => {
    const pass = runErasureJanitorPass(options.pool, options.storage, options.logger, trigger, { progressTimeoutMs });
    active = pass;
    activeTrigger = trigger;
    void pass.then(
      () => { if (active === pass) { active = undefined; activeTrigger = undefined; } },
      () => { if (active === pass) { active = undefined; activeTrigger = undefined; } },
    );
    return pass;
  };

  return {
    intervalMs,
    run(trigger) {
      if (!active) return launch(trigger);
      // Interval ticks may coalesce with an already-complete census. An owner
      // invocation may not: queue one fresh pass so an object published after
      // the active pass visited its row is still covered by that invocation.
      if (trigger !== 'owner') return active;
      // An owner invocation that begins after an owner pass has already begun
      // cannot claim that pass as a fresh observation. Return an explicit
      // rerun-required result instead of silently coalescing.
      if (activeTrigger === 'owner') {
        return Promise.resolve({
          recordsSeen: 0,
          recordsSwept: 0,
          recordsSkipped: 0,
          stragglersDestroyed: 0,
          failures: 0,
          incomplete: true,
        });
      }
      if (queuedOwner) return queuedOwner;
      const waitForActive = active.catch(() => undefined);
      const queued = waitForActive.then(() => launch('owner'));
      queuedOwner = queued;
      void queued.then(
        () => { if (queuedOwner === queued) queuedOwner = undefined; },
        () => { if (queuedOwner === queued) queuedOwner = undefined; },
      );
      return queued;
    },
  };
}

export interface ErasureJanitorScheduler {
  start(): Promise<void>;
  close(): Promise<void>;
}

/**
 * API-process scheduler. The safety pass always starts before listen, but API
 * readiness waits at most the configured budget; after that it is observed and
 * continues in the background. The daily-or-faster interval remains armed.
 */
export function createErasureJanitorScheduler(
  service: ErasureJanitorService,
  logger: Logger,
  options: { readonly bootReadinessBudgetMs?: number } = {},
): ErasureJanitorScheduler {
  const bootReadinessBudgetMs = options.bootReadinessBudgetMs
    ?? DEFAULT_ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS;
  validatePositiveTimeout(bootReadinessBudgetMs, 'erasure janitor boot readiness budget');
  if (bootReadinessBudgetMs > MAX_ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS) {
    throw new Error(
      `erasure janitor boot readiness budget must not exceed ${MAX_ERASURE_JANITOR_BOOT_READINESS_BUDGET_MS}ms`,
    );
  }
  let started = false;
  let timer: NodeJS.Timeout | undefined;
  let bootRun: Promise<ErasureJanitorResult> | undefined;
  let intervalRun: Promise<ErasureJanitorResult> | undefined;

  const armInterval = () => {
    timer = setInterval(() => {
      intervalRun = service.run('interval');
      void intervalRun.catch((err) => {
        logger.error({ err, event: 'post_finalize_erasure_janitor_interval_failure' }, 'erasure janitor interval pass failed');
      }).finally(() => {
        intervalRun = undefined;
      });
    }, service.intervalMs);
    timer.unref();
  };

  return {
    async start() {
      if (started) return;
      started = true;
      try {
        bootRun = service.run('boot');
        let readinessTimer: NodeJS.Timeout | undefined;
        const budgetExpired = new Promise<'budget'>((resolve) => {
          readinessTimer = setTimeout(() => resolve('budget'), bootReadinessBudgetMs);
          readinessTimer.unref();
        });
        const outcome = await Promise.race([
          bootRun.then(() => 'complete' as const),
          budgetExpired,
        ]);
        if (readinessTimer) clearTimeout(readinessTimer);
        if (outcome === 'budget') {
          logger.warn(
            {
              event: 'post_finalize_erasure_janitor_boot_readiness_budget_exhausted',
              bootReadinessBudgetMs,
              safetyPassContinues: true,
            },
            'erasure janitor boot pass exceeded the readiness budget and continues in background',
          );
          void bootRun.catch((err) => {
            logger.error(
              { err, event: 'post_finalize_erasure_janitor_boot_failure_after_readiness' },
              'background erasure janitor boot pass failed after API readiness',
            );
          });
        }
        armInterval();
      } catch (error) {
        started = false;
        throw error;
      }
    },
    async close() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await Promise.all([
        bootRun?.catch(() => {}),
        intervalRun?.catch(() => {}),
      ]);
    },
  };
}
