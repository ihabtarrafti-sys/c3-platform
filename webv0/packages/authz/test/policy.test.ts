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
  userId: 'user-a',
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
    expect(() => assertTenantMatch(actor({ tenantId: 'tenant-a' }), 'tenant-a')).not.toThrow();
  });
  it('cross tenant blocked', () => {
    expect(() => assertTenantMatch(actor({ tenantId: 'tenant-a' }), 'tenant-b')).toThrow(ForbiddenError);
  });
  it('empty actor tenant blocked', () => {
    expect(() => assertTenantMatch(actor({ tenantId: '' }), '')).toThrow(ForbiddenError);
  });

  it('⛔ TRANSPOSITION IS UNREPRESENTABLE — the old shape could be disarmed by argument order', () => {
    // The signature used to be (actorTenantId: string, recordTenantId: string):
    // two positional arguments of the SAME TYPE, so swapping them — or passing
    // the same value twice — type-checked perfectly and defeated the guard in
    // silence. Taking the Actor makes that error impossible to write.
    // @ts-expect-error — a bare tenant id is no longer accepted where an actor is required.
    expect(() => assertTenantMatch('tenant-a', 'tenant-a')).toThrow();
  });

  it('⛔ the other tenant’s id never travels in the error — and a refusal MUST occur', () => {
    // You may learn about yourself; you may not learn another organisation's
    // identifiers from an error you triggered.
    //
    // ⛔ CR-004. The previous shape put `throw new Error('expected a refusal')`
    // INSIDE the `try`, where its own `catch` swallowed it: if `assertTenantMatch`
    // returned quietly, `err` was not a `ForbiddenError`, `details` fell back to
    // `{}`, and `{}` contains no secret — so **the test passed precisely when the
    // guard was gone.** *A negative security test that accepts no refusal as
    // proof of safe refusal is measuring nothing.*
    //
    // The capture below cannot conflate those: absence of a throw is `null`, and
    // `null` is not a `ForbiddenError`.
    const raised = ((): unknown => {
      try {
        assertTenantMatch(actor({ tenantId: 'tenant-a' }), 'tenant-SECRET');
        return null;
      } catch (err) {
        return err;
      }
    })();

    expect(raised, 'no refusal at all is a FAILURE, not a silent pass').toBeInstanceOf(ForbiddenError);
    const forbidden = raised as ForbiddenError;
    expect(JSON.stringify(forbidden.details ?? {})).not.toContain('tenant-SECRET');
    // The message is a disclosure surface too — it reaches the client envelope.
    expect(forbidden.message).not.toContain('tenant-SECRET');
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
      canReadClaims: true,
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
