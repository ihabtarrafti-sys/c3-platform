import {
  assertSeedMeasuredCredentialSeparation,
  isTrustedMeasuredCredentialAttestation,
  type MeasuredCredentialAttestation,
  type SeedMeasuredCredentialInput,
} from '../credentials.js';
import { isTrustedDisposableSeedTargetAttestation } from '../seederGuard.js';

/**
 * H1 deliberately does not wrap `embedded-postgres`.
 *
 * The library surface used elsewhere in the repository does not expose a
 * stable owned-child handle with which this harness could prove post-stop
 * process death. Pretending that `stop()` proved that stronger lifecycle would
 * recreate the silent-success class this harness exists to catch. H1 therefore
 * accepts only an already-owned external disposable target attested by H0.
 */
export const H1_DISPOSABLE_DATABASE_PROVIDER =
  'EXTERNAL_OWNED_DISPOSABLE_ONLY' as const;

export type H1DisposableDatabaseFailureCode =
  | 'H1_DISPOSABLE_CLIENT_CLOSE_FAILED'
  | 'H1_DISPOSABLE_CURRENT_DATABASE_INVALID'
  | 'H1_DISPOSABLE_TARGET_ALREADY_CONSUMED'
  | 'H1_DISPOSABLE_TARGET_FORGED'
  | 'H1_DISPOSABLE_TARGET_MISMATCH';

export class H1DisposableDatabaseError extends Error {
  constructor(
    readonly code: H1DisposableDatabaseFailureCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = 'H1DisposableDatabaseError';
  }
}

export interface H1SqlQueryResult {
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  readonly rowCount: number | null;
}

/**
 * Narrow node-postgres-compatible surface. The production connector may wrap
 * a `pg.Client`; tests can supply a pure in-memory recorder.
 */
export interface H1SqlClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<H1SqlQueryResult>;
  end(): Promise<void>;
}

export interface H1ExternalDisposableTargetInput {
  readonly credentials: SeedMeasuredCredentialInput;
  /**
   * Called only after the H0 target attestation and credential-separation
   * attestation have both succeeded and consumed the one-shot H0 grant.
   */
  readonly connect: (exactSeedAdminUrl: string) => Promise<H1SqlClient>;
}

export interface H1PreparedExternalDisposableTarget {
  readonly provider: typeof H1_DISPOSABLE_DATABASE_PROVIDER;
  readonly databaseName: string;
  readonly targetIdentitySha256: string;
  readonly runId: string;
}

export interface H1ConnectedDisposableSeedTarget {
  readonly client: H1SqlClient;
  readonly databaseName: string;
  readonly targetIdentitySha256: string;
  readonly runId: string;
  readonly measuredCredentials: MeasuredCredentialAttestation;
}

interface PreparedTargetState {
  readonly credentials: SeedMeasuredCredentialInput;
  readonly connect: (exactSeedAdminUrl: string) => Promise<H1SqlClient>;
  consumed: boolean;
}

const preparedTargets = new WeakMap<
  H1PreparedExternalDisposableTarget,
  PreparedTargetState
>();

function preparedState(
  target: H1PreparedExternalDisposableTarget,
): PreparedTargetState {
  const state = preparedTargets.get(target);
  if (state === undefined) {
    throw new H1DisposableDatabaseError(
      'H1_DISPOSABLE_TARGET_FORGED',
      'Disposable seed target was not prepared by the H1 external adapter',
    );
  }
  if (state.consumed) {
    throw new H1DisposableDatabaseError(
      'H1_DISPOSABLE_TARGET_ALREADY_CONSUMED',
      'Disposable seed target is one-shot and was already consumed',
    );
  }
  return state;
}

/**
 * Captures an external target without connecting or consuming its H0 grant.
 *
 * This is intentionally side-effect free so authority and corpus preflight
 * failures leave the disposable-target attestation usable and record zero
 * attempted database events.
 */
export function prepareExternalOwnedDisposableTarget(
  input: H1ExternalDisposableTargetInput,
): H1PreparedExternalDisposableTarget {
  if (
    !isTrustedDisposableSeedTargetAttestation(
      input.credentials.seedTargetAttestation,
    )
  ) {
    throw new H1DisposableDatabaseError(
      'H1_DISPOSABLE_TARGET_FORGED',
      'H0 disposable-target attestation is missing, expired, or consumed',
    );
  }

  const attestation = input.credentials.seedTargetAttestation;
  const prepared = Object.freeze({
    provider: H1_DISPOSABLE_DATABASE_PROVIDER,
    databaseName: attestation.databaseName,
    targetIdentitySha256: attestation.targetIdentitySha256,
    runId: attestation.runId,
  });
  preparedTargets.set(prepared, {
    credentials: input.credentials,
    connect: input.connect,
    consumed: false,
  });
  return prepared;
}

/**
 * Read-only readiness check used during the seeder's complete pre-side-effect
 * validation pass. It neither consumes the attestation nor opens a socket.
 */
export function assertExternalDisposableTargetReady(
  target: H1PreparedExternalDisposableTarget,
): void {
  const state = preparedState(target);
  if (
    !isTrustedDisposableSeedTargetAttestation(
      state.credentials.seedTargetAttestation,
    )
  ) {
    throw new H1DisposableDatabaseError(
      'H1_DISPOSABLE_TARGET_ALREADY_CONSUMED',
      'H0 disposable-target attestation expired or was consumed elsewhere',
    );
  }
}

function currentDatabaseName(result: H1SqlQueryResult): string {
  if (result.rows.length !== 1) {
    throw new H1DisposableDatabaseError(
      'H1_DISPOSABLE_CURRENT_DATABASE_INVALID',
      'current_database() did not return exactly one row',
    );
  }
  const value = result.rows[0]?.['database_name'];
  if (typeof value !== 'string' || value.length === 0) {
    throw new H1DisposableDatabaseError(
      'H1_DISPOSABLE_CURRENT_DATABASE_INVALID',
      'current_database() returned an invalid database name',
    );
  }
  return value;
}

/**
 * Consumes the trusted H0 attestation immediately before the first DB event,
 * then connects using the exact seed URL whose credential separation was
 * attested. No connection URL or secret is copied into the returned object.
 */
export async function consumeAndConnectExternalDisposableTarget(
  target: H1PreparedExternalDisposableTarget,
  beforeConnect?: () => void,
): Promise<H1ConnectedDisposableSeedTarget> {
  const state = preparedState(target);
  const { credentials } = state;
  if (
    !isTrustedDisposableSeedTargetAttestation(
      credentials.seedTargetAttestation,
    )
  ) {
    throw new H1DisposableDatabaseError(
      'H1_DISPOSABLE_TARGET_ALREADY_CONSUMED',
      'H0 disposable-target attestation expired or was consumed elsewhere',
    );
  }

  /*
   * This call performs all credential checks first and consumes the H0 grant as
   * its final operation. A failure therefore happens before `connect`.
   */
  const measuredCredentials =
    assertSeedMeasuredCredentialSeparation(credentials);
  if (!isTrustedMeasuredCredentialAttestation(measuredCredentials)) {
    throw new H1DisposableDatabaseError(
      'H1_DISPOSABLE_TARGET_FORGED',
      'Measured credential attestation did not come from the H0 factory',
    );
  }
  state.consumed = true;

  let client: H1SqlClient | undefined;
  try {
    beforeConnect?.();
    client = await state.connect(credentials.seedAdminUrl!);
    const observed = currentDatabaseName(
      await client.query(
        'SELECT current_database()::text AS database_name',
      ),
    );
    if (observed !== target.databaseName) {
      throw new H1DisposableDatabaseError(
        'H1_DISPOSABLE_TARGET_MISMATCH',
        'Connected database does not match the attested disposable target',
      );
    }
    return Object.freeze({
      client,
      databaseName: target.databaseName,
      targetIdentitySha256: target.targetIdentitySha256,
      runId: target.runId,
      measuredCredentials,
    });
  } catch (error) {
    if (client !== undefined) {
      await client.end().catch(() => undefined);
    }
    throw error;
  }
}

export async function closeDisposableSeedConnection(
  connected: H1ConnectedDisposableSeedTarget,
): Promise<void> {
  try {
    await connected.client.end();
  } catch {
    throw new H1DisposableDatabaseError(
      'H1_DISPOSABLE_CLIENT_CLOSE_FAILED',
      'Seed-admin database connection did not close cleanly',
    );
  }
}
