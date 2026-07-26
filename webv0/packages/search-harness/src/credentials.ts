import { createHash } from 'node:crypto';
import { HearthHarnessError } from './errors.js';
import {
  consumeDisposableSeedTargetAttestation,
  isTrustedDisposableSeedTargetAttestation,
  type DisposableSeedTargetAttestation,
} from './seederGuard.js';

export type CredentialSeparationFailureCode =
  | 'MEASURED_ADMIN_CREDENTIAL_PRESENT'
  | 'MEASURED_AUTH_URL_INVALID'
  | 'MEASURED_AUTH_URL_MISSING'
  | 'MEASURED_DATABASE_AUTH_CREDENTIAL_REUSED'
  | 'MEASURED_DATABASE_AUTH_SECRET_REUSED'
  | 'MEASURED_DATABASE_TARGET_MISMATCH'
  | 'MEASURED_DATABASE_URL_INVALID'
  | 'MEASURED_DATABASE_URL_MISSING'
  | 'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT'
  | 'MEASURED_NODE_ENV_NOT_PRODUCTION'
  | 'MEASURED_PG_FALLBACK_PRESENT'
  | 'MEASURED_RATE_LIMIT_DISABLED'
  | 'MEASURED_RATE_LIMIT_INVALID'
  | 'MEASURED_RATE_LIMIT_MISSING'
  | 'MEASURED_RATE_LIMIT_TOO_LOW'
  | 'MEASURED_SEED_CREDENTIAL_PRESENT'
  | 'SEED_ADMIN_URL_INVALID'
  | 'SEED_ADMIN_URL_MISSING'
  | 'SEED_CREDENTIAL_REUSED_BY_MEASURED_AUTH'
  | 'SEED_CREDENTIAL_REUSED_BY_MEASURED_DATABASE'
  | 'SEED_SECRET_REUSED_BY_MEASURED_AUTH'
  | 'SEED_SECRET_REUSED_BY_MEASURED_DATABASE'
  | 'SEED_TARGET_ATTESTATION_INVALID'
  | 'SEED_TARGET_MISMATCH';

export class CredentialSeparationError extends HearthHarnessError<CredentialSeparationFailureCode> {
  constructor(code: CredentialSeparationFailureCode, message: string) {
    super(code, message);
  }
}

export const HEARTH_SEARCH_MINIMUM_RATE_LIMIT_MAX = 100_000 as const;

export interface MeasuredProcessEnvironment {
  readonly [key: string]: string | undefined;
  readonly NODE_ENV: string | undefined;
  readonly RATE_LIMIT_MAX: string | undefined;
  readonly DATABASE_URL: string | undefined;
  readonly DATABASE_AUTH_URL: string | undefined;
  readonly DATABASE_ADMIN_URL?: string | undefined;
  readonly HEARTH_SEED_DATABASE_URL?: string | undefined;
  readonly PGDATABASE?: string | undefined;
  readonly PGHOST?: string | undefined;
  readonly PGHOSTADDR?: string | undefined;
  readonly PGPASSFILE?: string | undefined;
  readonly PGPASSWORD?: string | undefined;
  readonly PGPORT?: string | undefined;
  readonly PGSERVICE?: string | undefined;
  readonly PGSERVICEFILE?: string | undefined;
  readonly PGUSER?: string | undefined;
}

export interface SeedMeasuredCredentialInput {
  readonly seedAdminUrl: string | undefined;
  readonly seedTargetAttestation: DisposableSeedTargetAttestation;
  readonly measured: MeasuredProcessEnvironment;
}

export interface SeedMeasuredCredentialConfigurationInput {
  readonly seedAdminUrl: string | undefined;
  readonly measured: MeasuredProcessEnvironment;
}

export interface MeasuredCredentialAttestation {
  readonly nodeEnv: 'production';
  readonly rateLimitMax: number;
  readonly applicationRole: string;
  readonly authenticationRole: string;
  readonly applicationCredentialSha256: string;
  readonly authenticationCredentialSha256: string;
  readonly databaseTargetSha256: string;
}

const trustedMeasuredCredentialAttestations = new WeakSet<object>();

export function isTrustedMeasuredCredentialAttestation(
  attestation: MeasuredCredentialAttestation,
): boolean {
  return trustedMeasuredCredentialAttestations.has(attestation);
}

interface ParsedCredential {
  readonly role: string;
  readonly databaseName: string;
  readonly targetSha256: string;
  readonly secretSha256: string;
  readonly credentialSha256: string;
}

const PG_SASLPREP_NON_ASCII_SPACE =
  /[\u00A0\u1680\u2000-\u200B\u202F\u205F\u3000]/gu;
// RFC 3454 Table B.1, matching the checked-in node-postgres SCRAM client.
// eslint-disable-next-line no-misleading-character-class
const PG_SASLPREP_MAPPED_TO_NOTHING =
  /[\u00AD\u034F\u1806\u180B\u180C\u180D\u200C\u200D\u2060\uFE00-\uFE0F\uFEFF]/gu;

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

function canonicalPostgresSecret(secret: string): string {
  return secret
    .replace(PG_SASLPREP_NON_ASCII_SPACE, ' ')
    .replace(PG_SASLPREP_MAPPED_TO_NOTHING, '')
    .normalize('NFKC');
}

function isExtraDatabaseCredentialEntry(
  key: string,
  value: string | undefined,
): boolean {
  if (value === undefined) {
    return false;
  }
  const normalizedKey = key.toUpperCase();
  if (
    key === 'DATABASE_URL' ||
    key === 'DATABASE_AUTH_URL' ||
    key === 'DATABASE_ADMIN_URL' ||
    key === 'HEARTH_SEED_DATABASE_URL'
  ) {
    return false;
  }
  const keyTokens = normalizedKey.split('_');
  const namesPrivilegedDatabaseRole =
    keyTokens.includes('BACKUP') ||
    keyTokens.includes('SEED') ||
    keyTokens.includes('MIGRATION') ||
    keyTokens.includes('MIGRATE') ||
    keyTokens.includes('ADMIN') ||
    keyTokens.includes('OWNER') ||
    keyTokens.includes('SUPERUSER');
  const namesCredentialComponent =
    keyTokens.includes('URL') ||
    keyTokens.includes('URI') ||
    keyTokens.includes('DSN') ||
    keyTokens.includes('PASSWORD') ||
    keyTokens.includes('PASS') ||
    keyTokens.includes('SECRET') ||
    keyTokens.includes('USER') ||
    keyTokens.includes('USERNAME') ||
    keyTokens.includes('ROLE') ||
    keyTokens.includes('HOST') ||
    keyTokens.includes('HOSTADDR') ||
    keyTokens.includes('PORT') ||
    keyTokens.includes('SERVICE') ||
    keyTokens.includes('OPTIONS');
  return (
    normalizedKey.includes('DATABASE') ||
    normalizedKey.startsWith('POSTGRES') ||
    normalizedKey.startsWith('DB_') ||
    normalizedKey.includes('_DB_') ||
    normalizedKey.endsWith('_DB') ||
    (namesPrivilegedDatabaseRole && namesCredentialComponent) ||
    /^postgres(?:ql)?:\/\//iu.test(value.trim())
  );
}

function parseCredential(
  value: string,
  failureCode:
    | 'MEASURED_AUTH_URL_INVALID'
    | 'MEASURED_DATABASE_URL_INVALID'
    | 'SEED_ADMIN_URL_INVALID',
): ParsedCredential {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
      url.hostname.length === 0 ||
      url.hostname.includes('%') ||
      !url.pathname.startsWith('/') ||
      url.pathname.length <= 1 ||
      url.pathname.slice(1).includes('/') ||
      url.username.length === 0 ||
      url.password.length === 0
    ) {
      throw new Error('invalid PostgreSQL credential');
    }
    if ([...url.searchParams].length > 0) {
      throw new Error('PostgreSQL URL query parameters are forbidden');
    }
    const role = decodeURIComponent(url.username);
    const secret = decodeURIComponent(url.password);
    const canonicalSecret = canonicalPostgresSecret(secret);
    const encodedDatabaseName = url.pathname.slice(1);
    const databaseName = decodeURIComponent(encodedDatabaseName);
    if (
      role.trim().length === 0 ||
      role !== role.trim() ||
      secret.length === 0 ||
      canonicalSecret.length === 0 ||
      databaseName.length === 0 ||
      databaseName !== databaseName.trim() ||
      databaseName.includes('/') ||
      encodedDatabaseName.includes('%') ||
      encodedDatabaseName.includes('/')
    ) {
      throw new Error('missing role');
    }
    const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
    const port = url.port.length > 0 ? url.port : '5432';
    const targetIdentity = `${hostname}:${port}/${databaseName}`;
    const targetSha256 = createHash('sha256')
      .update(targetIdentity)
      .digest('hex');
    const secretSha256 = createHash('sha256')
      .update(canonicalSecret)
      .digest('hex');
    const credentialSha256 = createHash('sha256')
      .update(`${role}\0${canonicalSecret}\0${targetIdentity}`)
      .digest('hex');
    return {
      role,
      databaseName,
      targetSha256,
      secretSha256,
      credentialSha256,
    };
  } catch {
    throw new CredentialSeparationError(
      failureCode,
      'Database credential URL is invalid or lacks an explicit role',
    );
  }
}

function parseRateLimit(value: string | undefined): number {
  if (!present(value)) {
    throw new CredentialSeparationError(
      'MEASURED_RATE_LIMIT_MISSING',
      'Measured production process requires RATE_LIMIT_MAX',
    );
  }
  if (!/^\d+$/u.test(value)) {
    throw new CredentialSeparationError(
      'MEASURED_RATE_LIMIT_INVALID',
      'RATE_LIMIT_MAX must be a non-negative integer',
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new CredentialSeparationError(
      'MEASURED_RATE_LIMIT_INVALID',
      'RATE_LIMIT_MAX is outside the safe integer range',
    );
  }
  if (parsed === 0) {
    throw new CredentialSeparationError(
      'MEASURED_RATE_LIMIT_DISABLED',
      'Measured production process must use a high non-zero rate limit',
    );
  }
  if (parsed < HEARTH_SEARCH_MINIMUM_RATE_LIMIT_MAX) {
    throw new CredentialSeparationError(
      'MEASURED_RATE_LIMIT_TOO_LOW',
      `Measured production process requires RATE_LIMIT_MAX >= ${HEARTH_SEARCH_MINIMUM_RATE_LIMIT_MAX}`,
    );
  }
  return parsed;
}

/**
 * Enforces the acceptance-process environment from Neural amendment 1.
 */
export function assertMeasuredProcessEnvironment(
  environment: MeasuredProcessEnvironment,
): MeasuredCredentialAttestation {
  if (environment.NODE_ENV !== 'production') {
    throw new CredentialSeparationError(
      'MEASURED_NODE_ENV_NOT_PRODUCTION',
      'Measured API process must run with NODE_ENV=production',
    );
  }
  const rateLimitMax = parseRateLimit(environment.RATE_LIMIT_MAX);

  if (
    Object.entries(environment).some(
      ([key, value]) =>
        key.toUpperCase().startsWith('PG') && value !== undefined,
    )
  ) {
    throw new CredentialSeparationError(
      'MEASURED_PG_FALLBACK_PRESENT',
      'Measured process must not inherit PostgreSQL fallback environment variables',
    );
  }
  if (environment.DATABASE_ADMIN_URL !== undefined) {
    throw new CredentialSeparationError(
      'MEASURED_ADMIN_CREDENTIAL_PRESENT',
      'Measured API process must not receive DATABASE_ADMIN_URL',
    );
  }
  if (environment.HEARTH_SEED_DATABASE_URL !== undefined) {
    throw new CredentialSeparationError(
      'MEASURED_SEED_CREDENTIAL_PRESENT',
      'Measured API process must not inherit the seeder credential',
    );
  }
  if (
    Object.entries(environment).some(([key, value]) =>
      isExtraDatabaseCredentialEntry(key, value),
    )
  ) {
    throw new CredentialSeparationError(
      'MEASURED_EXTRA_DATABASE_CREDENTIAL_PRESENT',
      'Measured API process may receive only DATABASE_URL and DATABASE_AUTH_URL database credentials',
    );
  }
  if (!present(environment.DATABASE_URL)) {
    throw new CredentialSeparationError(
      'MEASURED_DATABASE_URL_MISSING',
      'Measured API process requires DATABASE_URL',
    );
  }
  if (!present(environment.DATABASE_AUTH_URL)) {
    throw new CredentialSeparationError(
      'MEASURED_AUTH_URL_MISSING',
      'Measured API process requires DATABASE_AUTH_URL',
    );
  }

  const application = parseCredential(
    environment.DATABASE_URL,
    'MEASURED_DATABASE_URL_INVALID',
  );
  const authentication = parseCredential(
    environment.DATABASE_AUTH_URL,
    'MEASURED_AUTH_URL_INVALID',
  );

  if (application.role === authentication.role) {
    throw new CredentialSeparationError(
      'MEASURED_DATABASE_AUTH_CREDENTIAL_REUSED',
      'Application and authentication connections must use distinct roles',
    );
  }
  if (application.secretSha256 === authentication.secretSha256) {
    throw new CredentialSeparationError(
      'MEASURED_DATABASE_AUTH_SECRET_REUSED',
      'Application and authentication connections must use distinct secrets',
    );
  }
  if (application.targetSha256 !== authentication.targetSha256) {
    throw new CredentialSeparationError(
      'MEASURED_DATABASE_TARGET_MISMATCH',
      'Application and authentication connections must target the same database',
    );
  }

  const attestation: MeasuredCredentialAttestation = Object.freeze({
    nodeEnv: 'production',
    rateLimitMax,
    applicationRole: application.role,
    authenticationRole: authentication.role,
    applicationCredentialSha256: application.credentialSha256,
    authenticationCredentialSha256: authentication.credentialSha256,
    databaseTargetSha256: application.targetSha256,
  });
  trustedMeasuredCredentialAttestations.add(attestation);
  return attestation;
}

/**
 * Validates the complete seed/measured credential configuration without
 * consuming a disposable-target grant. This is safe to run before the first
 * database or network event; it returns only the already-safe measured
 * attestation and never returns seed credentials.
 */
function validateSeedMeasuredCredentialConfiguration(
  input: SeedMeasuredCredentialConfigurationInput,
): {
  readonly seed: ParsedCredential;
  readonly measured: MeasuredCredentialAttestation;
} {
  if (!present(input.seedAdminUrl)) {
    throw new CredentialSeparationError(
      'SEED_ADMIN_URL_MISSING',
      'Seed process requires its disposable-database admin credential',
    );
  }

  const seed = parseCredential(input.seedAdminUrl, 'SEED_ADMIN_URL_INVALID');
  const measured = assertMeasuredProcessEnvironment(input.measured);

  if (
    seed.targetSha256 !== measured.databaseTargetSha256
  ) {
    throw new CredentialSeparationError(
      'SEED_TARGET_MISMATCH',
      'Seed and measured credentials must bind to the same disposable database',
    );
  }

  if (seed.role === measured.applicationRole) {
    throw new CredentialSeparationError(
      'SEED_CREDENTIAL_REUSED_BY_MEASURED_DATABASE',
      'Seed and measured application processes must use distinct roles',
    );
  }
  if (seed.role === measured.authenticationRole) {
    throw new CredentialSeparationError(
      'SEED_CREDENTIAL_REUSED_BY_MEASURED_AUTH',
      'Seed and measured authentication processes must use distinct roles',
    );
  }
  const application = parseCredential(
    input.measured.DATABASE_URL!,
    'MEASURED_DATABASE_URL_INVALID',
  );
  const authentication = parseCredential(
    input.measured.DATABASE_AUTH_URL!,
    'MEASURED_AUTH_URL_INVALID',
  );
  if (seed.secretSha256 === application.secretSha256) {
    throw new CredentialSeparationError(
      'SEED_SECRET_REUSED_BY_MEASURED_DATABASE',
      'Seed and measured application credentials must use distinct secrets',
    );
  }
  if (seed.secretSha256 === authentication.secretSha256) {
    throw new CredentialSeparationError(
      'SEED_SECRET_REUSED_BY_MEASURED_AUTH',
      'Seed and measured authentication credentials must use distinct secrets',
    );
  }
  return { seed, measured };
}

export function assertSeedMeasuredCredentialConfiguration(
  input: SeedMeasuredCredentialConfigurationInput,
): MeasuredCredentialAttestation {
  return validateSeedMeasuredCredentialConfiguration(input).measured;
}

/**
 * Proves the seed credential is present only in the exited seed process and is
 * distinct from both measured-process read credentials, then consumes the
 * one-shot H0 target grant as its final operation.
 */
export function assertSeedMeasuredCredentialSeparation(
  input: SeedMeasuredCredentialInput,
): MeasuredCredentialAttestation {
  if (
    !isTrustedDisposableSeedTargetAttestation(input.seedTargetAttestation)
  ) {
    throw new CredentialSeparationError(
      'SEED_TARGET_ATTESTATION_INVALID',
      'Seed target attestation must come from the disposable-target guard',
    );
  }
  const { seed, measured } =
    validateSeedMeasuredCredentialConfiguration(input);
  if (
    seed.targetSha256 !== input.seedTargetAttestation.targetIdentitySha256 ||
    seed.databaseName !== input.seedTargetAttestation.databaseName
  ) {
    throw new CredentialSeparationError(
      'SEED_TARGET_MISMATCH',
      'Seed and measured credentials must bind to the attested disposable database',
    );
  }
  if (!consumeDisposableSeedTargetAttestation(input.seedTargetAttestation)) {
    throw new CredentialSeparationError(
      'SEED_TARGET_ATTESTATION_INVALID',
      'Seed target attestation expired or was already consumed',
    );
  }

  return measured;
}
