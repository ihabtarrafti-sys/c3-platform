/**
 * manifest.ts — integrity/provenance metadata for a backup object.
 *
 * The manifest travels beside the encrypted dump. It contains ONLY non-secret
 * provenance + integrity fields — never a connection URL, credential, role
 * password, or the encryption key. `assertNoSecrets` is a belt-and-braces
 * scan run before any manifest is serialized/uploaded.
 */

/** H-08: one blob class's population + a representative object for the drill. */
export interface BlobInventoryClass {
  readonly count: number;
  /**
   * A representative object (by ordered key) the restore drill fetches + hash-
   * checks to prove the class is recoverable. Null when the class is empty.
   */
  readonly sample: { readonly storageKey: string; readonly sha256: string } | null;
}

/**
 * H-08: the authoritative census of the object store the pg_dump does NOT carry
 * (documents, photos, intake quarantine). Recorded in the SIGNED manifest so the
 * restore drill knows exactly which objects must be recoverable and their hashes.
 */
export interface BlobInventory {
  readonly document: BlobInventoryClass;
  readonly photo: BlobInventoryClass;
  readonly intake: BlobInventoryClass;
}

export interface BackupManifest {
  readonly schema: 'c3-backup-manifest/1';
  readonly environment: string;
  readonly createdAtUtc: string;
  readonly mode: 'daily' | 'manual';
  readonly classes: string[];
  readonly objectKey: string;
  readonly sourceCommit: string;
  readonly serverVersion: string;
  readonly migrations: string[];
  /** SHA-256 of the ENCRYPTED artifact (what R2 stores). */
  readonly encryptedSha256: string;
  readonly encryptedBytes: number;
  /** SHA-256 of the PLAINTEXT dump (computed before encryption, for restore). */
  readonly plaintextSha256: string;
  readonly plaintextBytes: number;
  readonly pgDumpVersion: string;
  readonly ageRecipientFingerprint: string;
  /** H-08: the object-store census the dump does not carry (recoverability checklist). */
  readonly blobInventory: BlobInventory;
}

/** Non-secret fingerprint of the recipient (first/last chars) for cross-check. */
export function recipientFingerprint(recipient: string): string {
  if (recipient.length < 16) return 'age1?';
  return `${recipient.slice(0, 10)}…${recipient.slice(-6)}`;
}

const SECRET_PATTERNS: RegExp[] = [
  /postgres(ql)?:\/\//i, // connection URL
  /AGE-SECRET-KEY-/, // age identity
  /:[^@\s/]+@/, // user:pass@ credential
  /R2_SECRET/i,
  /aws_secret/i,
];

/** Throw if a would-be manifest (serialized) contains any secret-looking value. */
export function assertNoSecrets(manifest: BackupManifest): void {
  const json = JSON.stringify(manifest);
  for (const re of SECRET_PATTERNS) {
    if (re.test(json)) {
      throw new Error(`Manifest failed secret scan (matched ${re}).`);
    }
  }
}

export function serializeManifest(manifest: BackupManifest): string {
  assertNoSecrets(manifest);
  return JSON.stringify(manifest, null, 2) + '\n';
}

export interface LatestSuccess {
  readonly schema: 'c3-backup-latest-success/1';
  readonly lastSuccessUtc: string;
  readonly objectKey: string;
  readonly manifestKey: string;
  readonly environment: string;
  readonly mode: string;
  readonly encryptedSha256: string;
  readonly encryptedBytes: number;
}

export function serializeLatestSuccess(s: LatestSuccess): string {
  const json = JSON.stringify(s);
  for (const re of SECRET_PATTERNS) {
    if (re.test(json)) throw new Error(`latest-success failed secret scan (matched ${re}).`);
  }
  return JSON.stringify(s, null, 2) + '\n';
}
