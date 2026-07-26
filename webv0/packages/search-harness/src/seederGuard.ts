import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { HearthHarnessError } from './errors.js';

export const HEARTH_SEARCH_DATABASE_PREFIX = 'c3_hearth_search_';
export const HEARTH_SEARCH_SEED_ACK =
  'ACKNOWLEDGE_DESTRUCTIVE_C3_HEARTH_SEARCH_SEED';
export const HEARTH_SEARCH_OWNERSHIP_MARKER =
  'c3-hearth-search-harness-v1';
export const HEARTH_SEARCH_MAXIMUM_FRESH_AGE_MS = 10 * 60 * 1_000;
export const HEARTH_SEARCH_MAXIMUM_CLOCK_SKEW_MS = 5_000;
export const HEARTH_SEARCH_PROTECTED_ENDPOINT_LABELS = [
  'development-shared',
  'staging',
  'production',
] as const;

export type SeederGuardFailureCode =
  | 'SEED_ACK_REQUIRED'
  | 'SEED_DATABASE_ALREADY_POPULATED'
  | 'SEED_DATABASE_NOT_FRESH'
  | 'SEED_FRESHNESS_BOUND_INVALID'
  | 'SEED_MARKER_INVALID'
  | 'SEED_MARKER_MISSING'
  | 'SEED_MARKER_NOT_FRESH'
  | 'SEED_MARKER_RUN_MISMATCH'
  | 'SEED_PROTECTED_ENDPOINTS_INVALID'
  | 'SEED_RUN_ID_INVALID'
  | 'SEED_TARGET_DATABASE_MISSING'
  | 'SEED_TARGET_GRANT_ALREADY_ISSUED'
  | 'SEED_TARGET_NAME_NOT_RESERVED'
  | 'SEED_TARGET_PROTECTED_ENDPOINT'
  | 'SEED_TARGET_URL_INVALID';

export class SeederGuardError extends HearthHarnessError<SeederGuardFailureCode> {
  constructor(
    code: SeederGuardFailureCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(code, message, details);
  }
}

export interface ProtectedDatabaseEndpoint {
  readonly label: string;
  readonly url: string;
  /** SHA-256 of the independently inventoried PostgreSQL cluster identity. */
  readonly clusterIdentitySha256: string;
}

export interface SeederGuardPolicyInput {
  readonly protectedEndpoints: readonly ProtectedDatabaseEndpoint[];
  readonly maximumFreshAgeMs?: number;
  readonly maximumClockSkewMs?: number;
}

const trustedSeederGuardPolicies = new WeakSet<object>();
const trustedSeedTargetAttestations = new WeakMap<
  object,
  {
    readonly expiresAtMs: number;
    readonly expiresAtMonotonicMs: number;
    consumed: boolean;
    revoked: boolean;
  }
>();
const issuedSeedTargetGrantKeys = new Set<string>();
const SHA256_HEX = /^[a-f0-9]{64}$/u;

interface ProtectedEndpointIdentity {
  readonly label: string;
  readonly identity: string;
  readonly clusterIdentitySha256: string;
}

export interface SeederGuardPolicy {
  readonly protectedEndpoints: readonly ProtectedEndpointIdentity[];
  readonly clock: () => Date;
  readonly maximumFreshAgeMs: number;
  readonly maximumClockSkewMs: number;
}

export interface SeederOwnershipMarker {
  readonly markerKind: string;
  readonly runId: string;
  readonly createdAt: string;
}

export interface DisposableSeedTargetEvidence {
  readonly targetDatabaseUrl: string;
  readonly acknowledgement: string | undefined;
  readonly runId: string;
  readonly databaseCreatedAt: string;
  readonly existingSeedRecordCount: number;
  readonly ownershipMarker: SeederOwnershipMarker | null;
  /** Read from the target connection, not inferred from the URL hostname. */
  readonly observedClusterIdentitySha256: string;
}

export interface DisposableSeedTargetStaticEvidence {
  readonly targetDatabaseUrl: string;
  readonly acknowledgement: string | undefined;
  readonly runId: string;
}

export interface DisposableSeedTargetAttestation {
  readonly databaseName: string;
  readonly targetIdentitySha256: string;
  readonly clusterIdentitySha256: string;
  readonly runId: string;
  readonly checkedAt: string;
}

export function isTrustedDisposableSeedTargetAttestation(
  attestation: DisposableSeedTargetAttestation,
): boolean {
  const state = trustedSeedTargetAttestations.get(attestation);
  if (
    state !== undefined &&
    (Date.now() > state.expiresAtMs ||
      performance.now() > state.expiresAtMonotonicMs)
  ) {
    state.revoked = true;
  }
  return (
    state !== undefined &&
    !state.consumed &&
    !state.revoked
  );
}

export function consumeDisposableSeedTargetAttestation(
  attestation: DisposableSeedTargetAttestation,
): boolean {
  const state = trustedSeedTargetAttestations.get(attestation);
  if (
    state === undefined ||
    state.consumed ||
    state.revoked ||
    Date.now() > state.expiresAtMs ||
    performance.now() > state.expiresAtMonotonicMs
  ) {
    if (state !== undefined) state.revoked = true;
    return false;
  }
  state.consumed = true;
  return true;
}

function parsePostgresUrl(
  value: string,
  code: SeederGuardFailureCode,
): URL {
  try {
    const url = new URL(value);
    if (
      (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') ||
      url.hostname.length === 0 ||
      url.hostname.includes('%')
    ) {
      throw new Error('not a PostgreSQL URL');
    }
    if ([...url.searchParams].length > 0) {
      throw new Error('PostgreSQL URL query parameters are forbidden');
    }
    return url;
  } catch {
    throw new SeederGuardError(code, 'Seeder target is not a valid PostgreSQL URL');
  }
}

function effectivePort(url: URL): string {
  return url.port.length > 0 ? url.port : '5432';
}

function endpointIdentity(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '');
  return `${hostname}:${effectivePort(url)}`;
}

export function createSeederGuardPolicy(
  input: SeederGuardPolicyInput,
): SeederGuardPolicy {
  const requiredLabels = new Set<string>(
    HEARTH_SEARCH_PROTECTED_ENDPOINT_LABELS,
  );
  const labels = new Set<string>();
  const identities = new Set<string>();
  const protectedEndpoints: ProtectedEndpointIdentity[] = [];
  for (const endpoint of input.protectedEndpoints) {
    if (
      !requiredLabels.has(endpoint.label) ||
      labels.has(endpoint.label)
    ) {
      throw new SeederGuardError(
        'SEED_PROTECTED_ENDPOINTS_INVALID',
        'Protected database inventory has an unknown or duplicate label',
      );
    }
    const url = parsePostgresUrl(
      endpoint.url,
      'SEED_PROTECTED_ENDPOINTS_INVALID',
    );
    const identity = endpointIdentity(url);
    if (!SHA256_HEX.test(endpoint.clusterIdentitySha256)) {
      throw new SeederGuardError(
        'SEED_PROTECTED_ENDPOINTS_INVALID',
        'Protected database inventory has an invalid cluster identity',
      );
    }
    if (identities.has(identity)) {
      throw new SeederGuardError(
        'SEED_PROTECTED_ENDPOINTS_INVALID',
        'Protected database inventory contains a duplicate endpoint identity',
      );
    }
    labels.add(endpoint.label);
    identities.add(identity);
    protectedEndpoints.push(
      Object.freeze({
        label: endpoint.label,
        identity,
        clusterIdentitySha256: endpoint.clusterIdentitySha256,
      }),
    );
  }
  if (
    labels.size !== requiredLabels.size ||
    [...requiredLabels].some((label) => !labels.has(label))
  ) {
    throw new SeederGuardError(
      'SEED_PROTECTED_ENDPOINTS_INVALID',
      'Protected database inventory must contain development-shared, staging, and production',
    );
  }
  const maximumFreshAgeMs =
    input.maximumFreshAgeMs ?? HEARTH_SEARCH_MAXIMUM_FRESH_AGE_MS;
  const maximumClockSkewMs =
    input.maximumClockSkewMs ?? HEARTH_SEARCH_MAXIMUM_CLOCK_SKEW_MS;
  if (
    !Number.isSafeInteger(maximumFreshAgeMs) ||
    maximumFreshAgeMs <= 0 ||
    maximumFreshAgeMs > HEARTH_SEARCH_MAXIMUM_FRESH_AGE_MS ||
    !Number.isSafeInteger(maximumClockSkewMs) ||
    maximumClockSkewMs < 0 ||
    maximumClockSkewMs > HEARTH_SEARCH_MAXIMUM_CLOCK_SKEW_MS
  ) {
    throw new SeederGuardError(
      'SEED_FRESHNESS_BOUND_INVALID',
      'Seeder freshness bounds may only narrow the hard 10-minute/5-second maxima',
    );
  }

  const policy: SeederGuardPolicy = Object.freeze({
    protectedEndpoints: Object.freeze(protectedEndpoints),
    clock: () => new Date(),
    maximumFreshAgeMs,
    maximumClockSkewMs,
  });
  trustedSeederGuardPolicies.add(policy);
  return policy;
}

function databaseName(url: URL): string {
  if (
    !url.pathname.startsWith('/') ||
    url.pathname.length <= 1 ||
    url.pathname.slice(1).includes('/')
  ) {
    throw new SeederGuardError(
      'SEED_TARGET_DATABASE_MISSING',
      'Seeder target must name exactly one database',
    );
  }
  const encoded = url.pathname.slice(1);
  try {
    if (encoded.includes('%')) {
      throw new Error('encoded database names are forbidden');
    }
    const decoded = decodeURIComponent(encoded);
    if (
      decoded.length === 0 ||
      decoded.includes('/') ||
      decoded !== decoded.trim()
    ) {
      throw new Error('invalid database name');
    }
    return decoded;
  } catch {
    throw new SeederGuardError(
      'SEED_TARGET_DATABASE_MISSING',
      'Seeder target database name is malformed',
    );
  }
}

function parseTimestamp(
  value: string,
  code: 'SEED_DATABASE_NOT_FRESH' | 'SEED_MARKER_NOT_FRESH',
): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new SeederGuardError(code, 'Freshness evidence has an invalid timestamp');
  }
  return parsed;
}

function assertFresh(
  value: string,
  nowMs: number,
  maximumFreshAgeMs: number,
  maximumClockSkewMs: number,
  code: 'SEED_DATABASE_NOT_FRESH' | 'SEED_MARKER_NOT_FRESH',
): number {
  const createdAt = parseTimestamp(value, code);
  const age = nowMs - createdAt;
  if (age < -maximumClockSkewMs || age > maximumFreshAgeMs) {
    throw new SeederGuardError(code, 'Freshness evidence is outside the allowed window', {
      maximumFreshAgeMs,
    });
  }
  return createdAt;
}

/**
 * Runs every target check that does not require a live database observation.
 * Callers use this before their first connection attempt; the full guard still
 * repeats these checks when issuing the one-shot H0 grant.
 */
export function assertDisposableSeedTargetStatic(
  evidence: DisposableSeedTargetStaticEvidence,
  policy: SeederGuardPolicy,
): void {
  const target = parsePostgresUrl(
    evidence.targetDatabaseUrl,
    'SEED_TARGET_URL_INVALID',
  );
  if (!trustedSeederGuardPolicies.has(policy)) {
    throw new SeederGuardError(
      'SEED_PROTECTED_ENDPOINTS_INVALID',
      'Seeder guard policy was not created by the trusted policy factory',
    );
  }
  const targetEndpoint = endpointIdentity(target);
  const protectedEndpoint = policy.protectedEndpoints.find(
    ({ identity }) => identity === targetEndpoint,
  );
  if (protectedEndpoint !== undefined) {
    throw new SeederGuardError(
      'SEED_TARGET_PROTECTED_ENDPOINT',
      'Seeder target resolves to a protected database endpoint',
      { protectedEndpoint: protectedEndpoint.label },
    );
  }
  const targetDatabaseName = databaseName(target);
  if (!targetDatabaseName.startsWith(HEARTH_SEARCH_DATABASE_PREFIX)) {
    throw new SeederGuardError(
      'SEED_TARGET_NAME_NOT_RESERVED',
      `Seeder database name must use the ${HEARTH_SEARCH_DATABASE_PREFIX} prefix`,
    );
  }
  if (evidence.acknowledgement !== HEARTH_SEARCH_SEED_ACK) {
    throw new SeederGuardError(
      'SEED_ACK_REQUIRED',
      'Explicit destructive-seed acknowledgement is required',
    );
  }
  if (
    evidence.runId.length === 0 ||
    evidence.runId !== evidence.runId.trim()
  ) {
    throw new SeederGuardError(
      'SEED_RUN_ID_INVALID',
      'Seeder run ID must be non-blank and trimmed',
    );
  }
}

/**
 * Fails closed unless a target is a fresh, empty, same-run-owned disposable DB.
 *
 * This function consumes evidence already read from the database boundary. It
 * performs no I/O and never returns or reports target credentials.
 */
export function assertDisposableSeedTarget(
  evidence: DisposableSeedTargetEvidence,
  policy: SeederGuardPolicy,
): DisposableSeedTargetAttestation {
  const target = parsePostgresUrl(
    evidence.targetDatabaseUrl,
    'SEED_TARGET_URL_INVALID',
  );
  const targetEndpoint = endpointIdentity(target);

  if (!trustedSeederGuardPolicies.has(policy)) {
    throw new SeederGuardError(
      'SEED_PROTECTED_ENDPOINTS_INVALID',
      'Seeder guard policy was not created by the trusted policy factory',
    );
  }
  if (!SHA256_HEX.test(evidence.observedClusterIdentitySha256)) {
    throw new SeederGuardError(
      'SEED_TARGET_URL_INVALID',
      'Seeder target cluster identity is missing or malformed',
    );
  }
  for (const protectedEndpoint of policy.protectedEndpoints) {
    if (
      protectedEndpoint.identity === targetEndpoint ||
      protectedEndpoint.clusterIdentitySha256 ===
        evidence.observedClusterIdentitySha256
    ) {
      throw new SeederGuardError(
        'SEED_TARGET_PROTECTED_ENDPOINT',
        'Seeder target resolves to a protected database endpoint',
        { protectedEndpoint: protectedEndpoint.label },
      );
    }
  }

  const targetDatabaseName = databaseName(target);
  if (!targetDatabaseName.startsWith(HEARTH_SEARCH_DATABASE_PREFIX)) {
    throw new SeederGuardError(
      'SEED_TARGET_NAME_NOT_RESERVED',
      `Seeder database name must use the ${HEARTH_SEARCH_DATABASE_PREFIX} prefix`,
    );
  }

  if (evidence.acknowledgement !== HEARTH_SEARCH_SEED_ACK) {
    throw new SeederGuardError(
      'SEED_ACK_REQUIRED',
      'Explicit destructive-seed acknowledgement is required',
    );
  }
  if (
    evidence.runId.length === 0 ||
    evidence.runId !== evidence.runId.trim()
  ) {
    throw new SeederGuardError(
      'SEED_RUN_ID_INVALID',
      'Seeder run ID must be non-blank and trimmed',
    );
  }

  const now = policy.clock();
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) {
    throw new SeederGuardError(
      'SEED_DATABASE_NOT_FRESH',
      'Seeder guard clock is invalid',
    );
  }
  const { maximumFreshAgeMs, maximumClockSkewMs } = policy;

  const databaseCreatedAtMs = assertFresh(
    evidence.databaseCreatedAt,
    nowMs,
    maximumFreshAgeMs,
    maximumClockSkewMs,
    'SEED_DATABASE_NOT_FRESH',
  );

  if (
    !Number.isSafeInteger(evidence.existingSeedRecordCount) ||
    evidence.existingSeedRecordCount !== 0
  ) {
    throw new SeederGuardError(
      'SEED_DATABASE_ALREADY_POPULATED',
      'Seeder target already contains harness seed records',
    );
  }

  const marker = evidence.ownershipMarker;
  if (marker === null) {
    throw new SeederGuardError(
      'SEED_MARKER_MISSING',
      'Same-run harness ownership marker is missing',
    );
  }
  if (marker.markerKind !== HEARTH_SEARCH_OWNERSHIP_MARKER) {
    throw new SeederGuardError(
      'SEED_MARKER_INVALID',
      'Harness ownership marker is not recognized',
    );
  }
  if (
    marker.runId.length === 0 ||
    marker.runId !== marker.runId.trim()
  ) {
    throw new SeederGuardError(
      'SEED_RUN_ID_INVALID',
      'Ownership-marker run ID must be non-blank and trimmed',
    );
  }
  if (marker.runId !== evidence.runId) {
    throw new SeederGuardError(
      'SEED_MARKER_RUN_MISMATCH',
      'Harness ownership marker belongs to a different run',
    );
  }
  const markerCreatedAtMs = assertFresh(
    marker.createdAt,
    nowMs,
    maximumFreshAgeMs,
    maximumClockSkewMs,
    'SEED_MARKER_NOT_FRESH',
  );

  const targetIdentitySha256 = createHash('sha256')
    .update(`${targetEndpoint}/${targetDatabaseName}`)
    .digest('hex');
  const grantKey = createHash('sha256')
    .update(
      [
        evidence.observedClusterIdentitySha256,
        targetDatabaseName,
        evidence.runId,
        String(databaseCreatedAtMs),
        String(markerCreatedAtMs),
      ].join('\0'),
    )
    .digest('hex');
  if (issuedSeedTargetGrantKeys.has(grantKey)) {
    throw new SeederGuardError(
      'SEED_TARGET_GRANT_ALREADY_ISSUED',
      'Disposable seed target grant was already issued for this run and marker',
    );
  }

  const attestation: DisposableSeedTargetAttestation = Object.freeze({
    databaseName: targetDatabaseName,
    targetIdentitySha256,
    clusterIdentitySha256: evidence.observedClusterIdentitySha256,
    runId: evidence.runId,
    checkedAt: now.toISOString(),
  });
  issuedSeedTargetGrantKeys.add(grantKey);
  const expiresAtMs =
    Math.min(databaseCreatedAtMs, markerCreatedAtMs) +
    maximumFreshAgeMs;
  const remainingLifetimeMs = Math.max(0, expiresAtMs - nowMs);
  trustedSeedTargetAttestations.set(attestation, {
    expiresAtMs,
    expiresAtMonotonicMs: performance.now() + remainingLifetimeMs,
    consumed: false,
    revoked: false,
  });
  return attestation;
}
