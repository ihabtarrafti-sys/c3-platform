/**
 * e2ePortGuard.test.ts — instance 57: a test run must never silently adopt a
 * server it did not start.
 *
 * ⚖️ WHY BOTH DIRECTIONS ARE PROVEN HERE. The obvious half is that an orphaned
 * server must not be inherited. The half that matters to the OTHER LANE is that
 * a LIVE server must be REFUSED and never killed — a guard that cleared ports
 * enthusiastically would fix my flakes by destroying someone else's suite
 * mid-run. **An orphan has no owner; a live server has one, and it is not you.**
 */
import { describe, expect, it } from 'vitest';
import {
  E2E_API_MARKER,
  explainVerdict,
  findOwner,
  isOurServer,
  isOwnerAlive,
  judgePorts,
  type PortHolder,
  type ProcessRow,
} from '../e2e/support/portGuard';
import { E2E_API_PORT, E2E_PORTS, E2E_WEB_PORT } from '../e2e/support/ports';

const holder = (
  port: number,
  pid: number,
  parentPid: number,
  startedMs: number,
  commandLine: string,
): PortHolder => ({ port, pid, parentPid, startedMs, commandLine });

const row = (parentPid: number, startedMs: number, isOurServer: boolean): ProcessRow => ({
  parentPid,
  startedMs,
  isOurServer,
});

const apiCmd = `node node_modules/tsx/dist/cli.mjs apps/api/scripts/${E2E_API_MARKER}`;
const webCmd = 'node node_modules/vite/bin/vite.js --port 5199 --strictPort';
/** The BACKSLASH spelling of the same command — the one that broke it first. */
const apiCmdWindows = 'node node_modules\\tsx\\dist\\cli.mjs apps\\api\\scripts\\e2e-server.ts';

/**
 * The REAL process shape, measured 2026-08-01 and identical to the incident:
 * a listener sits under TWO of its own tsx wrappers, and the owner is three
 * levels up. Both scenarios below share this spine — only the owner differs.
 *
 *   listener 58252 → wrapper 25096 → wrapper 13480 → OWNER
 */
const LISTENER = 58252;
const WRAPPER_A = 25096;
const WRAPPER_B = 13480;
const OWNER = 38088;

const spine = (ownerRow: ProcessRow | null): Map<number, ProcessRow> => {
  const table = new Map<number, ProcessRow>([
    [LISTENER, row(WRAPPER_A, 1_000, true)],
    [WRAPPER_A, row(WRAPPER_B, 900, true)],
    [WRAPPER_B, row(OWNER, 800, true)],
  ]);
  if (ownerRow) table.set(OWNER, ownerRow);
  return table;
};

const listener = holder(E2E_API_PORT, LISTENER, WRAPPER_A, 1_000, apiCmd);

describe('GUARD 1 — a free port proceeds', () => {
  it('no holders is "clear"', () => {
    expect(judgePorts([], new Map()).kind).toBe('clear');
  });
});

describe('GUARD 2 — an ORPHANED server is swept (the failure that started this)', () => {
  // The owner (a launcher) has exited; only the server's own wrappers survive.
  const orphaned = spine(null);

  it('is judged ORPHAN even though its IMMEDIATE parent is alive', () => {
    // ⚠️ THE CORRECTION, pinned. WRAPPER_A is alive and is the listener's
    // parent, so a literal parent check calls this "live" and refuses forever.
    expect(orphaned.get(WRAPPER_A)).toBeDefined();
    expect(judgePorts([listener], orphaned).kind).toBe('orphan');
  });

  it('names the owner it climbed to, three levels up', () => {
    expect(findOwner(listener, orphaned)).toEqual({ pid: OWNER, alive: false });
  });

  it('says what it cleared and why, rather than clearing silently', () => {
    const message = explainVerdict(judgePorts([listener], orphaned), E2E_PORTS);
    expect(message).toContain('ORPHANED');
    expect(message).toContain(String(LISTENER));
    expect(message).toContain('silently tested against their database');
  });
});

describe('GUARD 3 — a LIVE server is REFUSED, never killed (the other lane depends on this)', () => {
  // The owner is a running Playwright process — NOT one of our wrappers.
  const owned = spine(row(4242, 700, false));

  it('is judged LIVE when the owner outside the server chain is still running', () => {
    expect(judgePorts([listener], owned).kind).toBe('live');
    expect(findOwner(listener, owned)).toEqual({ pid: OWNER, alive: true });
  });

  it('the message names the wait as a REPORTED condition, never a mystery', () => {
    const message = explainVerdict(judgePorts([listener], owned), E2E_PORTS);
    expect(message).toContain('REFUSING TO RUN');
    expect(message).toContain('SERIALIZE');
    expect(message).toContain('have NOT been touched');
  });

  it('⚠️ PID RECYCLING: an owner that started AFTER the process it owns is not an owner', () => {
    // Windows reissues dead PIDs. Without the predate clause a reused PID
    // resurrects a dead owner and the port is defended forever by nothing.
    const recycled = spine(row(4242, 9_000, false));
    expect(isOwnerAlive(listener, recycled)).toBe(false);
    expect(judgePorts([listener], recycled).kind).toBe('orphan');
  });

  it('a truncated table cannot silently promote an orphan to owned', () => {
    // If the walk runs out of table, the owner is absent — which is "gone",
    // never "alive". Failing the other way would sweep a live neighbour.
    expect(isOwnerAlive(listener, new Map())).toBe(false);
  });
});

describe('GUARD 4 — precedence: a mixed set is NEVER half-swept', () => {
  const strayWeb = holder(E2E_WEB_PORT, 19896, 56720, 1_050, webCmd);

  it('FOREIGN outranks everything — an unrecognised holder is refused, not killed', () => {
    const foreign = holder(E2E_API_PORT, 900, 4, 1_000, 'C:\\Program Files\\SomeoneElse\\server.exe');
    const verdict = judgePorts([foreign, strayWeb], spine(null));
    expect(verdict.kind).toBe('foreign');
    // ⛔ Only the foreign holder is reported and NOTHING is swept: clearing the
    // "orphaned half" of a set we do not fully understand is how a tidy-up
    // becomes an outage in someone else's suite.
    expect(verdict.kind === 'foreign' && verdict.holders.map((h) => h.pid)).toEqual([900]);
  });

  it('LIVE outranks ORPHAN — one owned port blocks the run even beside a stray', () => {
    const owned = spine(row(4242, 700, false));
    const verdict = judgePorts([listener, strayWeb], owned);
    expect(verdict.kind).toBe('live');
    expect(verdict.kind === 'live' && verdict.holders.map((h) => h.pid)).toEqual([LISTENER]);
  });
});

describe('GUARD 5 — the marker survives BOTH path spellings', () => {
  it('recognises the backslash command line, which is what Windows actually reports', () => {
    // ⛔ THE DEFECT, pinned. The marker used to be `apps/api/scripts/e2e-server.ts`
    // with forward slashes. Windows reports backslashes, so a real stray server
    // was judged FOREIGN — the guard refused to clear its OWN debris and blamed
    // a stranger for holding the port. Verified against a live process.
    expect(isOurServer(apiCmdWindows)).toBe(true);
    expect(isOurServer(apiCmd)).toBe(true);
    expect(judgePorts([holder(E2E_API_PORT, LISTENER, WRAPPER_A, 1_000, apiCmdWindows)], spine(null)).kind)
      .toBe('orphan');
  });

  it('still refuses to claim a process that merely lives in a similar path', () => {
    expect(isOurServer('C:\\Program Files\\PostgreSQL\\16\\bin\\postgres.exe -D C:\\pgdata')).toBe(false);
    expect(isOurServer('node node_modules/some-other-tool/index.js')).toBe(false);
  });
});

describe('GUARD 6 — the ports have ONE source of truth', () => {
  it('the guarded set is exactly the two the harness binds', () => {
    expect(E2E_PORTS).toEqual([E2E_API_PORT, E2E_WEB_PORT]);
  });

  it('⛔ the CORRECTNESS FLOOR is pinned: reuseExistingServer stays false', async () => {
    // This, not the preflight, is what makes silent adoption impossible. The
    // preflight only makes the resulting failure legible. If someone restores
    // the `!process.env.CI` default, instance 57 returns in full.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const config = readFileSync(join(webRoot, 'playwright.config.ts'), 'utf8');
    expect(config).not.toMatch(/reuseExistingServer:\s*!process\.env\.CI/);
    expect(config.match(/reuseExistingServer:\s*false/g) ?? []).toHaveLength(2); // API + web
  });

  it('no spec hardcodes the API port any more', async () => {
    // The spec used to pin `http://127.0.0.1:4100` itself, which could outlive a
    // config change and point at a server this run never started.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const spec = readFileSync(join(webRoot, 'e2e', 'tablework-comms.spec.ts'), 'utf8');
    expect(spec).not.toMatch(/['"]http:\/\/127\.0\.0\.1:\d+['"]/);
    expect(spec).toContain('E2E_API_ORIGIN');
  });
});
