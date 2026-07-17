/**
 * queryStats.ts — L-05b query-count instrumentation (the perf-budget mechanism
 * from C3-L05-ASSESSMENT.md). Wraps a pg Pool so tests can tally how many SQL
 * statements (round trips) and result rows a code path actually costs — the
 * guardrail number an SQL-scoped loader must beat against the full-load path.
 *
 * The wrap happens at CLIENT CHECKOUT (pool.connect), which also covers
 * pool.query (pg implements it via an internal checkout), so each statement is
 * counted exactly once. Statements include BEGIN/SET/COMMIT — round trips are
 * the honest cost unit. Test-only tooling: production pools are never wrapped.
 */
import type { Pool, PoolClient } from 'pg';

export interface QueryStats {
  /** Statements sent (every round trip, including BEGIN/SET/COMMIT). */
  statements: number;
  /** Rows returned across all statements. */
  rows: number;
}

export interface QueryRecorder {
  readonly stats: QueryStats;
  reset(): void;
  /** Snapshot-copy of the current counters. */
  snapshot(): QueryStats;
}

const WRAPPED = Symbol('c3-query-stats-wrapped');

export function instrumentPool(pool: Pool): QueryRecorder {
  const stats: QueryStats = { statements: 0, rows: 0 };

  const tally = (result: unknown): void => {
    stats.statements += 1;
    const r = result as { rowCount?: number | null; rows?: unknown[] } | null | undefined;
    if (r && typeof r === 'object') {
      if (typeof r.rowCount === 'number') stats.rows += r.rowCount;
      else if (Array.isArray(r.rows)) stats.rows += r.rows.length;
    }
  };

  const wrapClient = (client: PoolClient & { [WRAPPED]?: boolean }): void => {
    if (client[WRAPPED]) return; // pooled clients are reused — wrap once
    client[WRAPPED] = true;
    const orig = client.query.bind(client) as (...args: unknown[]) => unknown;
    (client as { query: unknown }).query = (...args: unknown[]) => {
      const out = orig(...args);
      if (out && typeof (out as PromiseLike<unknown>).then === 'function') {
        return (out as Promise<unknown>).then((res) => {
          tally(res);
          return res;
        });
      }
      // Callback/stream style: count the round trip; rows are unknowable here.
      stats.statements += 1;
      return out;
    };
  };

  const origConnect = pool.connect.bind(pool) as (...args: unknown[]) => unknown;
  (pool as { connect: unknown }).connect = (...args: unknown[]) => {
    if (typeof args[0] === 'function') {
      // pg's Pool.query checks out via this callback path.
      const cb = args[0] as (err: unknown, client: PoolClient | undefined, release: unknown) => void;
      return origConnect((err: unknown, client: PoolClient | undefined, release: unknown) => {
        if (client) wrapClient(client);
        cb(err, client, release);
      });
    }
    return (origConnect() as Promise<PoolClient>).then((client) => {
      wrapClient(client);
      return client;
    });
  };

  return {
    stats,
    reset() {
      stats.statements = 0;
      stats.rows = 0;
    },
    snapshot() {
      return { statements: stats.statements, rows: stats.rows };
    },
  };
}
