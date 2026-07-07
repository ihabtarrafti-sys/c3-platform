/**
 * member.test.ts — Sprint 35 M1 evidence: the tenant-admin domain contracts.
 * Operation registry, payload discrimination, input validation (strict,
 * normalising), capability matrix extension, and the guard error taxonomy.
 */
import { describe, it, expect } from 'vitest';
import {
  OPERATION_TYPES,
  AUDIT_ACTIONS,
  parseApprovalPayload,
  provisionMemberInputSchema,
  changeRoleInputSchema,
  deactivateMemberInputSchema,
  reactivateMemberInputSchema,
  capabilitiesFor,
  C3_ROLES,
  MEMBER_OP_TARGET,
  SelfAdministrationError,
  LastOwnerProtectionError,
  IdentityAlreadyBoundError,
} from '../src/index';

const UUID = '6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b';

describe('operation registry (Sprint 35)', () => {
  it('registers the four member operations alongside AddPerson', () => {
    expect(OPERATION_TYPES).toEqual([
      'AddPerson',
      'ProvisionMember',
      'ChangeRole',
      'DeactivateMember',
      'ReactivateMember',
    ]);
  });

  it('defines the member-op target sentinel (targetPersonId is person-specific)', () => {
    expect(MEMBER_OP_TARGET).toBe('N/A-MEMBER');
  });
});

describe('provisionMemberInputSchema', () => {
  const valid = {
    email: '  New.Member@Example.com ',
    displayName: '  New Member ',
    role: 'operations',
    identity: { provider: 'entra', issuerTenantId: 'tid-1', subject: 'oid-1' },
  };

  it('parses and normalises (email lower-cased, fields trimmed)', () => {
    const parsed = provisionMemberInputSchema.parse(valid);
    expect(parsed.email).toBe('new.member@example.com');
    expect(parsed.displayName).toBe('New Member');
    expect(parsed.role).toBe('operations');
    expect(parsed.identity.subject).toBe('oid-1');
  });

  it('rejects unknown roles, bad emails, missing identity, unknown keys', () => {
    expect(() => provisionMemberInputSchema.parse({ ...valid, role: 'root' })).toThrow();
    expect(() => provisionMemberInputSchema.parse({ ...valid, email: 'not-an-email' })).toThrow();
    const { identity: _drop, ...noIdentity } = valid;
    expect(() => provisionMemberInputSchema.parse(noIdentity)).toThrow();
    expect(() => provisionMemberInputSchema.parse({ ...valid, extra: 'x' })).toThrow();
  });

  it('rejects a dev/entra-unknown identity provider', () => {
    expect(() =>
      provisionMemberInputSchema.parse({ ...valid, identity: { ...valid.identity, provider: 'google' } }),
    ).toThrow();
  });
});

describe('member-targeting schemas', () => {
  it('changeRole requires a uuid target and a known destination role', () => {
    const parsed = changeRoleInputSchema.parse({ targetUserId: UUID, email: 'M@x.com', toRole: 'management' });
    expect(parsed.email).toBe('m@x.com');
    expect(() => changeRoleInputSchema.parse({ targetUserId: 'user-1', email: 'm@x.com', toRole: 'management' })).toThrow(/uuid/i);
    expect(() => changeRoleInputSchema.parse({ targetUserId: UUID, email: 'm@x.com', toRole: 'superuser' })).toThrow();
  });

  it('deactivate/reactivate require the uuid target', () => {
    expect(deactivateMemberInputSchema.parse({ targetUserId: UUID, email: 'm@x.com' }).targetUserId).toBe(UUID);
    expect(reactivateMemberInputSchema.parse({ targetUserId: UUID, email: 'm@x.com' }).targetUserId).toBe(UUID);
    expect(() => deactivateMemberInputSchema.parse({ targetUserId: 'nope', email: 'm@x.com' })).toThrow();
  });
});

describe('approval payload union discrimination', () => {
  it('accepts every member-op payload with its own input shape', () => {
    const p1 = parseApprovalPayload({
      operationType: 'ProvisionMember',
      input: { email: 'a@x.com', displayName: 'A', role: 'visitor', identity: { provider: 'entra', issuerTenantId: 't', subject: 's' } },
    });
    expect(p1.operationType).toBe('ProvisionMember');
    const p2 = parseApprovalPayload({ operationType: 'DeactivateMember', input: { targetUserId: UUID, email: 'a@x.com' } });
    expect(p2.operationType).toBe('DeactivateMember');
  });

  it('rejects a member-op payload carrying another operation\'s input', () => {
    expect(() =>
      parseApprovalPayload({ operationType: 'ChangeRole', input: { fullName: 'Not a role change' } }),
    ).toThrow();
    // AddPerson still parses (regression).
    const add = parseApprovalPayload({ operationType: 'AddPerson', input: { fullName: 'Still Works' } });
    expect(add.operationType).toBe('AddPerson');
  });
});

describe('audit action registry (A-8 Phase 2 actions)', () => {
  it('adds the member mutation actions and the audited emergency path', () => {
    for (const a of ['MemberProvisioned', 'MemberRoleChanged', 'MemberDeactivated', 'MemberReactivated', 'EmergencyLockout']) {
      expect(AUDIT_ACTIONS).toContain(a);
    }
  });
});

describe('capability matrix extension', () => {
  it('is total: every role fully specifies the member capabilities', () => {
    for (const role of C3_ROLES) {
      const c = capabilitiesFor(role);
      expect(typeof c.canReadMembers).toBe('boolean');
      expect(typeof c.canSubmitMemberChange).toBe('boolean');
    }
  });

  it('owner and operations may read members and submit member changes; read-only roles may not', () => {
    for (const role of ['owner', 'operations'] as const) {
      expect(capabilitiesFor(role).canReadMembers).toBe(true);
      expect(capabilitiesFor(role).canSubmitMemberChange).toBe(true);
    }
    for (const role of ['legal', 'finance', 'hr', 'management', 'visitor'] as const) {
      expect(capabilitiesFor(role).canReadMembers).toBe(false);
      expect(capabilitiesFor(role).canSubmitMemberChange).toBe(false);
    }
  });

  it('review/execute of member operations reuses the owner-only approval capabilities', () => {
    expect(capabilitiesFor('operations').canReviewApproval).toBe(false);
    expect(capabilitiesFor('owner').canReviewApproval).toBe(true);
    expect(capabilitiesFor('owner').canExecuteApproval).toBe(true);
  });
});

describe('guard error taxonomy', () => {
  it('carries stable codes for the three tenant-admin invariants', () => {
    expect(new SelfAdministrationError('ChangeRole').code).toBe('SELF_ADMINISTRATION_BLOCKED');
    expect(new LastOwnerProtectionError('DeactivateMember').code).toBe('LAST_OWNER_PROTECTED');
    expect(new IdentityAlreadyBoundError().code).toBe('IDENTITY_ALREADY_BOUND');
  });
});
