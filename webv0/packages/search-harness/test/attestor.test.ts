import { describe, expect, it } from 'vitest';

import {
  DatabaseBoundaryAttestationError,
  AUTHENTICATION_DIRECTORY_RELATION_NAMES,
  SEARCHED_RELATION_NAMES,
  attestDatabaseBoundary,
  createDatabaseBoundaryExpectation,
  type DatabaseBoundaryExpectation,
  type DatabaseBoundaryExpectationInput,
  type DatabaseBoundaryFailureCode,
  type DatabaseBoundarySnapshot,
} from '../src/attestor.js';
import { assertMeasuredProcessEnvironment } from '../src/credentials.js';

const measuredCredentials = assertMeasuredProcessEnvironment({
  NODE_ENV: 'production',
  RATE_LIMIT_MAX: '100000',
  DATABASE_URL:
    'postgresql://c3_search_app:app-secret@127.0.0.1:6543/c3_hearth_search_run',
  DATABASE_AUTH_URL:
    'postgresql://c3_auth_reader:auth-secret@127.0.0.1:6543/c3_hearth_search_run',
});
const applicationCredential =
  measuredCredentials.applicationCredentialSha256;
const authenticationCredential =
  measuredCredentials.authenticationCredentialSha256;

const validExpectation = (
  overrides: Partial<DatabaseBoundaryExpectationInput> = {},
): DatabaseBoundaryExpectation =>
  createDatabaseBoundaryExpectation({
    measuredCredentials,
    applicationPoolConnectionCount: 2,
    authenticationPoolConnectionCount: 1,
    actorTenantId: '11111111-1111-4111-8111-111111111111',
    actorUserId: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  });

const validSnapshot = (): DatabaseBoundarySnapshot => ({
  currentRole: 'c3_search_app',
  sessionRole: 'c3_search_app',
  currentCredentialSha256: applicationCredential,
  databaseTargetSha256: measuredCredentials.databaseTargetSha256,
  applicationPoolConnections: [
    {
      connectionId: 'application-pool-1',
      currentRole: 'c3_search_app',
      sessionRole: 'c3_search_app',
      credentialSha256: applicationCredential,
      databaseTargetSha256: measuredCredentials.databaseTargetSha256,
    },
    {
      connectionId: 'application-pool-2',
      currentRole: 'c3_search_app',
      sessionRole: 'c3_search_app',
      credentialSha256: applicationCredential,
      databaseTargetSha256: measuredCredentials.databaseTargetSha256,
    },
  ],
  authenticationPoolConnections: [
    {
      connectionId: 'authentication-pool-1',
      currentRole: 'c3_auth_reader',
      sessionRole: 'c3_auth_reader',
      credentialSha256: authenticationCredential,
      databaseTargetSha256: measuredCredentials.databaseTargetSha256,
    },
  ],
  applicationRoleSecurity: {
    role: 'c3_search_app',
    usesAdminCredential: false,
    isSuperuser: false,
    bypassRls: false,
    ownerRoleMembershipCount: 0,
    bypassRoleMembershipCount: 0,
    relationPrivileges: [],
  },
  authenticationRoleSecurity: {
    role: 'c3_auth_reader',
    usesAdminCredential: false,
    isSuperuser: false,
    bypassRls: false,
    ownerRoleMembershipCount: 0,
    bypassRoleMembershipCount: 0,
    relationPrivileges: AUTHENTICATION_DIRECTORY_RELATION_NAMES.map(
      (relationName) => ({
        relationName,
        privileges: ['SELECT'],
      }),
    ),
  },
  rowSecuritySetting: 'on',
  transactionReadOnly: true,
  tenantGuc: '11111111-1111-4111-8111-111111111111',
  userGuc: '22222222-2222-4222-8222-222222222222',
  searchedRelations: SEARCHED_RELATION_NAMES.map((relationName) => ({
    relationName,
    rlsEnabled: true,
    ownedByCurrentRole: false,
    writePrivileges: [],
  })),
});

function expectAttestorCode(
  action: () => unknown,
  code: DatabaseBoundaryFailureCode,
): void {
  try {
    action();
    throw new Error('expected database attestor to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseBoundaryAttestationError);
    expect((error as DatabaseBoundaryAttestationError).code).toBe(code);
  }
}

describe('pure database-boundary attestor', () => {
  it('attests both configured pools plus the non-privileged, read-only RLS boundary', () => {
    expect(attestDatabaseBoundary(validSnapshot(), validExpectation())).toEqual({
      role: 'c3_search_app',
      tenantId: '11111111-1111-4111-8111-111111111111',
      userContext: 'bound',
      searchedRelationCount: 17,
      applicationPoolConnectionCount: 2,
      authenticationPoolConnectionCount: 1,
    });
  });

  it.each([
    ['application admin credential', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationRoleSecurity: { ...s.applicationRoleSecurity, usesAdminCredential: true } }), 'ATTEST_ADMIN_CREDENTIAL'],
    ['application superuser', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationRoleSecurity: { ...s.applicationRoleSecurity, isSuperuser: true } }), 'ATTEST_SUPERUSER'],
    ['application BYPASSRLS', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationRoleSecurity: { ...s.applicationRoleSecurity, bypassRls: true } }), 'ATTEST_BYPASSRLS'],
    ['application owner membership', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationRoleSecurity: { ...s.applicationRoleSecurity, ownerRoleMembershipCount: 1 } }), 'ATTEST_OWNER_MEMBERSHIP'],
    ['application bypass membership', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationRoleSecurity: { ...s.applicationRoleSecurity, bypassRoleMembershipCount: 1 } }), 'ATTEST_BYPASS_ROLE_MEMBERSHIP'],
    ['authentication admin credential', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationRoleSecurity: { ...s.authenticationRoleSecurity, usesAdminCredential: true } }), 'ATTEST_ADMIN_CREDENTIAL'],
    ['authentication superuser', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationRoleSecurity: { ...s.authenticationRoleSecurity, isSuperuser: true } }), 'ATTEST_SUPERUSER'],
    ['authentication BYPASSRLS', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationRoleSecurity: { ...s.authenticationRoleSecurity, bypassRls: true } }), 'ATTEST_BYPASSRLS'],
    ['authentication owner membership', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationRoleSecurity: { ...s.authenticationRoleSecurity, ownerRoleMembershipCount: 1 } }), 'ATTEST_OWNER_MEMBERSHIP'],
    ['authentication bypass membership', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationRoleSecurity: { ...s.authenticationRoleSecurity, bypassRoleMembershipCount: 1 } }), 'ATTEST_BYPASS_ROLE_MEMBERSHIP'],
    ['application directory write grant', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationRoleSecurity: { ...s.applicationRoleSecurity, relationPrivileges: [{ relationName: 'tenant_membership', privileges: ['INSERT', 'UPDATE', 'DELETE'] }] } }), 'ATTEST_APPLICATION_DIRECTORY_GRANTS_MISMATCH'],
    ['authentication write grant', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationRoleSecurity: { ...s.authenticationRoleSecurity, relationPrivileges: s.authenticationRoleSecurity.relationPrivileges.map((grant, index) => index === 0 ? { ...grant, privileges: ['SELECT', 'UPDATE'] } : grant) } }), 'ATTEST_AUTH_DIRECTORY_GRANTS_MISMATCH'],
    ['authentication unknown relation grant', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationRoleSecurity: { ...s.authenticationRoleSecurity, relationPrivileges: [...s.authenticationRoleSecurity.relationPrivileges, { relationName: 'person', privileges: ['SELECT'] }] } }), 'ATTEST_AUTH_DIRECTORY_GRANTS_MISMATCH'],
    ['authentication missing directory grant', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationRoleSecurity: { ...s.authenticationRoleSecurity, relationPrivileges: s.authenticationRoleSecurity.relationPrivileges.slice(1) } }), 'ATTEST_AUTH_DIRECTORY_GRANTS_MISMATCH'],
    ['direct ownership', (s: DatabaseBoundarySnapshot) => ({ ...s, searchedRelations: s.searchedRelations.map((relation, index) => index === 0 ? { ...relation, ownedByCurrentRole: true } : relation) }), 'ATTEST_RELATION_OWNER'],
    ['RLS disabled', (s: DatabaseBoundarySnapshot) => ({ ...s, searchedRelations: s.searchedRelations.map((relation, index) => index === 0 ? { ...relation, rlsEnabled: false } : relation) }), 'ATTEST_RLS_DISABLED'],
    ['row_security off', (s: DatabaseBoundarySnapshot) => ({ ...s, rowSecuritySetting: 'off' as const }), 'ATTEST_ROW_SECURITY_OFF'],
    ['write privilege', (s: DatabaseBoundarySnapshot) => ({ ...s, searchedRelations: s.searchedRelations.map((relation, index) => index === 0 ? { ...relation, writePrivileges: ['UPDATE' as const] } : relation) }), 'ATTEST_WRITE_PRIVILEGE'],
    ['read-write transaction', (s: DatabaseBoundarySnapshot) => ({ ...s, transactionReadOnly: false }), 'ATTEST_READ_WRITE_TRANSACTION'],
    ['missing tenant GUC', (s: DatabaseBoundarySnapshot) => ({ ...s, tenantGuc: null }), 'ATTEST_TENANT_GUC_MISSING'],
    ['mismatched tenant GUC', (s: DatabaseBoundarySnapshot) => ({ ...s, tenantGuc: 'other-tenant' }), 'ATTEST_TENANT_GUC_MISMATCH'],
    ['role mismatch', (s: DatabaseBoundarySnapshot) => ({ ...s, currentRole: 'c3_backup' }), 'ATTEST_CREDENTIAL_MISMATCH'],
    ['SET ROLE session mismatch', (s: DatabaseBoundarySnapshot) => ({ ...s, sessionRole: 'c3_admin' }), 'ATTEST_SESSION_ROLE_MISMATCH'],
    ['application-pool SET ROLE session mismatch', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationPoolConnections: [s.applicationPoolConnections[0]!, { ...s.applicationPoolConnections[1]!, sessionRole: 'c3_admin' }] }), 'ATTEST_SESSION_ROLE_MISMATCH'],
    ['authentication-pool SET ROLE session mismatch', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationPoolConnections: [{ ...s.authenticationPoolConnections[0]!, sessionRole: 'c3_admin' }] }), 'ATTEST_SESSION_ROLE_MISMATCH'],
    ['credential mismatch', (s: DatabaseBoundarySnapshot) => ({ ...s, currentCredentialSha256: 'b'.repeat(64) }), 'ATTEST_CREDENTIAL_MISMATCH'],
    ['measured database target mismatch', (s: DatabaseBoundarySnapshot) => ({ ...s, databaseTargetSha256: 'b'.repeat(64) }), 'ATTEST_DATABASE_TARGET_MISMATCH'],
    ['heterogeneous application pool', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationPoolConnections: [s.applicationPoolConnections[0]!, { ...s.applicationPoolConnections[1]!, credentialSha256: 'c'.repeat(64) }] }), 'ATTEST_CREDENTIAL_MISMATCH'],
    ['heterogeneous authentication pool', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationPoolConnections: [{ ...s.authenticationPoolConnections[0]!, credentialSha256: applicationCredential }] }), 'ATTEST_CREDENTIAL_MISMATCH'],
    ['cross-target application pool', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationPoolConnections: [s.applicationPoolConnections[0]!, { ...s.applicationPoolConnections[1]!, databaseTargetSha256: 'c'.repeat(64) }] }), 'ATTEST_DATABASE_TARGET_MISMATCH'],
    ['cross-target authentication pool', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationPoolConnections: [{ ...s.authenticationPoolConnections[0]!, databaseTargetSha256: 'c'.repeat(64) }] }), 'ATTEST_DATABASE_TARGET_MISMATCH'],
    ['duplicate application-pool attestation', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationPoolConnections: [s.applicationPoolConnections[0]!, { ...s.applicationPoolConnections[1]!, connectionId: 'application-pool-1' }] }), 'ATTEST_POOL_CADENCE_MISMATCH'],
    ['cross-pool duplicate attestation', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationPoolConnections: [{ ...s.authenticationPoolConnections[0]!, connectionId: 'application-pool-1' }] }), 'ATTEST_POOL_CADENCE_MISMATCH'],
    ['skipped application-pool checkout', (s: DatabaseBoundarySnapshot) => ({ ...s, applicationPoolConnections: [s.applicationPoolConnections[0]!] }), 'ATTEST_POOL_CADENCE_MISMATCH'],
    ['skipped authentication-pool checkout', (s: DatabaseBoundarySnapshot) => ({ ...s, authenticationPoolConnections: [] }), 'ATTEST_POOL_CADENCE_MISMATCH'],
    ['empty searched relation set', (s: DatabaseBoundarySnapshot) => ({ ...s, searchedRelations: [] }), 'ATTEST_RELATION_SET_MISMATCH'],
    ['missing searched relation', (s: DatabaseBoundarySnapshot) => ({ ...s, searchedRelations: s.searchedRelations.slice(1) }), 'ATTEST_RELATION_SET_MISMATCH'],
    ['unknown searched relation', (s: DatabaseBoundarySnapshot) => ({ ...s, searchedRelations: [{ ...s.searchedRelations[0]!, relationName: 'shadow_search' }, ...s.searchedRelations.slice(1)] }), 'ATTEST_RELATION_SET_MISMATCH'],
    ['missing user GUC', (s: DatabaseBoundarySnapshot) => ({ ...s, userGuc: '' }), 'ATTEST_USER_GUC_MISSING'],
    ['mismatched user GUC', (s: DatabaseBoundarySnapshot) => ({ ...s, userGuc: 'other-user' }), 'ATTEST_USER_GUC_MISMATCH'],
  ] as const)('RED: catches planted %s before sampling', (_label, mutate, code) => {
    expectAttestorCode(
      () => attestDatabaseBoundary(mutate(validSnapshot()), validExpectation()),
      code,
    );
  });

  it('RED: refuses one observed checkout against a trusted configured pool size of 20', () => {
    expectAttestorCode(
      () =>
        attestDatabaseBoundary(
          validSnapshot(),
          validExpectation({ applicationPoolConnectionCount: 20 }),
        ),
      'ATTEST_POOL_CADENCE_MISMATCH',
    );
  });

  it('RED: refuses a spread-cloned expectation even when its values look valid', () => {
    const forged = { ...validExpectation() } as DatabaseBoundaryExpectation;
    expectAttestorCode(
      () => attestDatabaseBoundary(validSnapshot(), forged),
      'ATTEST_EXPECTATION_INVALID',
    );
  });

  it('RED: refuses a forged structural clone of measured credential evidence', () => {
    expectAttestorCode(
      () =>
        validExpectation({
          measuredCredentials: { ...measuredCredentials },
        }),
      'ATTEST_EXPECTATION_INVALID',
    );
  });

  it('RED: refuses a malformed trusted actor tenant', () => {
    expectAttestorCode(
      () => validExpectation({ actorTenantId: 'not-a-uuid' }),
      'ATTEST_TENANT_ID_INVALID',
    );
  });

  it.each([
    [
      'string read-only flag',
      (snapshot: DatabaseBoundarySnapshot) => ({
        ...snapshot,
        transactionReadOnly: 'off',
      }),
    ],
    [
      'string RLS flag',
      (snapshot: DatabaseBoundarySnapshot) => ({
        ...snapshot,
        searchedRelations: snapshot.searchedRelations.map(
          (relation, index) =>
            index === 0 ? { ...relation, rlsEnabled: 'off' } : relation,
        ),
      }),
    ],
    [
      'null privilege flag',
      (snapshot: DatabaseBoundarySnapshot) => ({
        ...snapshot,
        authenticationRoleSecurity: {
          ...snapshot.authenticationRoleSecurity,
          isSuperuser: null,
        },
      }),
    ],
  ] as const)('RED: refuses runtime-typed %s evidence', (_label, mutate) => {
    expectAttestorCode(
      () =>
        attestDatabaseBoundary(
          mutate(validSnapshot()) as unknown as DatabaseBoundarySnapshot,
          validExpectation(),
        ),
      'ATTEST_EVIDENCE_INVALID',
    );
  });

  it('preserves the recorded null-user deny semantics', () => {
    expect(
      attestDatabaseBoundary(
        {
          ...validSnapshot(),
          userGuc: '',
        },
        validExpectation({ actorUserId: null }),
      ).userContext,
    ).toBe('null-deny');
    expect(
      attestDatabaseBoundary(
        {
          ...validSnapshot(),
          userGuc: '',
        },
        validExpectation({ actorUserId: 'malformed-user' }),
      ).userContext,
    ).toBe('null-deny');
  });

  it('RED: refuses an absent user GUC when the real path binds an empty value', () => {
    expectAttestorCode(
      () =>
        attestDatabaseBoundary(
          {
            ...validSnapshot(),
            userGuc: null,
          },
          validExpectation({ actorUserId: null }),
        ),
      'ATTEST_USER_GUC_MISSING',
    );
  });

  it('RED: refuses a non-empty user GUC for a null-user actor', () => {
    expectAttestorCode(
      () =>
        attestDatabaseBoundary(
          {
            ...validSnapshot(),
            userGuc: 'injected-user',
          },
          validExpectation({ actorUserId: null }),
        ),
      'ATTEST_USER_GUC_UNEXPECTED',
    );
  });
});
