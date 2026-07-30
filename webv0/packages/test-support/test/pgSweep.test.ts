/**
 * pgSweep.test.ts — the embedded-PostgreSQL janitor's decision rule.
 *
 * ⚖️ WHY THIS FILE EXISTS: the janitor kills processes on a machine that now
 * hosts more than one lane. Its previous rule was wrong in two opposite
 * directions at once — it could not see the debris that actually hurts, and it
 * would have killed a neighbour's healthy cluster — and NEITHER defect was
 * detectable without a test, because the effects are unobservable in a passing
 * run. Splitting the decision out from the effects is what makes them assertable.
 *
 * Each guard below carries the OLD rule alongside the new one and asserts that
 * the old rule gets it wrong. That is stronger than a one-time red: the defect
 * stays described in the suite, so a future "simplification" back to the old
 * shape fails here with its own history attached.
 */
import { describe, expect, it } from 'vitest';
import {
  BLIND_SWEEP_AGE_MS,
  EMBEDDED_PG_MARKER,
  STARTUP_RACE_GRACE_MS,
  isParentAlive,
  planPgDirSweep,
  planPgProcessSweep,
  type ObservedProcess,
} from '../src/pgSweep';

const BIN = 'C:/Projects/c3-fable/webv0/node_modules/@embedded-postgres/windows-x64/native/bin/postgres.exe';
/** The real shape, captured from a live cluster on 2026-07-30. */
const postmasterCmd = (token: string) =>
  `C:\\Projects\\c3-fable\\webv0\\node_modules\\@embedded-postgres\\windows-x64\\native\\bin\\postgres.exe -D C:\\Users\\marsh\\AppData\\Local\\Temp\\${token} -p 54999`;
const forkchildCmd = (role: string) => `"${BIN}" --forkchild="${role}" 5856`;

const proc = (
  pid: number,
  parentPid: number,
  startedMs: number,
  commandLine: string,
): ObservedProcess => ({ pid, parentPid, startedMs, commandLine });

/**
 * The rule this fix REPLACED: "a process is ours only if its command line
 * carries a c3web-pg-* data-dir token." Reproduced verbatim so the guards can
 * show what it did.
 */
const oldRuleWouldTouch = (p: ObservedProcess): boolean => /c3web-pg-[A-Za-z0-9]+/.test(p.commandLine);

describe('GUARD 1 — orphaned forkchild CHILDREN are swept (the "too timid" defect)', () => {
  it('sweeps children whose postmaster is gone — the 15 found on 2026-07-30', () => {
    // Reconstructed from the real incident: every child was parented to a dead
    // postmaster, every command line was readable, none carried a data-dir token.
    const orphans = Array.from({ length: 15 }, (_, i) =>
      proc(52100 + i, 36540 /* postmaster, NOT in the table */, 1_000 + i, forkchildCmd('io_worker')),
    );

    const plan = planPgProcessSweep(orphans, new Map());

    expect(plan.kill).toHaveLength(15);
    expect(plan.activeTokens).toEqual([]);
    // ⛔ THE DEFECT, pinned: the old rule could not touch a single one of them,
    // because only a POSTMASTER carries the token it keyed on. This is why they
    // survived every sweep and went on to block `npm ci` with EPERM.
    expect(orphans.filter(oldRuleWouldTouch)).toEqual([]);
  });
});

describe('GUARD 2 — a cluster IN USE is never touched, at any age (the "too aggressive" defect)', () => {
  const NODE = 36540;
  const live: ObservedProcess[] = [
    proc(42736, NODE, 5_000, postmasterCmd('c3web-pg-IXWY6c')),
    ...['io_worker', 'checkpointer', 'bgwriter', 'wal_writer'].map((role, i) =>
      proc(17100 + i, 42736, 5_100 + i, forkchildCmd(role)),
    ),
  ];
  const table = new Map([[NODE, 4_000]]); // the node process started before postgres

  it('kills nothing and reports the cluster as active', () => {
    const plan = planPgProcessSweep(live, table);
    expect(plan.kill).toEqual([]);
    expect(plan.activeTokens).toEqual(['c3web-pg-IXWY6c']);
  });

  it('holds even if the caller\'s process table omits the postgres rows themselves', () => {
    // ⚠️ THIS IS THE CASE THAT FAILED FIRST. A child's parent is its postmaster,
    // which lives in the observed list rather than the caller's table — so a
    // table without the postgres rows made every child look parentless and
    // scheduled a healthy cluster for death. The plan now treats the observed
    // processes as evidence of their own liveness instead of trusting the
    // caller to pass a complete table.
    const withoutPostgresRows = new Map([[NODE, 4_000]]);
    expect(planPgProcessSweep(live, withoutPostgresRows).kill).toEqual([]);

    // And with a complete table — the shape the real wrapper passes — identical.
    const complete = new Map<number, number>([[NODE, 4_000], ...live.map((p): [number, number] => [p.pid, p.startedMs])]);
    expect(planPgProcessSweep(live, complete).kill).toEqual([]);
  });

  it('its data dir survives even when the mtime says three hours — age is NOT liveness', () => {
    // The measured fact that broke the old rule: a healthy cluster's dir read
    // 119 minutes "stale" because a running PostgreSQL never advances the
    // top-level mtime. Here it is three hours and still protected.
    const plan = planPgProcessSweep(live, table);
    const removable = planPgDirSweep(
      [{ name: 'c3web-pg-IXWY6c', ageMs: 3 * 60 * 60 * 1000 }],
      new Set(plan.activeTokens),
      STARTUP_RACE_GRACE_MS,
    );
    expect(removable).toEqual([]);
  });
});

describe('GUARD 3 — the PID-RECYCLING guard (the trap inside the fix)', () => {
  const orphanedPostmaster = proc(42736, 500, 5_000, postmasterCmd('c3web-pg-RECYCL'));

  it('a parent PID reused by a LATER process does not resurrect a dead parent', () => {
    // Windows reissues the PIDs of dead processes. Something now holds PID 500,
    // but it started AFTER the postgres process — so it cannot be its parent.
    const recycled = new Map([[500, 9_000]]);
    expect(isParentAlive(orphanedPostmaster, recycled)).toBe(false);
    expect(planPgProcessSweep([orphanedPostmaster], recycled).kill).toEqual([42736]);

    // ⛔ Without the start-time clause the check answers a DIFFERENT question —
    // "is that PID in use?" — and returns true, protecting an orphan forever.
    const naiveParentAlive = recycled.has(orphanedPostmaster.parentPid);
    expect(naiveParentAlive).toBe(true);
  });

  it('a genuine parent — one that predates its child — protects it', () => {
    const genuine = new Map([[500, 4_000]]);
    expect(isParentAlive(orphanedPostmaster, genuine)).toBe(true);
    expect(planPgProcessSweep([orphanedPostmaster], genuine).kill).toEqual([]);
  });

  it('an equal start time counts as a parent — the boundary is inclusive, not a race', () => {
    expect(isParentAlive(orphanedPostmaster, new Map([[500, 5_000]]))).toBe(true);
  });
});

describe('GUARD 4 — an orphaned postmaster takes its children with it (propagation)', () => {
  const DEAD_NODE = 36540;
  const tree: ObservedProcess[] = [
    proc(42736, DEAD_NODE, 5_000, postmasterCmd('c3web-pg-ORPHAN')),
    proc(17100, 42736, 5_100, forkchildCmd('io_worker')),
    proc(17101, 42736, 5_200, forkchildCmd('checkpointer')),
  ];

  it('kills the whole tree, PARENT FIRST, and frees the data dir', () => {
    const plan = planPgProcessSweep(tree, new Map());
    expect(plan.kill).toEqual([42736, 17100, 17101]); // ascending start time
    // The dir is NOT active — the cluster is dead, so its directory is reclaimable.
    expect(plan.activeTokens).toEqual([]);
  });

  it('a single pass would have left the children behind — recreating the leak', () => {
    // The children's parent (the postmaster) is genuinely alive at scan time, so
    // only the fixpoint carries orphan-hood down to them. Without it the sweep
    // would kill the postmaster and manufacture three fresh orphans.
    const startedMsByPid = new Map(tree.map((p) => [p.pid, p.startedMs]));
    const singlePass = tree.filter((p) => !isParentAlive(p, startedMsByPid)).map((p) => p.pid);
    expect(singlePass).toEqual([42736]);
  });
});

describe('GUARD 5 — CONSERVATISM: a real PostgreSQL on this machine stays unkillable', () => {
  it('a system-installed postgres is foreign even when orphaned', () => {
    const system = proc(900, 4, 1_000, 'C:\\Program Files\\PostgreSQL\\16\\bin\\postgres.exe -D C:\\pgdata');
    const plan = planPgProcessSweep([system], new Map());
    expect(plan.kill).toEqual([]);
    expect(plan.foreign).toEqual([900]);
  });

  it('the marker is what makes it ours, and it survives BOTH path separator styles', () => {
    // Measured: the postmaster's command line uses backslashes, its children use
    // forward slashes. A separator-sensitive match would have missed one of them.
    expect(postmasterCmd('c3web-pg-X')).toContain(EMBEDDED_PG_MARKER);
    expect(forkchildCmd('io_worker')).toContain(EMBEDDED_PG_MARKER);
  });
});

describe('GUARD 6 — the dir sweep: age is the STARTUP-RACE guard and nothing else', () => {
  const dirs = [
    { name: 'c3web-pg-STARTING', ageMs: 30_000 }, // mkdtemp done, postmaster not up yet
    { name: 'c3web-pg-LEAKED', ageMs: 45 * 60 * 1000 },
    { name: 'some-other-temp-dir', ageMs: 10 * 60 * 60 * 1000 },
  ];

  it('protects a directory whose cluster is still starting, and removes a leaked one', () => {
    expect(planPgDirSweep(dirs, new Set(), STARTUP_RACE_GRACE_MS)).toEqual(['c3web-pg-LEAKED']);
  });

  it('never touches directories that are not ours', () => {
    expect(planPgDirSweep(dirs, new Set(), 0)).not.toContain('some-other-temp-dir');
  });

  it('the BLIND fallback is strictly MORE conservative than the normal grace', () => {
    // When the process table cannot be read there are no active tokens, so every
    // dir looks unreferenced. The fallback must not be the short grace, or a
    // failed listing would delete a running cluster's directory.
    expect(BLIND_SWEEP_AGE_MS).toBeGreaterThan(STARTUP_RACE_GRACE_MS);
    expect(planPgDirSweep(dirs, new Set(), BLIND_SWEEP_AGE_MS)).toEqual([]);
  });
});
