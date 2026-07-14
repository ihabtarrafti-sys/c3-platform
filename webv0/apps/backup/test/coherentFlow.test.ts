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
