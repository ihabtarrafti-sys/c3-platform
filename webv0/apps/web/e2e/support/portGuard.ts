/**
 * portGuard.ts — the DECISION half of the e2e port preflight (instance 57).
 *
 * ⚖️ THE INVARIANT, and it is the whole point (Neural's ruling, 2026-08-01):
 *
 *     A test run must never silently adopt a server it did not start.
 *
 * The defect was never the fixed ports or the orphans — it was the SILENCE.
 * Playwright's `reuseExistingServer` defaults to true outside CI, so when an
 * `e2e-server` outlived its Playwright parent and kept listening on 4100, the
 * next run found the port answering, **skipped starting its own server, and
 * tested against the previous run's database.** It did not error. It reported
 * 38/38. **A green run in that state is a verification lying about what it
 * verified**, and a pass is the dangerous direction, not a failure.
 *
 * Caught 2026-07-31 by a name: a spec expected `Spring Invitational` and got
 * `Iris First Contact` — a string that exists nowhere in the repo. *A test
 * cannot be defeated by data it never created unless it is talking to the wrong
 * database.*
 *
 * ⚖️ THE DISCRIMINATOR IS THE JANITOR'S, ONE LAYER UP (see
 * `packages/test-support/src/pgSweep.ts`): **an orphan has no owner; a live
 * server has one, and it is not you.** A holder whose parent is gone belongs to
 * nobody and any lane may clear it. A holder whose parent is alive belongs to a
 * running suite — very possibly the other lane's — and is REFUSED, never killed.
 *
 * ⚠️ Same PID-recycling guard as the janitor: a parent must PREDATE its child,
 * or a recycled PID resurrects a dead owner and we would refuse forever on a
 * port held by nothing.
 *
 * ⛔ THIS IS NOT THE CORRECTNESS FLOOR. `reuseExistingServer: false` in
 * playwright.config.ts is — it makes silent adoption impossible by
 * construction. This preflight exists so the resulting failure is LEGIBLE
 * ("another run holds this port") rather than a bare EADDRINUSE that people
 * learn to retry through. Layered that way, a preflight that cannot inspect the
 * machine degrades to a warning and can never create a new silent-wrong.
 */

/**
 * Command-line markers identifying a server this harness starts.
 *
 * ⛔ NO PATH SEPARATORS. This is the janitor's lesson applied one layer up, and
 * I got it wrong here first: `apps/api/scripts/e2e-server.ts` matched nothing,
 * because the real command line on Windows carries BACKslashes
 * (`apps\api\scripts\e2e-server.ts`) while the Playwright config spells it with
 * forward ones. The guard then judged a stray server FOREIGN — refusing to
 * clear its own debris and blaming a stranger for it.
 *
 * A marker containing a separator is a marker that works on one spelling of the
 * same path. `e2e-server.ts` and `vite.js` are unique enough and cannot be
 * spelled two ways.
 */
export const E2E_API_MARKER = 'e2e-server.ts';
export const E2E_WEB_MARKER = 'vite.js';

export interface PortHolder {
  readonly port: number;
  readonly pid: number;
  readonly parentPid: number;
  /** Start time in epoch ms — used for the PID-recycling guard. */
  readonly startedMs: number;
  readonly commandLine: string;
}

/** One row of the process table, enough to walk ancestry without shipping every command line. */
export interface ProcessRow {
  readonly parentPid: number;
  readonly startedMs: number;
  /** True when this process is part of an e2e server's own launch chain. */
  readonly isOurServer: boolean;
}

export type PortVerdict =
  /** Nothing is listening. Proceed. */
  | { readonly kind: 'clear' }
  /** Ours, parent dead → nobody owns these; sweep and proceed. */
  | { readonly kind: 'orphan'; readonly holders: readonly PortHolder[] }
  /** Ours, parent alive → another run owns the port. REFUSE. */
  | { readonly kind: 'live'; readonly holders: readonly PortHolder[] }
  /** Not ours at all → REFUSE, and never touch it. */
  | { readonly kind: 'foreign'; readonly holders: readonly PortHolder[] };

export function isOurServer(commandLine: string): boolean {
  return commandLine.includes(E2E_API_MARKER) || commandLine.includes(E2E_WEB_MARKER);
}

/**
 * ⚠️ THE CORRECTION THAT MEASUREMENT FORCED — read before "simplifying" this
 * back to a parent check.
 *
 * The janitor's discriminator is *"is the PARENT alive?"*, and it is right for
 * postgres because a postmaster's parent is the node process that wants the
 * database. **It does NOT transfer to this layer.** Measured 2026-08-01 against
 * a real detached server, and matching the original incident exactly:
 *
 *     [0] listener 58252 → parent ALIVE   (a tsx wrapper)
 *     [1] wrapper  25096 → parent ALIVE   (a tsx wrapper)
 *     [2] wrapper  13480 → parent DEAD    ← the real boundary, 3 levels up
 *
 * **A server's immediate parent is always one of its OWN wrappers**, alive for
 * exactly as long as the server is. So a literal parent check calls every stale
 * server "live" and refuses forever — safe, but it would never sweep anything.
 *
 * The owner is the first ancestor OUTSIDE the server's own launch chain: for a
 * real run that is the live Playwright process; for a stray it is a launcher
 * that has exited. So: **climb through our own wrappers, then test the first
 * foreign ancestor.**
 *
 * The PID-recycling guard survives the move unchanged — an ancestor must
 * PREDATE the process it owns, or a reused PID resurrects a dead owner.
 */
export function findOwner(
  holder: PortHolder,
  table: ReadonlyMap<number, ProcessRow>,
): { readonly pid: number; readonly alive: boolean } {
  let currentPid = holder.pid;
  let currentStartedMs = holder.startedMs;

  // Climb while the ancestor is part of this server's own launch chain.
  // Bounded: a process tree has no cycles, and the cap is a belt on a corrupt table.
  for (let hops = 0; hops < 32; hops++) {
    const parentPid = hops === 0 ? holder.parentPid : (table.get(currentPid)?.parentPid ?? -1);
    const parent = table.get(parentPid);
    // Absent, or started after its child (a recycled PID) → the chain ends here,
    // and the owner is gone.
    if (!parent || parent.startedMs > currentStartedMs) return { pid: parentPid, alive: false };
    if (!parent.isOurServer) return { pid: parentPid, alive: true }; // the real owner, still running
    currentPid = parentPid;
    currentStartedMs = parent.startedMs;
  }
  return { pid: -1, alive: false };
}

export function isOwnerAlive(
  holder: PortHolder,
  table: ReadonlyMap<number, ProcessRow>,
): boolean {
  return findOwner(holder, table).alive;
}

/**
 * ⚠️ Precedence is deliberate: FOREIGN outranks LIVE outranks ORPHAN.
 *
 * A mixed set is never half-swept. If anything on these ports is owned or
 * unrecognised, the run refuses and touches nothing — clearing "the orphaned
 * half" of a set we do not fully understand is how a tidy-up becomes an
 * outage in someone else's suite.
 */
export function judgePorts(
  holders: readonly PortHolder[],
  table: ReadonlyMap<number, ProcessRow>,
): PortVerdict {
  if (holders.length === 0) return { kind: 'clear' };

  const foreign = holders.filter((h) => !isOurServer(h.commandLine));
  if (foreign.length > 0) return { kind: 'foreign', holders: foreign };

  const live = holders.filter((h) => isOwnerAlive(h, table));
  if (live.length > 0) return { kind: 'live', holders: live };

  return { kind: 'orphan', holders };
}

/** The human-facing verdict. Never a bare EADDRINUSE. */
export function explainVerdict(verdict: PortVerdict, ports: readonly number[]): string {
  const list = (holders: readonly PortHolder[]) =>
    holders.map((h) => `    port ${h.port} — pid ${h.pid}`).join('\n');

  switch (verdict.kind) {
    case 'clear':
      return `[e2e-preflight] ports ${ports.join(', ')} are free.`;
    case 'orphan':
      return [
        `[e2e-preflight] cleared ${verdict.holders.length} ORPHANED e2e server(s):`,
        list(verdict.holders),
        '  Their Playwright parent is gone, so nobody owned them. Left behind, the',
        '  next run would have silently tested against their database.',
      ].join('\n');
    case 'live':
      return [
        `[e2e-preflight] REFUSING TO RUN — another e2e run holds ${verdict.holders.length === 1 ? 'this port' : 'these ports'}:`,
        list(verdict.holders),
        '',
        '  These servers have a LIVE parent, so they belong to a running suite —',
        '  very likely the other lane on this machine. They have NOT been touched.',
        '',
        '  The e2e harness binds FIXED ports, so two lanes SERIALIZE here: wait for',
        '  the other run to finish, then re-run. This wait is reported rather than',
        '  silent on purpose — a blocked run must never look like a mystery.',
      ].join('\n');
    case 'foreign':
      return [
        `[e2e-preflight] REFUSING TO RUN — ${verdict.holders.length === 1 ? 'a process that is not ours holds a required port' : 'processes that are not ours hold required ports'}:`,
        list(verdict.holders),
        '',
        '  Not started by this harness, so it is NOT swept and NOT killed.',
        '  Stop it yourself, or free the port, then re-run.',
      ].join('\n');
  }
}
