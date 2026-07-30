/**
 * pgSweep.ts — the DECISION half of the embedded-PostgreSQL janitor, split out
 * from the effects so it can be tested without killing anything.
 *
 * ⚖️ WHY THIS EXISTS AT ALL (Neural's ruling, 2026-07-30). The janitor used to
 * decide liveness from a data directory's **mtime**, and that is not a liveness
 * signal. Measured on this machine: `c3web-pg-3LaAcY` was created at 20:25:59
 * with an mtime of 20:26:01 and read **119 minutes "stale" while perfectly
 * healthy** — a directory's mtime only moves when entries are added or removed
 * at its top level, which a running PostgreSQL does not do. So "age" meant
 * CREATED-long-ago, never IDLE, and an hour-old *live* cluster was a kill
 * candidate. With one lane and ~12-minute gates that never bit; the moment a
 * second lane holds a preview cluster open, it does.
 *
 * ⚖️ THE REPLACEMENT SIGNAL: **PARENT LIVENESS.** A cluster in use has a live
 * parent — the node process running the test or the preview server. A process
 * whose parent is gone is an ORPHAN, and an orphan has no owner: it belongs to
 * no lane, so any lane may clear it. That reframe is what makes this safe to
 * run on a shared machine at all.
 *
 * ⚠️ AND THE TRAP INSIDE THE REPLACEMENT — PID RECYCLING. Windows reuses the
 * PIDs of dead processes. A naive "is the parent PID alive?" check answers TRUE
 * when an unrelated new process happens to hold the recycled PID, and the
 * janitor would then sweep a live cluster while believing it had protected it —
 * the same shape as the bug it replaces: a check that looks right and answers a
 * different question. **A parent must predate its child**, so the parent's start
 * time must be EARLIER than the child's. See `isParentAlive`.
 */

/**
 * Every embedded-postgres process — postmaster AND `--forkchild` children —
 * runs from the vendored binary, so its command line contains this marker.
 *
 * ⛔ THIS IS THE CONSERVATISM GUARANTEE, and it is load-bearing: a
 * system-installed PostgreSQL's command line can never contain it, so this
 * sweep cannot reach a real database on the developer's machine. The previous
 * guarantee ("only kill what carries a `c3web-pg-*` data-dir token") had to be
 * replaced because ONLY THE POSTMASTER carries that token — which is precisely
 * why the children survived every sweep and piled up.
 *
 * Verified empirically 2026-07-30 by starting one cluster and reading all nine
 * command lines: the postmaster carries `-D …\c3web-pg-IXWY6c` with BACKslashes,
 * the eight children carry `--forkchild="io_worker"` and the binary path with
 * FORWARD slashes. The marker is the one string common to both, and matching it
 * as a plain substring is what makes it separator-agnostic.
 */
export const EMBEDDED_PG_MARKER = '@embedded-postgres';

/** Prefix of the mkdtemp data directories (`mkdtempSync(join(tmpdir(), 'c3web-pg-'))`). */
export const DATA_DIR_PREFIX = 'c3web-pg-';

/** Non-global on purpose: a /g/ regex carries lastIndex state between calls. */
const DATA_DIR_TOKEN = /c3web-pg-[A-Za-z0-9]+/;

/**
 * A short grace period for data directories, and the ONLY thing age is still
 * legitimately used for: `mkdtempSync` creates the directory before the
 * postmaster spawns, so there is a real window in which a perfectly healthy
 * cluster has a directory and no process. Sweeping there would break a cluster
 * that is *starting*.
 *
 * ⚠️ TO THE NEXT READER: this is 10 minutes and it must NOT be restored to an
 * hour. The hour was a failed attempt to infer liveness from age; liveness is
 * now decided by parent-liveness above, and a live cluster's directory is
 * protected by its token at ANY age. This number only has to outlast `initdb`.
 */
export const STARTUP_RACE_GRACE_MS = 10 * 60 * 1000;

/**
 * The fallback age used when the process table could NOT be read (a non-Windows
 * platform, or a failed listing). Without process information there are no
 * active tokens, so every directory would look unreferenced and the short grace
 * would delete a running cluster's directory out from under it. Falling back to
 * the old conservative hour is strictly no worse than the previous behaviour.
 */
export const BLIND_SWEEP_AGE_MS = 60 * 60 * 1000;

/** One row of the OS process table, normalised. */
export interface ObservedProcess {
  readonly pid: number;
  readonly parentPid: number;
  /** Process start time in epoch ms — used for the PID-recycling guard. */
  readonly startedMs: number;
  readonly commandLine: string;
}

export interface PgProcessSweepPlan {
  /** Orphans to kill, PARENTS FIRST (ascending start time). */
  readonly kill: readonly number[];
  /** Data-dir tokens of clusters IN USE — their directories survive at any age. */
  readonly activeTokens: readonly string[];
  /** Processes that are not ours at all. Never touched; reported so the log can say so. */
  readonly foreign: readonly number[];
}

/**
 * A parent counts as alive only if it is present in the process table AND
 * started no later than the child. The second clause is the PID-recycling
 * guard — without it a recycled PID resurrects a dead parent.
 */
export function isParentAlive(
  proc: ObservedProcess,
  startedMsByPid: ReadonlyMap<number, number>,
): boolean {
  const parentStartedMs = startedMsByPid.get(proc.parentPid);
  if (parentStartedMs === undefined) return false;
  return parentStartedMs <= proc.startedMs;
}

/**
 * Decides which embedded-PostgreSQL processes are orphans.
 *
 * The propagation step matters and is not decoration: when a postmaster is
 * itself orphaned (its node parent died), its children still have a LIVE parent
 * — the postmaster — so a single pass would kill the postmaster and leave the
 * children behind, **recreating the exact leak this fix exists to close.** The
 * fixpoint carries orphan-hood down the tree so the plan states what actually
 * dies rather than relying on `taskkill /T` to quietly do more than the plan
 * admits.
 */
export function planPgProcessSweep(
  processes: readonly ObservedProcess[],
  startedMsByPid: ReadonlyMap<number, number>,
): PgProcessSweepPlan {
  const ours: ObservedProcess[] = [];
  const foreign: number[] = [];
  for (const proc of processes) {
    if (proc.commandLine.includes(EMBEDDED_PG_MARKER)) ours.push(proc);
    else foreign.push(proc.pid);
  }

  // ⚠️ THE OBSERVED PROCESSES ARE THEMSELVES EVIDENCE OF LIVENESS. A postgres
  // child's parent is its postmaster, which is in `processes` — so if the
  // caller's table happened to omit the postgres rows, every child would look
  // parentless and a live cluster would be swept. Depending on the caller to
  // pass a COMPLETE table is exactly the kind of unstated contract this whole
  // fix exists to remove, so the union is taken here rather than assumed.
  // (Caught by GUARD 2 the first time this file ran.)
  const liveStarts = new Map(startedMsByPid);
  for (const proc of processes) {
    if (!liveStarts.has(proc.pid)) liveStarts.set(proc.pid, proc.startedMs);
  }

  const doomed = new Set<number>();
  for (const proc of ours) {
    if (!isParentAlive(proc, liveStarts)) doomed.add(proc.pid);
  }
  // Carry orphan-hood down the tree. Terminates: a process tree has no cycles
  // (a parent always predates its child), and each pass adds at least one pid.
  for (let changed = true; changed; ) {
    changed = false;
    for (const proc of ours) {
      if (doomed.has(proc.pid) || !doomed.has(proc.parentPid)) continue;
      doomed.add(proc.pid);
      changed = true;
    }
  }

  const activeTokens = new Set<string>();
  for (const proc of ours) {
    if (doomed.has(proc.pid)) continue;
    const token = DATA_DIR_TOKEN.exec(proc.commandLine)?.[0];
    if (token) activeTokens.add(token);
  }

  return {
    // Parents first, so a tree dies from the top and children never get a
    // window in which to be re-parented.
    kill: ours
      .filter((proc) => doomed.has(proc.pid))
      .sort((a, b) => a.startedMs - b.startedMs || a.pid - b.pid)
      .map((proc) => proc.pid),
    activeTokens: [...activeTokens].sort(),
    foreign: [...foreign].sort((a, b) => a - b),
  };
}

/** A candidate temp directory. */
export interface ObservedDir {
  readonly name: string;
  readonly ageMs: number;
}

/**
 * Data directories are removable when no LIVE cluster references them. Age is
 * only the startup-race guard (see STARTUP_RACE_GRACE_MS) — it is deliberately
 * NOT a liveness test, because the directory mtime never advances.
 */
export function planPgDirSweep(
  dirs: readonly ObservedDir[],
  activeTokens: ReadonlySet<string>,
  minAgeMs: number,
): readonly string[] {
  return dirs
    .filter(
      (dir) =>
        dir.name.startsWith(DATA_DIR_PREFIX) &&
        !activeTokens.has(dir.name) &&
        dir.ageMs >= minAgeMs,
    )
    .map((dir) => dir.name)
    .sort();
}
