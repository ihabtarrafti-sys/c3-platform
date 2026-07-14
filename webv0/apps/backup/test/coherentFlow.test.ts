/**
 * coherentFlow.test — the dump+census coherence orchestration (R3-N06 un-stub) and the
 * pg_dump lock-wait retry (R4-N09). These make the previously-untestable adapter logic
 * provable: dropping the snapshot thread, the hold-until-dump ordering, or --snapshot /
 * --lock-wait-timeout now fails a test.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  coherentDumpAndCensusFlow,
  pgDumpArgs,
  isPgLockTimeout,
  runWithLockWaitRetry,
  resolveCensusPause,
  type CoherentIo,
} from '../src/coherentFlow';
import type { BlobArchiveEntry } from '../src/manifest';

const CENSUS: BlobArchiveEntry[] = [{ storageKey: 'tid/doc', sha256: 'd'.repeat(64), cls: 'document' }];

/** A recorder io that logs the call order and threads a known snapshot id. */
function recorderIo(over: Partial<CoherentIo> = {}): { io: CoherentIo; calls: string[]; dumpSnapshot: { id: string | null } } {
  const calls: string[] = [];
  const dumpSnapshot = { id: null as string | null };
  const io: CoherentIo = {
    begin: async () => { calls.push('begin'); },
    exportSnapshot: async () => { calls.push('exportSnapshot'); return 'SNAP-123'; },
    enumerate: async () => { calls.push('enumerate'); return CENSUS; },
    runDump: async (snapshotId) => { calls.push('runDump'); dumpSnapshot.id = snapshotId; },
    commit: async () => { calls.push('commit'); },
    rollback: async () => { calls.push('rollback'); },
    dumpBytes: async () => { calls.push('dumpBytes'); return 4096; },
    ...over,
  };
  return { io, calls, dumpSnapshot };
}

describe('coherentDumpAndCensusFlow — ordering + snapshot threading (R3-N06 un-stub)', () => {
  it('exports the snapshot, enumerates in-tx, dumps ON that snapshot, then commits AFTER the dump', async () => {
    const { io, calls, dumpSnapshot } = recorderIo();
    const res = await coherentDumpAndCensusFlow(io);
    expect(res).toEqual({ bytes: 4096, blobs: CENSUS });
    // The order is load-bearing: enumerate BEFORE the dump, commit AFTER the dump.
    expect(calls).toEqual(['begin', 'exportSnapshot', 'enumerate', 'runDump', 'commit', 'dumpBytes']);
    // The exported snapshot id is threaded into pg_dump (dropping this => census/dump divergence).
    expect(dumpSnapshot.id).toBe('SNAP-123');
  });

  it('the census is enumerated while the snapshot tx is still OPEN (before commit)', async () => {
    const { io, calls } = recorderIo();
    await coherentDumpAndCensusFlow(io);
    expect(calls.indexOf('enumerate')).toBeGreaterThan(calls.indexOf('exportSnapshot'));
    expect(calls.indexOf('enumerate')).toBeLessThan(calls.indexOf('commit'));
    expect(calls.indexOf('runDump')).toBeLessThan(calls.indexOf('commit')); // dump finishes before the tx closes
  });

  it('rolls back (never commits) when the dump fails', async () => {
    const { io, calls } = recorderIo({ runDump: async () => { throw new Error('pg_dump exited 1'); } });
    await expect(coherentDumpAndCensusFlow(io)).rejects.toThrow(/pg_dump/);
    expect(calls).toContain('rollback');
    expect(calls).not.toContain('commit');
  });
});

// HARDEN-3.5 Batch E (R4-N09 ceremony): the drill's ONLY deterministic staging point is a pause
// between census and dump. It must be INERT unless explicitly armed, sit exactly inside the
// snapshot window when armed, and refuse loudly on a mistyped value (never a silently ambiguous
// paused-or-not backup).
describe('R4-N09 ceremony pause — env-gated, inert by default', () => {
  it('INERT: an unset/empty BACKUP_PAUSE_AFTER_CENSUS yields NO pause step at all', () => {
    expect(resolveCensusPause({} as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveCensusPause({ BACKUP_PAUSE_AFTER_CENSUS: '' } as NodeJS.ProcessEnv)).toBeNull();
    expect(resolveCensusPause({ BACKUP_PAUSE_AFTER_CENSUS: '   ' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('a mistyped value REFUSES the backup (loud, never ambiguous)', () => {
    for (const bad of ['0', '-5', '601', 'garbage', '2.5']) {
      expect(() => resolveCensusPause({ BACKUP_PAUSE_AFTER_CENSUS: bad } as NodeJS.ProcessEnv)).toThrow(/1\.\.600/);
    }
  });

  it('an armed pause waits the requested seconds and logs the drill-window line', async () => {
    const slept: number[] = [];
    const logged: string[] = [];
    const pause = resolveCensusPause(
      { BACKUP_PAUSE_AFTER_CENSUS: '7' } as NodeJS.ProcessEnv,
      async (ms) => { slept.push(ms); },
      (msg) => logged.push(msg),
    );
    expect(pause).toBeTypeOf('function');
    await pause!();
    expect(slept).toEqual([7000]);
    expect(logged.some((l) => l.includes('census_pause') && l.includes('drill window OPEN'))).toBe(true);
  });

  it('the armed pause sits EXACTLY inside the snapshot window: census before it, dump after it, commit last', async () => {
    const { io, calls, dumpSnapshot } = recorderIo();
    io.pauseBeforeDump = async () => { calls.push('pause'); };
    await coherentDumpAndCensusFlow(io);
    expect(calls).toEqual(['begin', 'exportSnapshot', 'enumerate', 'pause', 'runDump', 'commit', 'dumpBytes']);
    expect(dumpSnapshot.id).toBe('SNAP-123'); // the pause never detaches the snapshot threading
  });

  it('INERT flow ordering is byte-identical to the pre-hook flow (no pause step exists)', async () => {
    const { io, calls } = recorderIo(); // no pauseBeforeDump supplied
    await coherentDumpAndCensusFlow(io);
    expect(calls).toEqual(['begin', 'exportSnapshot', 'enumerate', 'runDump', 'commit', 'dumpBytes']);
  });
});

describe('pgDumpArgs (R4-N09 + snapshot binding)', () => {
  it('carries BOTH --snapshot=<id> and --lock-wait-timeout', () => {
    const args = pgDumpArgs('/tmp/dump.pgc', 'postgresql://u:p@h/db', 'SNAP-9');
    expect(args).toContain('--snapshot=SNAP-9'); // census/dump coherence
    expect(args.some((a) => a.startsWith('--lock-wait-timeout='))).toBe(true); // fail-fast, no hang
    expect(args).toContain('/tmp/dump.pgc');
  });
});

describe('runWithLockWaitRetry (R4-N09 bounded retry)', () => {
  const lockErr = () => new Error('pg_dump exited 1: canceling statement due to lock timeout');

  it('retries a lock-wait timeout and converges', async () => {
    const runOnce = vi.fn()
      .mockRejectedValueOnce(lockErr())
      .mockRejectedValueOnce(lockErr())
      .mockResolvedValueOnce(undefined);
    await expect(runWithLockWaitRetry(runOnce, { attempts: 3 })).resolves.toBeUndefined();
    expect(runOnce).toHaveBeenCalledTimes(3);
  });

  it('is BOUNDED — it gives up after `attempts` rather than hanging forever', async () => {
    const runOnce = vi.fn().mockRejectedValue(lockErr());
    await expect(runWithLockWaitRetry(runOnce, { attempts: 3 })).rejects.toThrow(/lock timeout/i);
    expect(runOnce).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a non-lock error (a real dump failure surfaces immediately)', async () => {
    const runOnce = vi.fn().mockRejectedValue(new Error('pg_dump exited 1: relation does not exist'));
    await expect(runWithLockWaitRetry(runOnce, { attempts: 3 })).rejects.toThrow(/relation does not exist/);
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it('classifies pg_dump lock-timeout messages', () => {
    expect(isPgLockTimeout(lockErr())).toBe(true);
    expect(isPgLockTimeout(new Error('could not obtain lock on relation'))).toBe(true);
    expect(isPgLockTimeout(new Error('syntax error'))).toBe(false);
  });
});
