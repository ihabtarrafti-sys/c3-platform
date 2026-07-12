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
    blobInventory: async () => INVENTORY,
    acquireLock: async () => true,
    releaseLock: async () => {
      rec.released++;
    },
    makeTempDir: async () => '/tmp/c3bkp-xyz',
    cleanupTempDir: async (d) => {
      rec.cleaned.push(d);
    },
    dump: async () => ({ bytes: 4096 }),
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
    const { deps, rec } = makeDeps({ dump: async () => ({ bytes: 0 }) });
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
});
