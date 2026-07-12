/**
 * env.ts — fail-closed environment validation for the backup job.
 *
 * The backup job connects to PostgreSQL ONLY as the dedicated read-only
 * `c3_backup` identity. It must NEVER receive the admin/app/auth credentials.
 * These guards are defense-in-depth on top of the Railway variable scoping:
 * even if a wrong URL is injected, the job refuses to run.
 */

export interface BackupEnv {
  /** c3_backup read-only connection (private network). */
  readonly databaseUrl: string;
  /** R2 S3 endpoint, e.g. https://<accountid>.r2.cloudflarestorage.com */
  readonly r2Endpoint: string;
  readonly r2Bucket: string;
  /** Backup WRITER access key id (object read+write, this bucket only). */
  readonly r2AccessKeyId: string;
  readonly r2SecretAccessKey: string;
  /** age recipient (public) — e.g. age1... . NEVER a private identity. */
  readonly ageRecipient: string;
  /** Source commit short SHA (non-secret provenance). */
  readonly sourceCommit: string;
  /** 'daily' (default; Sundays also copied to weekly/) or 'manual'. */
  readonly mode: 'daily' | 'manual';
  readonly environmentLabel: string;
  /**
   * HARDEN-2 H-02: Ed25519 PRIVATE key (PKCS#8 PEM) that signs each manifest —
   * producer authenticity for the restore drill. Null = unsigned (legacy);
   * the restore side then demands its explicit override flag.
   */
  readonly signingKeyPem: string | null;
  /**
   * M-14: explicit legacy escape hatch. Without a signing key a backup is
   * REFUSED unless this is set; when set, the run proceeds unsigned but does NOT
   * update the latest-success status marker (the tile stays stale, by design).
   */
  readonly allowUnsigned: boolean;
}

/** Substrings that must never appear in the backup DB role name. */
const FORBIDDEN_ROLE_TOKENS = ['c3_app', 'c3_auth', 'c3_admin', 'postgres@', ':postgres@'];

function requiredRoleUser(url: string): string {
  let user: string;
  try {
    user = decodeURIComponent(new URL(url).username);
  } catch {
    throw new Error('DATABASE_URL is not a valid connection URL.');
  }
  if (!user) throw new Error('DATABASE_URL has no role/username.');
  return user;
}

/**
 * Reject any connection URL whose role is an admin/app/auth principal. The
 * backup job is only ever permitted to connect as c3_backup.
 */
export function assertBackupOnlyDatabaseUrl(url: string): void {
  const user = requiredRoleUser(url);
  if (user !== 'c3_backup') {
    throw new Error(`Refusing to run: DATABASE_URL role is '${user}', expected 'c3_backup'.`);
  }
  for (const tok of FORBIDDEN_ROLE_TOKENS) {
    if (url.includes(tok)) {
      throw new Error(`Refusing to run: DATABASE_URL contains a forbidden principal token ('${tok}').`);
    }
  }
  // An age RECIPIENT starts with age1; guard against pasting an identity secret
  // in the wrong slot elsewhere is handled in loadEnv.
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): BackupEnv {
  const get = (k: string): string => {
    const v = source[k];
    if (v === undefined || v === '') throw new Error(`Missing required environment variable: ${k}`);
    return v;
  };

  const databaseUrl = get('DATABASE_URL');
  assertBackupOnlyDatabaseUrl(databaseUrl);

  // Explicitly forbid admin/app/auth URLs even being PRESENT in the environment.
  for (const forbidden of ['DATABASE_ADMIN_URL', 'DATABASE_AUTH_URL']) {
    if (source[forbidden]) {
      throw new Error(`Refusing to run: ${forbidden} must not be present in the backup job environment.`);
    }
  }
  // The encryption PRIVATE key must never be in the backup job.
  for (const forbidden of ['AGE_IDENTITY', 'AGE_SECRET_KEY', 'BACKUP_AGE_IDENTITY']) {
    if (source[forbidden]) {
      throw new Error(`Refusing to run: ${forbidden} (a private key) must not be present in the backup job.`);
    }
  }

  const ageRecipient = get('AGE_RECIPIENT');
  if (!/^age1[0-9a-z]+$/.test(ageRecipient)) {
    throw new Error('AGE_RECIPIENT must be a public age recipient (age1...).');
  }
  if (ageRecipient.startsWith('AGE-SECRET-KEY-')) {
    throw new Error('AGE_RECIPIENT is a PRIVATE identity — only the public recipient may be configured.');
  }

  const modeRaw = source.BACKUP_MODE ?? 'daily';
  if (modeRaw !== 'daily' && modeRaw !== 'manual') {
    throw new Error(`BACKUP_MODE must be 'daily' or 'manual', got '${modeRaw}'.`);
  }

  // H-02: the signing key is Ed25519 PKCS#8 PEM when present; a value that is
  // clearly something else (an age key, a bare string) refuses loudly.
  const signingKeyPem = source.BACKUP_SIGNING_KEY ?? null;
  if (signingKeyPem !== null && !signingKeyPem.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error('BACKUP_SIGNING_KEY must be a PKCS#8 PEM private key (run `npm run keygen` in apps/backup).');
  }

  return {
    databaseUrl,
    r2Endpoint: get('R2_ENDPOINT'),
    r2Bucket: get('R2_BUCKET'),
    r2AccessKeyId: get('R2_ACCESS_KEY_ID'),
    r2SecretAccessKey: get('R2_SECRET_ACCESS_KEY'),
    ageRecipient,
    sourceCommit: source.SOURCE_COMMIT ?? 'unknown',
    mode: modeRaw,
    environmentLabel: source.ENVIRONMENT_LABEL ?? 'staging',
    signingKeyPem,
    allowUnsigned: source.BACKUP_ALLOW_UNSIGNED === 'yes',
  };
}
