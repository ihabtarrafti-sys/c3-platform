/**
 * preflight.ts — the EFFECTS half of the e2e port guard. Runs BEFORE Playwright
 * (see the `e2e` script in package.json), because Playwright starts its
 * webServers before `globalSetup`, which would be too late to refuse.
 *
 * Reads the port holders, asks `portGuard` what they are, and either clears
 * orphans, refuses loudly, or gets out of the way. See portGuard.ts for the
 * invariant and the discriminator; this file only does the talking to the OS.
 *
 * ⛔ It never fails the run because IT could not inspect the machine. The
 * correctness floor is `reuseExistingServer: false` in playwright.config.ts —
 * if this preflight is blind, Playwright still cannot silently adopt anything,
 * it just fails less legibly. A guard that degrades to a warning cannot invent
 * a new silent-wrong; one that degrades to a hard stop would block the lane on
 * its own blind spot.
 */
import { execFileSync } from 'node:child_process';
import { E2E_PORTS } from './ports';
import {
  E2E_API_MARKER,
  E2E_WEB_MARKER,
  explainVerdict,
  judgePorts,
  type PortHolder,
  type ProcessRow,
} from './portGuard';

interface RawHolder {
  Port?: number;
  Pid?: number;
  ParentPid?: number;
  StartMs?: number;
  CommandLine?: string | null;
}

/**
 * `IsOurs` is computed HERE rather than shipping every command line back: the
 * ancestry walk needs to know which ancestors are the server's own wrappers,
 * and that is one boolean per process instead of a few hundred command lines.
 */
const PS_QUERY = `
$ports = @(${E2E_PORTS.join(',')})
$marker = '${E2E_API_MARKER}'
$webMarker = '${E2E_WEB_MARKER}'
$rows = @()
foreach ($p in $ports) {
  foreach ($c in (Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue)) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
    if ($proc) {
      $rows += [pscustomobject]@{
        Port = $p; Pid = $proc.ProcessId; ParentPid = $proc.ParentProcessId
        StartMs = $(if ($proc.CreationDate) { [int64]((($proc.CreationDate).ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) } else { 0 })
        CommandLine = $proc.CommandLine
      }
    }
  }
}
$all = Get-CimInstance Win32_Process | ForEach-Object {
  $cl = $_.CommandLine
  [pscustomobject]@{
    Pid = $_.ProcessId
    ParentPid = $_.ParentProcessId
    StartMs = $(if ($_.CreationDate) { [int64]((($_.CreationDate).ToUniversalTime() - [datetime]'1970-01-01').TotalMilliseconds) } else { 0 })
    IsOurs = [bool]($cl -and ($cl.Contains($marker) -or $cl.Contains($webMarker)))
  }
}
ConvertTo-Json -Compress -Depth 4 @{ holders = @($rows); all = @($all) }
`;

function inspect(): { holders: PortHolder[]; table: Map<number, ProcessRow> } | null {
  if (process.platform !== 'win32') return null;
  try {
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', PS_QUERY],
      { encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 },
    ).trim();
    if (!out) return null;
    const parsed = JSON.parse(out) as {
      holders?: RawHolder[];
      all?: Array<{ Pid?: number; ParentPid?: number; StartMs?: number; IsOurs?: boolean }>;
    };
    const table = new Map<number, ProcessRow>();
    for (const row of parsed.all ?? []) {
      if (typeof row.Pid === 'number' && typeof row.StartMs === 'number') {
        table.set(row.Pid, {
          parentPid: typeof row.ParentPid === 'number' ? row.ParentPid : -1,
          startedMs: row.StartMs,
          isOurServer: row.IsOurs === true,
        });
      }
    }
    const holders: PortHolder[] = (parsed.holders ?? [])
      .filter((h): h is Required<Pick<RawHolder, 'Port' | 'Pid' | 'StartMs'>> & RawHolder =>
        typeof h.Port === 'number' && typeof h.Pid === 'number' && typeof h.StartMs === 'number')
      .map((h) => ({
        port: h.Port,
        pid: h.Pid,
        parentPid: typeof h.ParentPid === 'number' ? h.ParentPid : -1,
        startedMs: h.StartMs,
        commandLine: h.CommandLine ?? '',
      }));
    return { holders, table };
  } catch {
    return null;
  }
}

const observed = inspect();
if (!observed) {
  console.warn(
    `[e2e-preflight] could not inspect ports ${E2E_PORTS.join(', ')} on this platform — continuing.\n` +
      '  reuseExistingServer:false still makes silent adoption impossible; a held port will fail, just less legibly.',
  );
  process.exit(0);
}

const verdict = judgePorts(observed.holders, observed.table);
const message = explainVerdict(verdict, E2E_PORTS);

if (verdict.kind === 'live' || verdict.kind === 'foreign') {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (verdict.kind === 'orphan') {
  const survivors: number[] = [];
  for (const holder of verdict.holders) {
    try {
      execFileSync('taskkill', ['/PID', String(holder.pid), '/F', '/T'], { timeout: 15_000, stdio: 'ignore' });
    } catch {
      survivors.push(holder.pid);
    }
  }
  console.log(message);
  if (survivors.length > 0) {
    // Refuse rather than hand the run a port we failed to clear: proceeding here
    // is precisely the silent adoption this guard exists to prevent.
    console.error(
      `\n[e2e-preflight] REFUSING TO RUN — could not clear orphaned pid(s) ${survivors.join(', ')}.\n` +
        '  Stop them manually and re-run.\n',
    );
    process.exit(1);
  }
} else {
  console.log(message);
}
