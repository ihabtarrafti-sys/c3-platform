import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  assertMarkerMatchesManifest,
  signManifestBytes,
  signatureKeyFor,
  validateLatestSuccess,
  validateManifest,
  verifyManifestBytes,
} from '../src/signing';
import { serializeManifest, type BackupManifest } from '../src/manifest';

function keypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    priv: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

const manifest: BackupManifest = {
  schema: 'c3-backup-manifest/1',
  environment: 'staging',
  createdAtUtc: '2026-07-11T02:15:00.000Z',
  mode: 'daily',
  classes: ['daily'],
  objectKey: 'daily/2026/07/c3-staging-20260711.dump.age',
  sourceCommit: 'abc1234',
  serverVersion: 'PostgreSQL 18.0',
  migrations: ['0001_schema.sql'],
  encryptedSha256: 'a'.repeat(64),
  encryptedBytes: 1024,
  plaintextSha256: 'b'.repeat(64),
  plaintextBytes: 4096,
  pgDumpVersion: 'pg_dump 18.0',
  ageRecipientFingerprint: 'age1abcdefg…xyzuvw',
};

describe('H-02: manifest signing (producer authenticity, not just confidentiality)', () => {
  it('a signature made with the producer key verifies over the exact bytes', () => {
    const { priv, pub } = keypair();
    const body = serializeManifest(manifest);
    const sig = signManifestBytes(body, priv);
    expect(verifyManifestBytes(body, sig, pub)).toBe(true);
  });

  it('ONE flipped byte in the manifest, a garbled signature, or the WRONG key all refuse', () => {
    const { priv, pub } = keypair();
    const other = keypair();
    const body = serializeManifest(manifest);
    const sig = signManifestBytes(body, priv);

    const tampered = body.replace('"encryptedBytes": 1024', '"encryptedBytes": 1025');
    expect(tampered).not.toBe(body); // the tamper actually landed
    expect(verifyManifestBytes(tampered, sig, pub)).toBe(false);
    expect(verifyManifestBytes(body, 'AAAA' + sig.slice(4), pub)).toBe(false);
    expect(verifyManifestBytes(body, sig, other.pub)).toBe(false);
    expect(verifyManifestBytes(body, '', pub)).toBe(false);
  });

  it('a malformed verify key is an OPERATOR error (loud), never a quiet false', () => {
    const body = serializeManifest(manifest);
    expect(() => verifyManifestBytes(body, 'AAAA', 'not a pem')).toThrow();
    // an RSA key is the wrong ALGORITHM — refused by name, not accepted quietly
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const rsaPub = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(() => verifyManifestBytes(body, 'AAAA', rsaPub)).toThrow(/Ed25519/);
  });

  it('the signature object rides beside the manifest', () => {
    expect(signatureKeyFor('daily/2026/07/x.dump.age.manifest.json')).toBe('daily/2026/07/x.dump.age.manifest.json.sig');
  });
});

describe('H-02: restore-side schema validation (never JSON.parse-and-trust)', () => {
  const latest = {
    schema: 'c3-backup-latest-success/1',
    lastSuccessUtc: '2026-07-11T02:20:00.000Z',
    objectKey: manifest.objectKey,
    manifestKey: `${manifest.objectKey}.manifest.json`,
    environment: 'staging',
    mode: 'daily',
    encryptedSha256: manifest.encryptedSha256,
    encryptedBytes: manifest.encryptedBytes,
  };

  it('valid documents pass and are typed', () => {
    expect(validateLatestSuccess(latest).objectKey).toBe(manifest.objectKey);
    expect(validateManifest(JSON.parse(serializeManifest(manifest))).plaintextBytes).toBe(4096);
  });

  it('wrong schema tag, missing fields, and non-hex hashes are refused by name', () => {
    expect(() => validateLatestSuccess({ ...latest, schema: 'evil/9' })).toThrow(/schema/);
    expect(() => validateLatestSuccess({ ...latest, encryptedSha256: 'ZZ' })).toThrow(/encryptedSha256/);
    expect(() => validateManifest({ schema: 'c3-backup-manifest/1' })).toThrow(/failed schema validation/);
    expect(() => validateManifest({ ...JSON.parse(serializeManifest(manifest)), encryptedBytes: -1 })).toThrow(/encryptedBytes/);
  });

  it('marker/manifest disagreement is refused — the pointer routes, the SIGNED manifest is the authority', () => {
    const m = validateManifest(JSON.parse(serializeManifest(manifest)));
    expect(() => assertMarkerMatchesManifest(validateLatestSuccess(latest), m)).not.toThrow();
    expect(() =>
      assertMarkerMatchesManifest(validateLatestSuccess({ ...latest, encryptedSha256: 'c'.repeat(64) }), m),
    ).toThrow(/disagree on encryptedSha256/);
    expect(() =>
      assertMarkerMatchesManifest(validateLatestSuccess({ ...latest, objectKey: 'daily/other.dump.age' }), m),
    ).toThrow(/disagree on objectKey/);
  });
});
