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

export type ErasureJanitorTrigger = 'boot' | 'interval' | 'owner';

export interface ErasureJanitorResult {
  readonly recordsSeen: number;
  readonly recordsSwept: number;
  readonly recordsSkipped: number;
  readonly stragglersDestroyed: number;
  readonly failures: number;
}

export interface ErasureJanitorService {
  readonly intervalMs: number;
  run(trigger: ErasureJanitorTrigger): Promise<ErasureJanitorResult>;
}

interface ErasedPrefixRow {
  tenant_ref: string;
  doc_prefix: string;
  intake_prefix: string;
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
): Promise<ErasureJanitorResult> {
  const candidates = await pool.query<{ tenant_ref: string }>(
    `SELECT tenant_ref FROM erased_tenant_prefix ORDER BY finalized_at, tenant_ref`,
  );
  let recordsSwept = 0;
  let recordsSkipped = 0;
  let stragglersDestroyed = 0;
  let failures = 0;

  for (const candidate of candidates.rows) {
    const client = await pool.connect();
    let inTransaction = false;
    let lockedRow: ErasedPrefixRow | undefined;
    const caught = new Set<string>();
    const destroyed = new Set<string>();
    try {
      await client.query('BEGIN');
      inTransaction = true;
      const locked = await client.query<ErasedPrefixRow>(
        `SELECT tenant_ref, doc_prefix, intake_prefix
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

      const prefixes = [lockedRow.doc_prefix, lockedRow.intake_prefix];
      // A publication may become visible between the first list and the
      // completion observation. Keep converging until a full two-prefix list is
      // empty; anything that appears after that observation belongs to the next
      // pass, and the permanent row remains authoritative for it.
      for (;;) {
        const present = new Set<string>();
        for (const prefix of prefixes) {
          for (const key of await storage.listKeys(prefix)) {
            if (!key.startsWith(prefix)) {
              throw new Error(`storage driver returned key outside erased prefix '${prefix}'`);
            }
            present.add(key);
          }
        }
        if (present.size === 0) break;

        const newlyCaught = [...present].filter((key) => !caught.has(key));
        for (const key of newlyCaught) caught.add(key);
        if (newlyCaught.length > 0) {
          // Count discoveries before storage deletion. If a later delete/list
          // fails, the catch remains durable when the failure transaction can
          // commit, and the permanent row remains available for retry.
          await client.query(
            `UPDATE erased_tenant_prefix
                SET straggler_count = straggler_count + $2::bigint
              WHERE tenant_ref = $1`,
            [lockedRow.tenant_ref, newlyCaught.length],
          );
          logger.warn(
            {
              event: 'post_finalize_erasure_straggler_caught',
              tenantRef: lockedRow.tenant_ref,
              trigger,
              stragglersCaught: newlyCaught.length,
            },
            'post-finalize erasure janitor caught storage straggler(s)',
          );
        }
        for (const key of present) {
          await storage.delete(key);
          destroyed.add(key);
        }
      }

      const passResult = JSON.stringify({
        status: caught.size > 0 ? 'stragglers_destroyed' : 'clean',
        trigger,
        stragglersCaught: caught.size,
      });
      await client.query(
        `UPDATE erased_tenant_prefix
            SET last_swept_at = now(),
                last_result = $2
          WHERE tenant_ref = $1`,
        [lockedRow.tenant_ref, passResult],
      );
      await client.query('COMMIT');
      inTransaction = false;
      recordsSwept += 1;
      stragglersDestroyed += destroyed.size;

      if (caught.size > 0) {
        logger.info(
          {
            event: 'post_finalize_erasure_straggler_destroyed',
            tenantRef: lockedRow.tenant_ref,
            trigger,
            stragglersDestroyed: destroyed.size,
          },
          'post-finalize erasure janitor destroyed storage straggler(s)',
        );
      }
    } catch (err) {
      failures += 1;
      stragglersDestroyed += destroyed.size;
      if (inTransaction && lockedRow) {
        try {
          await recordFailedPass(client, lockedRow.tenant_ref, trigger);
          await client.query('COMMIT');
          inTransaction = false;
        } catch {
          // A database failure can leave the transaction aborted. The permanent
          // row still exists; rollback and let the next pass retry it.
        }
      }
      if (inTransaction) await client.query('ROLLBACK').catch(() => {});
      logger.error(
        { err, event: 'post_finalize_erasure_janitor_failure', tenantRef: candidate.tenant_ref, trigger },
        'post-finalize erasure janitor record failed; permanent authority retained for retry',
      );
    } finally {
      client.release();
    }
  }

  const result: ErasureJanitorResult = {
    recordsSeen: candidates.rows.length,
    recordsSwept,
    recordsSkipped,
    stragglersDestroyed,
    failures,
  };
  logger.info({ event: 'post_finalize_erasure_janitor_pass', trigger, ...result }, 'post-finalize erasure janitor pass complete');
  return result;
}

export function createErasureJanitorService(options: {
  readonly pool: Pool;
  readonly storage: DocumentStorage;
  readonly logger: Logger;
  readonly intervalMs?: number;
}): ErasureJanitorService {
  const intervalMs = options.intervalMs ?? DEFAULT_ERASURE_JANITOR_INTERVAL_MS;
  if (!Number.isSafeInteger(intervalMs) || intervalMs <= 0 || intervalMs > MAX_ERASURE_JANITOR_INTERVAL_MS) {
    throw new Error(`erasure janitor interval must be a positive safe integer no greater than ${MAX_ERASURE_JANITOR_INTERVAL_MS}ms`);
  }
  let active: Promise<ErasureJanitorResult> | undefined;
  let queuedOwner: Promise<ErasureJanitorResult> | undefined;

  const launch = (trigger: ErasureJanitorTrigger): Promise<ErasureJanitorResult> => {
    const pass = runErasureJanitorPass(options.pool, options.storage, options.logger, trigger);
    active = pass;
    void pass.then(
      () => { if (active === pass) active = undefined; },
      () => { if (active === pass) active = undefined; },
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

/** API-process scheduler: a blocking boot catch-up followed by a daily-or-faster
 * interval. The timer is unref'd and shutdown waits for an active interval pass. */
export function createErasureJanitorScheduler(service: ErasureJanitorService, logger: Logger): ErasureJanitorScheduler {
  let started = false;
  let timer: NodeJS.Timeout | undefined;
  let intervalRun: Promise<ErasureJanitorResult> | undefined;
  return {
    async start() {
      if (started) return;
      await service.run('boot');
      started = true;
      timer = setInterval(() => {
        intervalRun = service.run('interval');
        void intervalRun.catch((err) => {
          logger.error({ err, event: 'post_finalize_erasure_janitor_interval_failure' }, 'erasure janitor interval pass failed');
        }).finally(() => {
          intervalRun = undefined;
        });
      }, service.intervalMs);
      timer.unref();
    },
    async close() {
      if (timer) clearInterval(timer);
      timer = undefined;
      await intervalRun?.catch(() => {});
    },
  };
}
