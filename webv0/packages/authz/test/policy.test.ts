import { describe, it, expect } from 'vitest';
import type { Actor } from '@c3web/domain';
import { ForbiddenError, SelfReviewError } from '@c3web/domain';
import {
  assertReadPeople,
  assertSubmitApproval,
  assertReviewApproval,
  assertExecuteApproval,
  assertTenantMatch,
  assertReadAgreements,
  assertViewFinancials,
  capabilityView,
} from '../src/policy';

const actor = (over: Partial<Actor>): Actor => ({
  identity: 'ops@tenant-a.com',
  displayName: 'Ops',
  role: 'operations',
  tenantId: 'tenant-a',
  ...over,
});

describe('read People', () => {
  it('every role may read', () => {
    for (const role of ['owner', 'operations', 'legal', 'finance', 'hr', 'management', 'visitor'] as const) {
      expect(() => assertReadPeople(actor({ role }))).not.toThrow();
    }
  });
});

describe('submit AddPerson', () => {
  it('owner and operations may submit', () => {
    expect(() => assertSubmitApproval(actor({ role: 'operations' }))).not.toThrow();
    expect(() => assertSubmitApproval(actor({ role: 'owner' }))).not.toThrow();
  });
  it('read-only roles may not submit', () => {
    for (const role of ['legal', 'finance', 'hr', 'management', 'visitor'] as const) {
      expect(() => assertSubmitApproval(actor({ role }))).toThrow(ForbiddenError);
    }
  });
});

describe('review family (owner only + separation of duties)', () => {
  it('operations may NOT review/approve/reject', () => {
    expect(() => assertReviewApproval(actor({ role: 'operations' }), 'someone@tenant-a.com', 'approve')).toThrow(
      ForbiddenError,
    );
  });
  it('owner may review a request submitted by someone else', () => {
    expect(() =>
      assertReviewApproval(actor({ role: 'owner', identity: 'owner@tenant-a.com' }), 'ops@tenant-a.com', 'approve'),
    ).not.toThrow();
  });
  it('owner may NOT review their OWN request (self-review blocked)', () => {
    expect(() =>
      assertReviewApproval(actor({ role: 'owner', identity: 'owner@tenant-a.com' }), 'Owner@Tenant-A.com', 'approve'),
    ).toThrow(SelfReviewError);
  });
  it('indeterminate submitter identity fails closed', () => {
    expect(() =>
      assertReviewApproval(actor({ role: 'owner', identity: 'owner@tenant-a.com' }), 'garbage', 'beginReview'),
    ).toThrow(SelfReviewError);
  });
});

describe('execute (owner only + separation of duties)', () => {
  it('operations may not execute', () => {
    expect(() => assertExecuteApproval(actor({ role: 'operations' }), 'x@tenant-a.com')).toThrow(ForbiddenError);
  });
  it('owner may execute a request submitted by someone else', () => {
    expect(() =>
      assertExecuteApproval(actor({ role: 'owner', identity: 'owner@tenant-a.com' }), 'ops@tenant-a.com'),
    ).not.toThrow();
  });
  it('owner may not execute their own request', () => {
    expect(() =>
      assertExecuteApproval(actor({ role: 'owner', identity: 'owner@tenant-a.com' }), 'owner@tenant-a.com'),
    ).toThrow(SelfReviewError);
  });
});

describe('tenant match fails closed', () => {
  it('same tenant allowed', () => {
    expect(() => assertTenantMatch('tenant-a', 'tenant-a')).not.toThrow();
  });
  it('cross tenant blocked', () => {
    expect(() => assertTenantMatch('tenant-a', 'tenant-b')).toThrow(ForbiddenError);
  });
  it('empty actor tenant blocked', () => {
    expect(() => assertTenantMatch('', '')).toThrow(ForbiddenError);
  });
});

describe('agreements: read vs financial detail (Finance S3 gate)', () => {
  it('owner/operations/legal/finance/management may read agreements; hr/visitor may not', () => {
    for (const role of ['owner', 'operations', 'legal', 'finance', 'management'] as const) {
      expect(() => assertReadAgreements(actor({ role }))).not.toThrow();
    }
    for (const role of ['hr', 'visitor'] as const) {
      expect(() => assertReadAgreements(actor({ role }))).toThrow(ForbiddenError);
    }
  });

  it('only owner/operations/finance/management may view financial detail — legal is denied', () => {
    for (const role of ['owner', 'operations', 'finance', 'management'] as const) {
      expect(() => assertViewFinancials(actor({ role }))).not.toThrow();
    }
    for (const role of ['legal', 'hr', 'visitor'] as const) {
      expect(() => assertViewFinancials(actor({ role }))).toThrow(ForbiddenError);
    }
  });
});

describe('capabilityView (UX hint)', () => {
  it('summarises operations correctly', () => {
    expect(capabilityView('operations')).toEqual({
      canReadPeople: true,
      canSubmitApproval: true,
      canReviewApproval: false,
      canExecuteApproval: false,
      canReadMembers: true,
      canSubmitMemberChange: true,
      canOperateJourneys: true,
      canManageKit: true,
      canManageApparel: true,
      canManageMissions: true,
      canManageEntities: true,
      canManageIntake: true,
      canManageSubscriptions: true,
      canReadAgreements: true,
      canViewFinancials: true,
      canViewPerDiem: true,
      canSubmitClaim: true,
      canDecideClaim: true,
      canManageDelegations: false,
      canViewSituation: true,
      canViewPersonPII: true,
    });
  });

  it('S11: the person-PII tier is owner/operations/hr exactly (owner-ratified C1)', () => {
    for (const role of ['owner', 'operations', 'hr'] as const) expect(capabilityView(role).canViewPersonPII, role).toBe(true);
    for (const role of ['legal', 'finance', 'management', 'visitor'] as const) expect(capabilityView(role).canViewPersonPII, role).toBe(false);
  });

  it('reserves delegation management for the owner alone', () => {
    expect(capabilityView('owner').canManageDelegations).toBe(true);
    for (const role of ['operations', 'hr', 'legal', 'finance', 'management', 'visitor'] as const) {
      expect(capabilityView(role).canManageDelegations, role).toBe(false);
    }
  });

  it('withholds member administration from read-only roles', () => {
    expect(capabilityView('visitor')).toMatchObject({ canReadMembers: false, canSubmitMemberChange: false });
  });
});
