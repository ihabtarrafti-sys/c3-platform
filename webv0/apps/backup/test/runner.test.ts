import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { runBackup, type BackupDeps } from '../src/runner';
import type { BackupEnv } from '../src/env';

const BASE_SIGNING_KEY = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const env: BackupEnv = {
  databaseUrl: 'postgresql://c3_backup:pw@postgres.railway.internal:5432/railway',
  r2Endpoint: 'https://acct.r2.cloudflarestorage.com',
  r2Bucket: 'c3-web-v0-staging-backups',
  r2AccessKeyId: 'AKID',
  r2SecretAccessKey: 'SECRET-VALUE-SHOULD-NOT-LOG',
  ageRecipient: 'age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p',
  sourceCommit: 'd133f0f',
  mode: 'daily',
  environmentLabel: 'staging',
  // Signed is the norm now (M-14: a backup is refused unsigned unless allowed).
  signingKeyPem: BASE_SIGNING_KEY,
  allowUnsigned: false,
};
const unsignedEnv: BackupEnv = { ...env, signingKeyPem: null, allowUnsigned: true };

interface Recorder {
  uploads: string[];
  bodies: Record<string, string>;
  removed: string[];
  cleaned: string[];
  released: number;
  logs: Array<{ event: string; fields?: Record<string, unknown> }>;
}

// R3-N06: the coherent census — the full blob list (3 documents + 1 photo). inventoryOf()
// derives INVENTORY from it (first-per-class sample), and the archive must cover EVERY key.
const CENSUS_BLOBS = [
  { storageKey: 'tid/doc-obj', sha256: 'd'.repeat(64), cls: 'document' as const },
  { storageKey: 'tid/doc-obj-2', sha256: 'd'.repeat(64), cls: 'document' as const },
  { storageKey: 'tid/doc-obj-3', sha256: 'd'.repeat(64), cls: 'document' as const },
  { storageKey: 'tid/photo-obj', sha256: 'e'.repeat(64), cls: 'photo' as const },
];
const INVENTORY = {
  document: { count: 3, sample: { storageKey: 'tid/doc-obj', sha256: 'd'.repeat(64) } },
  photo: { count: 1, sample: { storageKey: 'tid/photo-obj', sha256: 'e'.repeat(64) } },
  intake: { count: 0, sample: null },
};

function makeDeps(over: Partial<BackupDeps> = {}, when = new Date('2026-07-07T02:15:00Z')): { deps: BackupDeps; rec: Recorder } {
  const rec: Recorder = { uploads: [], bodies: {}, removed: [], cleaned: [], released: 0, logs: [] };
  const deps: BackupDeps = {
    now: () => when,
    serverVersion: async () => '18.4',
    migrations: async () => ['0001_schema.sql', '0006_backup_role_grants.sql'],
    pgDumpVersion: async () => 'pg_dump (PostgreSQL) 18.4',
    // R3-N06: the dump and the blob census from ONE coherent snapshot.
    coherentDumpAndCensus: async () => ({ bytes: 4096, blobs: CENSUS_BLOBS }),
    // Capture EXACTLY the census (fail-closed on any missing key upstream), so count+key
    // coverage passes.
    snapshotBlobs: async (_p: string, blobs) => ({ entries: blobs }),
    acquireLock: async () => true,
    releaseLock: async () => {
      rec.released++;
    },
    makeTempDir: async () => '/tmp/c3bkp-xyz',
    cleanupTempDir: async (d) => {
      rec.cleaned.push(d);
    },
    sha256File: async (p) => (p.endsWith('.age') ? 'e'.repeat(64) : 'p'.repeat(64)),
    fileSize: async () => 2048,
    encrypt: async () => {},
    removeFile: async (p) => {
      rec.removed.push(p);
    },
    uploadFile: async (k) => {
      rec.uploads.push(k);
    },
    uploadBytes: async (k, body) => {
      rec.uploads.push(k);
      rec.bodies[k] = body;
    },
    verifyObject: async () => {},
    readBytes: async (k) => {
      const v = rec.bodies[k];
      if (v === undefined) throw new Error(`readBytes: missing key ${k}`);
      return v;
    },
    log: (event, fields) => {
      rec.logs.push({ event, fields });
    },
    ...over,
  };
  return { deps, rec };
}

describe('runBackup orchestration', () => {
  it('completes the happy path and writes latest-success LAST', async () => {
    const { deps, rec } = makeDeps();
    const res = await runBackup(env, deps);
    expect(res.primaryKey).toBe('daily/2026/07/07/c3-staging-20260707T021500Z-d133f0f.dump.age');
    // plaintext removed before upload; cleanup + release happened.
    expect(rec.removed).toContain('/tmp/c3bkp-xyz/dump.pgc');
    expect(rec.cleaned).toContain('/tmp/c3bkp-xyz');
    expect(rec.released).toBe(1);
    // latest-success is the FINAL upload.
    expect(rec.uploads.at(-1)).toBe('status/latest-success.json');
    // encrypted object + manifest uploaded before the status marker.
    expect(rec.uploads).toContain('daily/2026/07/07/c3-staging-20260707T021500Z-d133f0f.dump.age');
  });

  it('H-08 Option A: builds + uploads an INDEPENDENT encrypted blob archive, recorded in the manifest', async () => {
    const { deps, rec } = makeDeps();
    await runBackup(env, deps);
    const archiveKey = rec.uploads.find((k) => k.endsWith('.blobs.age'));
    expect(archiveKey, 'an independent .blobs.age archive is uploaded').toBeTruthy();
    const manifestKey = rec.uploads.find((k) => k.endsWith('.manifest.json'))!;
    const manifest = JSON.parse(rec.bodies[manifestKey]!);
    expect(manifest.blobArchive.key).toBe(archiveKey);
    expect(manifest.blobArchive.entryCount).toBe(4);
    // the archive indexes EVERY census object (R3-N06: full index, not one-per-class).
    expect(manifest.blobArchive.entries).toHaveLength(4);
    expect([...new Set(manifest.blobArchive.entries.map((e: { cls: string }) => e.cls))].sort()).toEqual(['document', 'photo']);
    // the archive is uploaded BEFORE latest-success (which stays last).
    expect(rec.uploads.at(-1)).toBe('status/latest-success.json');
  });

  it('R3-N06 count+key coverage: census has objects but the archive captured fewer → REFUSED, no latest-success', async () => {
    const { deps, rec } = makeDeps({ snapshotBlobs: async () => ({ entries: [] }) });
    await expect(runBackup(env, deps)).rejects.toThrow(/coverage mismatch/i);
    expect(rec.uploads).not.toContain('status/latest-success.json');
    expect(rec.uploads.some((k) => k.endsWith('.blobs.age'))).toBe(false);
  });

  it('R3-N06 (the drill): archive covers every CLASS but MISSES one document key → REFUSED — the old class-presence check would have signed it', async () => {
    // 2 documents + the photo — every class still represented (document≥1, photo≥1), so
    // the previous one-per-class check passes silently; count+key coverage catches the
    // dropped key (a between-reads delete injected at the BackupDeps seam).
    const partial = [CENSUS_BLOBS[0]!, CENSUS_BLOBS[1]!, CENSUS_BLOBS[3]!];
    const { deps, rec } = makeDeps({ snapshotBlobs: async () => ({ entries: partial }) });
    await expect(runBackup(env, deps)).rejects.toThrow(/coverage mismatch|MISSING census/i);
    expect(rec.uploads).not.toContain('status/latest-success.json');
  });

  it('H-08: a zero-blob tenant uploads NO archive and records blobArchive: null', async () => {
    const { deps, rec } = makeDeps({ coherentDumpAndCensus: async () => ({ bytes: 4096, blobs: [] }) });
    await runBackup(env, deps);
    expect(rec.uploads.some((k) => k.endsWith('.blobs.age'))).toBe(false);
    const manifestKey = rec.uploads.find((k) => k.endsWith('.manifest.json'))!;
    expect(JSON.parse(rec.bodies[manifestKey]!).blobArchive).toBeNull();
  });

  it('H-08: records the blob inventory in the manifest (recoverability checklist)', async () => {
    const { deps, rec } = makeDeps();
    await runBackup(env, deps);
    const manifestKey = rec.uploads.find((k) => k.endsWith('.manifest.json'))!;
    const manifest = JSON.parse(rec.bodies[manifestKey]!);
    expect(manifest.blobInventory).toEqual(INVENTORY);
    // the per-class counts are also logged for observability.
    expect(rec.logs.some((l) => l.event === 'backup.blob_inventory' && l.fields?.document === 3)).toBe(true);
  });

  it('on a Sunday uploads to both daily/ and weekly/', async () => {
    const { deps, rec } = makeDeps({}, new Date('2026-07-05T02:15:00Z')); // Sunday
    await runBackup(env, deps);
    expect(rec.uploads.some((k) => k.startsWith('daily/'))).toBe(true);
    expect(rec.uploads.some((k) => k.startsWith('weekly/'))).toBe(true);
  });

  it('rejects an empty dump and never uploads or writes latest-success', async () => {
    const { deps, rec } = makeDeps({ coherentDumpAndCensus: async () => ({ bytes: 0, blobs: [] }) });
    await expect(runBackup(env, deps)).rejects.toThrow(/empty dump/);
    expect(rec.uploads).toHaveLength(0);
    expect(rec.cleaned).toContain('/tmp/c3bkp-xyz'); // still cleaned up
    expect(rec.released).toBe(1);
  });

  it('aborts (no latest-success) when encryption fails', async () => {
    const { deps, rec } = makeDeps({ encrypt: async () => { throw new Error('age failed'); } });
    await expect(runBackup(env, deps)).rejects.toThrow(/age failed/);
    expect(rec.uploads).not.toContain('status/latest-success.json');
  });

  it('aborts (no latest-success) when upload fails', async () => {
    const { deps, rec } = makeDeps({ uploadFile: async () => { throw new Error('R2 5xx'); } });
    await expect(runBackup(env, deps)).rejects.toThrow(/R2 5xx/);
    expect(rec.uploads).not.toContain('status/latest-success.json');
  });

  it('aborts (no latest-success) when verification fails', async () => {
    const { deps, rec } = makeDeps({ verifyObject: async () => { throw new Error('sha mismatch'); } });
    await expect(runBackup(env, deps)).rejects.toThrow(/sha mismatch/);
    expect(rec.uploads).not.toContain('status/latest-success.json');
  });

  it('does not run when the advisory lock is held (overlap prevention)', async () => {
    const { deps, rec } = makeDeps({ acquireLock: async () => false });
    await expect(runBackup(env, deps)).rejects.toThrow(/already running/i);
    expect(rec.uploads).toHaveLength(0);
    // never entered the try body, so temp dir was never created/cleaned.
    expect(rec.cleaned).toHaveLength(0);
  });

  it('never logs the R2 secret', async () => {
    const { deps, rec } = makeDeps();
    await runBackup(env, deps);
    const all = JSON.stringify(rec.logs);
    expect(all).not.toContain('SECRET-VALUE-SHOULD-NOT-LOG');
    expect(all).not.toContain(env.r2SecretAccessKey);
  });

  it('HARDEN-2 H-02: with a signing key, a .sig rides beside every manifest copy (and never leaks)', async () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    const signed: BackupEnv = { ...env, signingKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
    const { deps, rec } = makeDeps({}, new Date('2026-07-05T02:15:00Z')); // Sunday → daily + weekly
    await runBackup(signed, deps);
    const sigs = rec.uploads.filter((k) => k.endsWith('.manifest.json.sig'));
    const manifests = rec.uploads.filter((k) => k.endsWith('.manifest.json'));
    expect(sigs).toHaveLength(manifests.length);
    expect(sigs.length).toBeGreaterThanOrEqual(2); // daily + weekly copies
    expect(JSON.stringify(rec.logs)).not.toContain('BEGIN PRIVATE KEY'); // the key never logs
    // an explicitly-unsigned (legacy) run uploads no .sig at all
    const { deps: d2, rec: r2 } = makeDeps();
    await runBackup(unsignedEnv, d2);
    expect(r2.uploads.some((k) => k.endsWith('.sig'))).toBe(false);
  });

  it('H-09: each retention copy gets its OWN signed manifest naming ITS OWN object', async () => {
    const { deps, rec } = makeDeps({}, new Date('2026-07-05T02:15:00Z')); // Sunday → daily + weekly
    await runBackup(env, deps);
    const manifestKeys = rec.uploads.filter((k) => k.endsWith('.manifest.json'));
    expect(manifestKeys.length).toBe(2); // daily + weekly
    for (const mk of manifestKeys) {
      const m = JSON.parse(rec.bodies[mk]!);
      // the manifest's objectKey is the SAME prefix as the manifest it rides beside
      // (weekly manifest → weekly object; not the daily object).
      expect(mk).toBe(`${m.objectKey}.manifest.json`);
      expect(m.objectKey.startsWith(mk.startsWith('weekly/') ? 'weekly/' : 'daily/')).toBe(true);
    }
  });

  it('M-14: an unsigned backup does NOT write latest-success (the tile stays stale)', async () => {
    const { deps, rec } = makeDeps();
    await runBackup(unsignedEnv, deps);
    expect(rec.uploads).not.toContain('status/latest-success.json');
    expect(rec.logs.some((l) => l.event === 'backup.latest_success_skipped')).toBe(true);
    // the objects + manifests were still uploaded — just no green marker.
    expect(rec.uploads.some((k) => k.endsWith('.dump.age'))).toBe(true);
  });

  it('M-14: with NO signing key AND no legacy flag, the backup is REFUSED', async () => {
    const { deps, rec } = makeDeps();
    const noKeyNoFlag: BackupEnv = { ...env, signingKeyPem: null, allowUnsigned: false };
    await expect(runBackup(noKeyNoFlag, deps)).rejects.toThrow(/UNSIGNED/i);
    expect(rec.uploads).not.toContain('status/latest-success.json');
  });

  it('R2-N07: a TAMPERED manifest sidecar fails the run before latest-success', async () => {
    const { deps, rec } = makeDeps();
    // The store hands back manifest bytes that differ from what was signed.
    deps.readBytes = async (k) => (k.endsWith('.manifest.json') ? '{"objectKey":"x","tampered":true}' : rec.bodies[k]!);
    await expect(runBackup(env, deps)).rejects.toThrow(/readback/i);
    expect(rec.uploads).not.toContain('status/latest-success.json');
  });

  it('R2-N07: a MISSING signature sidecar fails the run before latest-success', async () => {
    const { deps, rec } = makeDeps();
    deps.readBytes = async (k) => {
      if (k.endsWith('.manifest.json.sig')) throw new Error('NoSuchKey');
      return rec.bodies[k]!;
    };
    await expect(runBackup(env, deps)).rejects.toThrow();
    expect(rec.uploads).not.toContain('status/latest-success.json');
  });

  it('R2-N07: a signature that does not verify on readback fails the run', async () => {
    const { deps, rec } = makeDeps();
    // Valid base64 but not a real signature over the manifest → verify=false.
    deps.readBytes = async (k) => (k.endsWith('.manifest.json.sig') ? Buffer.from('not-a-real-signature').toString('base64') : rec.bodies[k]!);
    await expect(runBackup(env, deps)).rejects.toThrow(/verification/i);
    expect(rec.uploads).not.toContain('status/latest-success.json');
  });

  it('R4-N04: the WEEKLY copy is self-contained — its manifest names a WEEKLY-prefixed blob archive that survives daily expiry', async () => {
    const { deps, rec } = makeDeps({}, new Date('2026-07-05T02:15:00Z')); // Sunday → daily + weekly
    await runBackup(env, deps);

    // The weekly manifest names a weekly-prefixed dump AND a weekly-prefixed blob archive.
    const weeklyManifestKey = rec.uploads.find((k) => k.startsWith('weekly/') && k.endsWith('.manifest.json'))!;
    const weekly = JSON.parse(rec.bodies[weeklyManifestKey]!);
    expect(weekly.objectKey.startsWith('weekly/')).toBe(true);
    expect(weekly.blobArchive.key.startsWith('weekly/')).toBe(true); // RED on the daily-bound archive
    // each retention copy owns a distinct blob archive under its own prefix.
    const archiveKeys = rec.uploads.filter((k) => k.endsWith('.blobs.age'));
    expect(archiveKeys).toHaveLength(2);
    expect(archiveKeys.some((k) => k.startsWith('weekly/'))).toBe(true);
    expect(archiveKeys.some((k) => k.startsWith('daily/'))).toBe(true);

    // Simulate R2 lifecycle expiring EVERY daily/ object (15d) while weekly/ is retained (90d).
    const survivors = new Set(rec.uploads.filter((k) => !k.startsWith('daily/')));
    // The weekly copy's dump, manifest, and blob archive must ALL still be present.
    expect(survivors.has(weekly.objectKey)).toBe(true);
    expect(survivors.has(weeklyManifestKey)).toBe(true);
    expect(survivors.has(weekly.blobArchive.key)).toBe(true); // the crux: recoverable without any daily object
  });

  it('un-stub coverage: an archive with the right KEYS but a wrong sha (or class) is REFUSED', async () => {
    // Same keys as the census, but one object reports a different sha → incoherent archive.
    const wrongSha = makeDeps({
      snapshotBlobs: async (_p, blobs) => ({ entries: blobs.map((b, i) => (i === 0 ? { ...b, sha256: 'f'.repeat(64) } : b)) }),
    });
    await expect(runBackup(env, wrongSha.deps)).rejects.toThrow(/sha mismatch/i);
    expect(wrongSha.rec.uploads).not.toContain('status/latest-success.json');

    const wrongCls = makeDeps({
      snapshotBlobs: async (_p, blobs) => ({ entries: blobs.map((b, i) => (i === 0 ? { ...b, cls: 'photo' as const } : b)) }),
    });
    await expect(runBackup(env, wrongCls.deps)).rejects.toThrow(/class mismatch/i);
    expect(wrongCls.rec.uploads).not.toContain('status/latest-success.json');
  });
});
