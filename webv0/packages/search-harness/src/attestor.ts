import { HearthHarnessError } from './errors.js';
import { z } from 'zod';
import {
  isTrustedMeasuredCredentialAttestation,
  type MeasuredCredentialAttestation,
} from './credentials.js';

export type DatabaseBoundaryFailureCode =
  | 'ATTEST_ADMIN_CREDENTIAL'
  | 'ATTEST_APPLICATION_DIRECTORY_GRANTS_MISMATCH'
  | 'ATTEST_AUTH_DIRECTORY_GRANTS_MISMATCH'
  | 'ATTEST_BYPASSRLS'
  | 'ATTEST_BYPASS_ROLE_MEMBERSHIP'
  | 'ATTEST_CREDENTIAL_MISMATCH'
  | 'ATTEST_DATABASE_TARGET_MISMATCH'
  | 'ATTEST_EVIDENCE_INVALID'
  | 'ATTEST_EXPECTATION_INVALID'
  | 'ATTEST_OWNER_MEMBERSHIP'
  | 'ATTEST_POOL_CADENCE_MISMATCH'
  | 'ATTEST_READ_WRITE_TRANSACTION'
  | 'ATTEST_RELATION_SET_MISMATCH'
  | 'ATTEST_RELATION_OWNER'
  | 'ATTEST_RLS_DISABLED'
  | 'ATTEST_ROW_SECURITY_OFF'
  | 'ATTEST_SESSION_ROLE_MISMATCH'
  | 'ATTEST_SUPERUSER'
  | 'ATTEST_TENANT_GUC_MISMATCH'
  | 'ATTEST_TENANT_GUC_MISSING'
  | 'ATTEST_TENANT_ID_INVALID'
  | 'ATTEST_USER_GUC_MISMATCH'
  | 'ATTEST_USER_GUC_MISSING'
  | 'ATTEST_USER_GUC_UNEXPECTED'
  | 'ATTEST_WRITE_PRIVILEGE';

export class DatabaseBoundaryAttestationError extends HearthHarnessError<DatabaseBoundaryFailureCode> {
  constructor(
    code: DatabaseBoundaryFailureCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(code, message, details);
  }
}

export type DatabaseWritePrivilege =
  | 'DELETE'
  | 'INSERT'
  | 'REFERENCES'
  | 'TRIGGER'
  | 'TRUNCATE'
  | 'UPDATE';

export interface SearchedRelationAttestation {
  readonly relationName: string;
  readonly rlsEnabled: boolean;
  readonly ownedByCurrentRole: boolean;
  /** Effective privileges, including role inheritance and PUBLIC grants. */
  readonly writePrivileges: readonly DatabaseWritePrivilege[];
}

export const SEARCHED_RELATION_NAMES = [
  'person',
  'mission',
  'agreement',
  'entity',
  'credential',
  'journey',
  'kit',
  'apparel',
  'approval',
  'team',
  'invoice',
  'claim',
  'distribution',
  'document',
  'agreement_term',
  'mission_line',
  'beneficiary',
] as const;

export interface PoolConnectionAttestation {
  readonly connectionId: string;
  readonly currentRole: string | null;
  readonly sessionRole: string | null;
  readonly credentialSha256: string | null;
  readonly databaseTargetSha256: string | null;
}

export const AUTHENTICATION_DIRECTORY_RELATION_NAMES = [
  'tenant',
  'app_user',
  'tenant_membership',
  'role_assignment',
  'external_identity',
] as const;

export interface RoleRelationPrivilegeAttestation {
  readonly relationName: string;
  /**
   * Complete effective-privilege inventory for the closed authentication
   * directory relation set, including inherited/PUBLIC grants and returned by
   * fixed attestation SQL. The
   * application role must produce no rows; the authentication role must
   * produce exactly the five SELECT-only rows.
   */
  readonly privileges: readonly string[];
}

export interface DatabaseRoleSecurityAttestation {
  readonly role: string | null;
  readonly usesAdminCredential: boolean;
  readonly isSuperuser: boolean;
  readonly bypassRls: boolean;
  readonly ownerRoleMembershipCount: number;
  readonly bypassRoleMembershipCount: number;
  readonly relationPrivileges: readonly RoleRelationPrivilegeAttestation[];
}

export interface DatabaseBoundaryExpectationInput {
  readonly measuredCredentials: MeasuredCredentialAttestation;
  readonly applicationPoolConnectionCount: number;
  readonly authenticationPoolConnectionCount: number;
  readonly actorTenantId: string;
  readonly actorUserId: string | null;
}

export interface DatabaseBoundaryExpectation
  extends Omit<DatabaseBoundaryExpectationInput, 'measuredCredentials'> {
  readonly applicationRole: string;
  readonly authenticationRole: string;
  readonly applicationCredentialSha256: string;
  readonly authenticationCredentialSha256: string;
  readonly databaseTargetSha256: string;
}

export interface DatabaseBoundarySnapshot {
  readonly currentRole: string | null;
  readonly sessionRole: string | null;
  readonly currentCredentialSha256: string | null;
  readonly databaseTargetSha256: string | null;
  readonly applicationPoolConnections: readonly PoolConnectionAttestation[];
  readonly authenticationPoolConnections: readonly PoolConnectionAttestation[];
  readonly applicationRoleSecurity: DatabaseRoleSecurityAttestation;
  readonly authenticationRoleSecurity: DatabaseRoleSecurityAttestation;
  readonly rowSecuritySetting: 'off' | 'on' | null;
  readonly transactionReadOnly: boolean;
  readonly tenantGuc: string | null;
  readonly userGuc: string | null;
  readonly searchedRelations: readonly SearchedRelationAttestation[];
}

export interface DatabaseBoundaryAttestation {
  readonly role: string;
  readonly tenantId: string;
  readonly userContext: 'bound' | 'null-deny';
  readonly searchedRelationCount: number;
  readonly applicationPoolConnectionCount: number;
  readonly authenticationPoolConnectionCount: number;
}

const SHA256_HEX = /^[a-f0-9]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const trustedDatabaseBoundaryExpectations = new WeakSet<object>();

const poolConnectionAttestationSchema = z
  .object({
    connectionId: z.string(),
    currentRole: z.string().nullable(),
    sessionRole: z.string().nullable(),
    credentialSha256: z.string().nullable(),
    databaseTargetSha256: z.string().nullable(),
  })
  .strict();

const roleSecurityAttestationSchema = z
  .object({
    role: z.string().nullable(),
    usesAdminCredential: z.boolean(),
    isSuperuser: z.boolean(),
    bypassRls: z.boolean(),
    ownerRoleMembershipCount: z.number().int(),
    bypassRoleMembershipCount: z.number().int(),
    relationPrivileges: z.array(
      z
        .object({
          relationName: z.string(),
          privileges: z.array(z.string()),
        })
        .strict(),
    ),
  })
  .strict();

const databaseBoundarySnapshotSchema = z
  .object({
    currentRole: z.string().nullable(),
    sessionRole: z.string().nullable(),
    currentCredentialSha256: z.string().nullable(),
    databaseTargetSha256: z.string().nullable(),
    applicationPoolConnections: z.array(poolConnectionAttestationSchema),
    authenticationPoolConnections: z.array(poolConnectionAttestationSchema),
    applicationRoleSecurity: roleSecurityAttestationSchema,
    authenticationRoleSecurity: roleSecurityAttestationSchema,
    rowSecuritySetting: z.enum(['off', 'on']).nullable(),
    transactionReadOnly: z.boolean(),
    tenantGuc: z.string().nullable(),
    userGuc: z.string().nullable(),
    searchedRelations: z.array(
      z
        .object({
          relationName: z.string(),
          rlsEnabled: z.boolean(),
          ownedByCurrentRole: z.boolean(),
          writePrivileges: z.array(
            z.enum([
              'DELETE',
              'INSERT',
              'REFERENCES',
              'TRIGGER',
              'TRUNCATE',
              'UPDATE',
            ]),
          ),
        })
        .strict(),
    ),
  })
  .strict();

function validFingerprint(value: string | null): value is string {
  return value !== null && SHA256_HEX.test(value);
}

export function createDatabaseBoundaryExpectation(
  input: DatabaseBoundaryExpectationInput,
): DatabaseBoundaryExpectation {
  if (!isTrustedMeasuredCredentialAttestation(input.measuredCredentials)) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_EXPECTATION_INVALID',
      'Database-boundary expectation requires measured-process credential attestation',
    );
  }
  if (!UUID.test(input.actorTenantId)) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_TENANT_ID_INVALID',
      'Authenticated actor tenant must be a UUID before opening a transaction',
    );
  }
  const rolesValid =
    input.measuredCredentials.applicationRole.length > 0 &&
    input.measuredCredentials.applicationRole ===
      input.measuredCredentials.applicationRole.trim() &&
    input.measuredCredentials.authenticationRole.length > 0 &&
    input.measuredCredentials.authenticationRole ===
      input.measuredCredentials.authenticationRole.trim() &&
    input.measuredCredentials.applicationRole !==
      input.measuredCredentials.authenticationRole;
  const credentialsValid =
    SHA256_HEX.test(
      input.measuredCredentials.applicationCredentialSha256,
    ) &&
    SHA256_HEX.test(
      input.measuredCredentials.authenticationCredentialSha256,
    ) &&
    SHA256_HEX.test(input.measuredCredentials.databaseTargetSha256) &&
    input.measuredCredentials.applicationCredentialSha256 !==
      input.measuredCredentials.authenticationCredentialSha256;
  const poolCountsValid =
    Number.isSafeInteger(input.applicationPoolConnectionCount) &&
    input.applicationPoolConnectionCount > 0 &&
    Number.isSafeInteger(input.authenticationPoolConnectionCount) &&
    input.authenticationPoolConnectionCount > 0;
  if (
    !rolesValid ||
    !credentialsValid ||
    !poolCountsValid
  ) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_EXPECTATION_INVALID',
      'Database-boundary expectation is incomplete or internally inconsistent',
    );
  }
  const expectation: DatabaseBoundaryExpectation = Object.freeze({
    applicationRole: input.measuredCredentials.applicationRole,
    authenticationRole: input.measuredCredentials.authenticationRole,
    applicationCredentialSha256:
      input.measuredCredentials.applicationCredentialSha256,
    authenticationCredentialSha256:
      input.measuredCredentials.authenticationCredentialSha256,
    databaseTargetSha256: input.measuredCredentials.databaseTargetSha256,
    applicationPoolConnectionCount: input.applicationPoolConnectionCount,
    authenticationPoolConnectionCount:
      input.authenticationPoolConnectionCount,
    actorTenantId: input.actorTenantId,
    actorUserId:
      input.actorUserId !== null && UUID.test(input.actorUserId)
        ? input.actorUserId
        : null,
  });
  trustedDatabaseBoundaryExpectations.add(expectation);
  return expectation;
}

function assertPoolConnections(
  label: 'application' | 'authentication',
  connections: readonly PoolConnectionAttestation[],
  expectedRole: string,
  expectedCredentialSha256: string,
  expectedDatabaseTargetSha256: string,
  expectedConnectionCount: number,
  connectionIds: Set<string>,
): void {
  if (connections.length !== expectedConnectionCount) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_POOL_CADENCE_MISMATCH',
      `Every configured ${label}-pool connection must be attested`,
      {
        actualPoolConnectionCount: connections.length,
        expectedPoolConnectionCount: expectedConnectionCount,
      },
    );
  }
  for (const connection of connections) {
    if (
      connection.connectionId.length === 0 ||
      connection.connectionId !== connection.connectionId.trim() ||
      connectionIds.has(connection.connectionId)
    ) {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_POOL_CADENCE_MISMATCH',
        'Pool attestation contains a missing or duplicate connection ID',
      );
    }
    connectionIds.add(connection.connectionId);
    if (connection.sessionRole !== expectedRole) {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_SESSION_ROLE_MISMATCH',
        `Every ${label}-pool session_user must equal its configured role`,
        { connectionId: connection.connectionId },
      );
    }
    if (
      connection.currentRole !== expectedRole ||
      !validFingerprint(connection.credentialSha256) ||
      connection.credentialSha256 !== expectedCredentialSha256 ||
      !validFingerprint(connection.databaseTargetSha256) ||
      connection.databaseTargetSha256 !== expectedDatabaseTargetSha256
    ) {
      throw new DatabaseBoundaryAttestationError(
        connection.databaseTargetSha256 !== expectedDatabaseTargetSha256
          ? 'ATTEST_DATABASE_TARGET_MISMATCH'
          : 'ATTEST_CREDENTIAL_MISMATCH',
        `${label} pool contains a missing, invalid, or heterogeneous credential/target binding`,
        { connectionId: connection.connectionId },
      );
    }
  }
}

function assertRoleSecurity(
  security: DatabaseRoleSecurityAttestation,
  expectedRole: string,
  label: 'application' | 'authentication',
): void {
  if (security.usesAdminCredential) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_ADMIN_CREDENTIAL',
      `${label} database boundary is using an admin credential`,
    );
  }
  if (security.role !== expectedRole) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_CREDENTIAL_MISMATCH',
      `${label} role-security evidence does not match the configured role`,
    );
  }
  if (security.isSuperuser) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_SUPERUSER',
      `${label} role must not be a PostgreSQL superuser`,
    );
  }
  if (security.bypassRls) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_BYPASSRLS',
      `${label} role must not have BYPASSRLS`,
    );
  }
  if (
    !Number.isSafeInteger(security.ownerRoleMembershipCount) ||
    security.ownerRoleMembershipCount !== 0
  ) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_OWNER_MEMBERSHIP',
      `${label} role must not inherit a relation-owner role`,
      { membershipCount: security.ownerRoleMembershipCount },
    );
  }
  if (
    !Number.isSafeInteger(security.bypassRoleMembershipCount) ||
    security.bypassRoleMembershipCount !== 0
  ) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_BYPASS_ROLE_MEMBERSHIP',
      `${label} role must not inherit a bypass-capable role`,
      { membershipCount: security.bypassRoleMembershipCount },
    );
  }
}

function assertAuthenticationDirectoryGrants(
  grants: readonly RoleRelationPrivilegeAttestation[],
): void {
  const expected = new Set<string>(AUTHENTICATION_DIRECTORY_RELATION_NAMES);
  const observed = new Set<string>();
  for (const grant of grants) {
    if (
      !expected.has(grant.relationName) ||
      observed.has(grant.relationName) ||
      grant.privileges.length !== 1 ||
      grant.privileges[0] !== 'SELECT'
    ) {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_AUTH_DIRECTORY_GRANTS_MISMATCH',
        'Authentication role must have only SELECT on the closed directory relation set',
      );
    }
    observed.add(grant.relationName);
  }
  if (
    observed.size !== expected.size ||
    AUTHENTICATION_DIRECTORY_RELATION_NAMES.some(
      (relation) => !observed.has(relation),
    )
  ) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_AUTH_DIRECTORY_GRANTS_MISMATCH',
      'Authentication role directory grant attestation is incomplete',
    );
  }
}

function assertCredential(
  snapshot: DatabaseBoundarySnapshot,
  expectation: DatabaseBoundaryExpectation,
): void {
  if (!trustedDatabaseBoundaryExpectations.has(expectation)) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_EXPECTATION_INVALID',
      'Database-boundary expectation did not come from the trusted factory',
    );
  }
  assertRoleSecurity(
    snapshot.applicationRoleSecurity,
    expectation.applicationRole,
    'application',
  );
  assertRoleSecurity(
    snapshot.authenticationRoleSecurity,
    expectation.authenticationRole,
    'authentication',
  );
  if (snapshot.applicationRoleSecurity.relationPrivileges.length !== 0) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_APPLICATION_DIRECTORY_GRANTS_MISMATCH',
      'Application role must have zero effective grants on the authentication directory',
    );
  }
  assertAuthenticationDirectoryGrants(
    snapshot.authenticationRoleSecurity.relationPrivileges,
  );
  if (
    !validFingerprint(snapshot.databaseTargetSha256) ||
    snapshot.databaseTargetSha256 !== expectation.databaseTargetSha256
  ) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_DATABASE_TARGET_MISMATCH',
      'Measured connection does not carry the expected database-target commitment',
    );
  }
  if (
    snapshot.currentRole === null ||
    snapshot.currentRole !== expectation.applicationRole ||
    !validFingerprint(snapshot.currentCredentialSha256) ||
    snapshot.currentCredentialSha256 !==
      expectation.applicationCredentialSha256
  ) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_CREDENTIAL_MISMATCH',
      'Measured connection does not carry the expected application credential',
    );
  }
  if (snapshot.sessionRole !== expectation.applicationRole) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_SESSION_ROLE_MISMATCH',
      'Measured session_user must equal the expected non-privileged role',
    );
  }
  const connectionIds = new Set<string>();
  assertPoolConnections(
    'application',
    snapshot.applicationPoolConnections,
    expectation.applicationRole,
    expectation.applicationCredentialSha256,
    expectation.databaseTargetSha256,
    expectation.applicationPoolConnectionCount,
    connectionIds,
  );
  assertPoolConnections(
    'authentication',
    snapshot.authenticationPoolConnections,
    expectation.authenticationRole,
    expectation.authenticationCredentialSha256,
    expectation.databaseTargetSha256,
    expectation.authenticationPoolConnectionCount,
    connectionIds,
  );
}

function assertSearchedRelationSet(
  relations: readonly SearchedRelationAttestation[],
): void {
  const expected = new Set<string>(SEARCHED_RELATION_NAMES);
  const actual = new Set<string>();
  for (const relation of relations) {
    if (
      actual.has(relation.relationName) ||
      !expected.has(relation.relationName)
    ) {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_RELATION_SET_MISMATCH',
        'Searched-relation attestation contains a duplicate or unknown relation',
      );
    }
    actual.add(relation.relationName);
  }
  if (
    actual.size !== expected.size ||
    SEARCHED_RELATION_NAMES.some((relation) => !actual.has(relation))
  ) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_RELATION_SET_MISMATCH',
      'Searched-relation attestation is incomplete',
      {
        actualRelationCount: actual.size,
        expectedRelationCount: expected.size,
      },
    );
  }
}

/**
 * Pure fail-before-sampling proof of the measured PostgreSQL boundary.
 *
 * The caller gathers this evidence using fixed attestation SQL. This function
 * deliberately has no database dependency so every negative can be planted and
 * RED-proven without creating a privileged runtime path.
 */
export function attestDatabaseBoundary(
  snapshot: DatabaseBoundarySnapshot,
  expectation: DatabaseBoundaryExpectation,
): DatabaseBoundaryAttestation {
  const parsedSnapshot = databaseBoundarySnapshotSchema.safeParse(snapshot);
  if (!parsedSnapshot.success) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_EVIDENCE_INVALID',
      'Database-boundary collector evidence is structurally invalid',
    );
  }
  snapshot = parsedSnapshot.data;
  assertCredential(snapshot, expectation);
  assertSearchedRelationSet(snapshot.searchedRelations);

  for (const relation of snapshot.searchedRelations) {
    if (relation.ownedByCurrentRole) {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_RELATION_OWNER',
        'Measured role must not own a searched relation',
        { relationName: relation.relationName },
      );
    }
    if (!relation.rlsEnabled) {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_RLS_DISABLED',
        'Every searched relation must have row-level security enabled',
        { relationName: relation.relationName },
      );
    }
    if (relation.writePrivileges.length > 0) {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_WRITE_PRIVILEGE',
        'Measured role must have no write privilege on searched relations',
        {
          privilegeCount: relation.writePrivileges.length,
          relationName: relation.relationName,
        },
      );
    }
  }

  if (snapshot.rowSecuritySetting !== 'on') {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_ROW_SECURITY_OFF',
      'Measured session must have row_security=on',
    );
  }
  if (!snapshot.transactionReadOnly) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_READ_WRITE_TRANSACTION',
      'Measured request must run in a read-only transaction',
    );
  }

  if (snapshot.tenantGuc === null || snapshot.tenantGuc.length === 0) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_TENANT_GUC_MISSING',
      'Tenant GUC must be transaction-locally bound',
    );
  }
  if (
    !UUID.test(snapshot.tenantGuc) ||
    snapshot.tenantGuc !== expectation.actorTenantId
  ) {
    throw new DatabaseBoundaryAttestationError(
      'ATTEST_TENANT_GUC_MISMATCH',
      'Tenant GUC does not match the authenticated actor tenant',
    );
  }

  let userContext: DatabaseBoundaryAttestation['userContext'];
  const expectedBoundUserId = expectation.actorUserId;
  if (expectedBoundUserId === null) {
    if (snapshot.userGuc === null) {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_USER_GUC_MISSING',
        'Null-user actor must prove the explicitly bound empty GUC',
      );
    }
    if (snapshot.userGuc !== '') {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_USER_GUC_UNEXPECTED',
        'Null-user actor must retain the empty GUC that resolves to SQL NULL',
      );
    }
    userContext = 'null-deny';
  } else {
    if (snapshot.userGuc === null || snapshot.userGuc === '') {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_USER_GUC_MISSING',
        'Authenticated user GUC is missing',
      );
    }
    if (snapshot.userGuc !== expectedBoundUserId) {
      throw new DatabaseBoundaryAttestationError(
        'ATTEST_USER_GUC_MISMATCH',
        'User GUC does not match the authenticated actor identity',
      );
    }
    userContext = 'bound';
  }

  return Object.freeze({
    role: expectation.applicationRole,
    tenantId: expectation.actorTenantId,
    userContext,
    searchedRelationCount: snapshot.searchedRelations.length,
    applicationPoolConnectionCount:
      snapshot.applicationPoolConnections.length,
    authenticationPoolConnectionCount:
      snapshot.authenticationPoolConnections.length,
  });
}
