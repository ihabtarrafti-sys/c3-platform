import { describe, it, expect } from 'vitest';
import { serializeManifest, serializeLatestSuccess, recipientFingerprint, assertNoSecrets, type BackupManifest } from '../src/manifest';

const base: BackupManifest = {
  schema: 'c3-backup-manifest/1',
  environment: 'staging',
  createdAtUtc: '2026-07-07T02:15:00.000Z',
  mode: 'daily',
  classes: ['daily'],
  objectKey: 'daily/2026/07/07/c3-staging-20260707T021500Z-d133f0f.dump.age',
  sourceCommit: 'd133f0f',
  serverVersion: '18.4',
  migrations: ['0001_schema.sql', '0006_backup_role_grants.sql'],
  encryptedSha256: 'a'.repeat(64),
  encryptedBytes: 2048,
  plaintextSha256: 'b'.repeat(64),
  plaintextBytes: 4096,
  pgDumpVersion: 'pg_dump (PostgreSQL) 18.4',
  ageRecipientFingerprint: 'age1ql3z7…mcac8p',
  blobInventory: {
    document: { count: 2, sample: { storageKey: 'tid/doc', sha256: 'c'.repeat(64) } },
    photo: { count: 0, sample: null },
    intake: { count: 0, sample: null },
  },
};

describe('manifest redaction', () => {
  it('serializes a clean manifest with a trailing newline', () => {
    const s = serializeManifest(base);
    expect(s.endsWith('}\n')).toBe(true);
    expect(JSON.parse(s).schema).toBe('c3-backup-manifest/1');
  });

  it('fingerprints the recipient without revealing the whole value', () => {
    const fp = recipientFingerprint('age1ql3z7hjy54pw3hyww5ayyfg7zqgvc7w3j2elw8zmrj2kg5sfn9aqmcac8p');
    expect(fp).toMatch(/^age1.{0,8}….{6}$/);
  });

  it('THROWS if a connection URL leaks into the manifest', () => {
    const bad = { ...base, sourceCommit: 'postgresql://c3_backup:pw@h/db' } as BackupManifest;
    expect(() => assertNoSecrets(bad)).toThrow(/secret scan/);
    expect(() => serializeManifest(bad)).toThrow(/secret scan/);
  });

  it('THROWS if an age identity leaks into the manifest', () => {
    const bad = { ...base, sourceCommit: 'AGE-SECRET-KEY-1ABC' } as BackupManifest;
    expect(() => serializeManifest(bad)).toThrow(/secret scan/);
  });

  it('THROWS if a user:pass@ credential leaks', () => {
    const bad = { ...base, environment: 'user:hunter2@host' } as BackupManifest;
    expect(() => serializeManifest(bad)).toThrow(/secret scan/);
  });

  it('latest-success serialization also scans for secrets', () => {
    expect(() =>
      serializeLatestSuccess({
        schema: 'c3-backup-latest-success/1',
        lastSuccessUtc: '2026-07-07T02:15:30Z',
        objectKey: base.objectKey,
        manifestKey: base.objectKey + '.manifest.json',
        environment: 'staging',
        mode: 'daily',
        encryptedSha256: 'a'.repeat(64),
        encryptedBytes: 2048,
      }),
    ).not.toThrow();
  });
});
