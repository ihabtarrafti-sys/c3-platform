import type { ApprovalSummaryDto, MemberDto } from '@c3web/api-contracts';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api';
import { membersRegisterActionsAvailable } from '../src/pages/MembersPage';
import {
  joinSeatsStandingTruth,
  memberRegisterTruthOf,
  seatChangeStandingOf,
  seatingApprovalsOf,
  seatingRelayTruthOf,
  type SeatsStandingTruthFacts,
} from '../src/tablework/SeatsStanding';

const witnessedAt = Date.parse('2026-08-06T12:30:00.000Z');
const member = {} as MemberDto;

function facts<T>(overrides: Partial<SeatsStandingTruthFacts<T>> = {}): SeatsStandingTruthFacts<T> {
  return {
    canRead: true,
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    dataUpdatedAt: witnessedAt,
    ...overrides,
  };
}

function approval(
  approvalId: string,
  operationType: ApprovalSummaryDto['operationType'],
  status: ApprovalSummaryDto['status'] = 'Submitted',
  submittedAt = '2026-08-06T12:00:00.000Z',
): ApprovalSummaryDto {
  return {
    approvalId,
    operationType,
    targetPersonId: 'N/A-MEMBER',
    targetId: null,
    reason: null,
    status,
    submittedBy: '11111111-1111-4111-8111-111111111111',
    submittedAt,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: null,
    executedAt: null,
    executionError: null,
    version: 0,
    editCount: 0,
    revisionOf: null,
    supersededBy: null,
    createdAt: submittedAt,
    updatedAt: submittedAt,
  };
}

describe('Seats & Standing independent witnesses', () => {
  it('derives all six Members truth states without borrowing approval health', () => {
    expect(memberRegisterTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(memberRegisterTruthOf(facts({ data: { members: [member] } }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(memberRegisterTruthOf(facts({ data: { members: [] } }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(memberRegisterTruthOf(facts({ canRead: false }))).toEqual({
      kind: 'denied',
      reasonClass: 'MEMBERS_UNAVAILABLE',
    });
    expect(memberRegisterTruthOf(facts({ error: new Error('members unavailable') }))).toEqual({
      kind: 'fetch-failed',
      message: 'members unavailable',
    });
    expect(memberRegisterTruthOf(facts({ data: { members: [member] }, isFetching: true }))).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'The access register is being checked again.',
    });
  });

  it('derives the same six states independently for the filtered seating relay', () => {
    const one = approval('APR-0001', 'ProvisionMember');
    expect(seatingRelayTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(seatingRelayTruthOf(facts({ data: { approvals: [one] } }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(seatingRelayTruthOf(facts({ data: { approvals: [] } }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(seatingRelayTruthOf(facts({ canRead: false }))).toEqual({
      kind: 'denied',
      reasonClass: 'SEATING_RELAY_UNAVAILABLE',
    });
    expect(seatingRelayTruthOf(facts({ error: new Error('relay unavailable') }))).toEqual({
      kind: 'fetch-failed',
      message: 'relay unavailable',
    });
    expect(seatingRelayTruthOf(facts({ data: { approvals: [one] }, isFetching: true }))).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'The seating relay is being checked again.',
    });
  });

  it.each([401, 403])('redacts cached Members after authoritative HTTP %s', (status) => {
    expect(
      memberRegisterTruthOf(
        facts({
          data: { members: [member] },
          error: new ApiError(status, 'MEMBERS_REFUSED', 'The register was refused.'),
          isFetching: true,
        }),
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'MEMBERS_REFUSED' });
  });

  it.each([401, 403])('redacts cached seating approvals after authoritative HTTP %s', (status) => {
    expect(
      seatingRelayTruthOf(
        facts({
          data: { approvals: [approval('APR-0008', 'ProvisionMember')] },
          error: new ApiError(status, 'APPROVALS_REFUSED', 'The relay was refused.'),
          isFetching: true,
        }),
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'APPROVALS_REFUSED' });
  });

  it('never upgrades cached emptiness during a background recheck', () => {
    expect(memberRegisterTruthOf(facts({ data: { members: [] }, isFetching: true })).kind).toBe('stale');
    expect(seatingRelayTruthOf(facts({ data: { approvals: [] }, isFetching: true })).kind).toBe('stale');
  });

  it('keeps a completed failed refresh distinct from an in-flight recheck', () => {
    expect(
      memberRegisterTruthOf(facts({ data: { members: [member] }, error: new Error('temporarily offline') })),
    ).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'temporarily offline',
    });
  });
});

describe('Seats & Standing relay semantics', () => {
  it('includes only governed member operations and sorts newest first', () => {
    const approvals = [
      approval('APR-0001', 'ProvisionMember', 'Submitted', '2026-08-06T09:00:00.000Z'),
      approval('APR-0002', 'ChangeRole', 'InReview', '2026-08-06T13:00:00.000Z'),
      approval('APR-0003', 'DeactivateMember'),
      approval('APR-0004', 'ReactivateMember'),
      approval('APR-0005', 'AddPerson'),
      approval('APR-0006', 'AddAgreement'),
    ];

    expect(seatingApprovalsOf({ approvals }).map((item) => item.approvalId)).toEqual([
      'APR-0002',
      'APR-0003',
      'APR-0004',
      'APR-0001',
    ]);
    expect(seatingRelayTruthOf(facts({ data: { approvals: [approval('APR-0007', 'AddPerson')] } }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
  });

  it('keeps every approval stage distinct from current membership standing', () => {
    expect(seatChangeStandingOf('Approved')).toMatchObject({
      label: 'Approved — not executed',
      variant: 'pending',
      unsettled: true,
    });
    expect(seatChangeStandingOf('Executed')).toMatchObject({
      label: 'Execution recorded · check current standing',
      variant: 'ready',
      unsettled: false,
    });
    for (const status of ['Submitted', 'InReview', 'Rejected', 'Withdrawn', 'ExecutionFailed'] as const) {
      expect(seatChangeStandingOf(status).label).not.toMatch(/access (?:granted|created)|seated/i);
    }
  });

});

describe('Seats & Standing aggregate witness', () => {
  const at = (value: string) => new Date(value);
  const membersVerified = { kind: 'verified' as const, at: at('2026-08-06T12:00:00.000Z') };
  const relayVerified = { kind: 'verified' as const, at: at('2026-08-06T12:10:00.000Z') };

  it('uses the symmetric denied > failed > loading > stale > complete precedence', () => {
    expect(
      joinSeatsStandingTruth(
        { kind: 'fetch-failed', message: 'members offline' },
        { kind: 'denied', reasonClass: 'APPROVALS_DENIED' },
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'seating-relay:APPROVALS_DENIED' });
    expect(
      joinSeatsStandingTruth(
        { kind: 'loading' },
        { kind: 'fetch-failed', message: 'relay offline' },
      ),
    ).toEqual({ kind: 'fetch-failed', message: 'seating-relay: relay offline' });
    expect(
      joinSeatsStandingTruth(
        { kind: 'stale', verifiedAt: at('2026-08-06T11:50:00.000Z'), message: 'members stale' },
        { kind: 'loading' },
      ),
    ).toEqual({ kind: 'loading' });
    expect(
      joinSeatsStandingTruth(
        { kind: 'stale', verifiedAt: at('2026-08-06T11:50:00.000Z'), message: 'members stale' },
        { kind: 'stale', verifiedAt: at('2026-08-06T11:55:00.000Z'), message: 'relay stale' },
      ),
    ).toEqual({
      kind: 'stale',
      verifiedAt: at('2026-08-06T11:50:00.000Z'),
      message: 'members and seating-relay are stale; current standing may be incomplete.',
    });
  });

  it('combines same-kind failures deterministically', () => {
    expect(
      joinSeatsStandingTruth(
        { kind: 'denied', reasonClass: 'MEMBERS_DENIED' },
        { kind: 'denied', reasonClass: 'APPROVALS_DENIED' },
      ),
    ).toEqual({
      kind: 'denied',
      reasonClass: 'members:MEMBERS_DENIED,seating-relay:APPROVALS_DENIED',
    });
    expect(
      joinSeatsStandingTruth(
        { kind: 'fetch-failed', message: 'members offline' },
        { kind: 'fetch-failed', message: 'relay offline' },
      ),
    ).toEqual({
      kind: 'fetch-failed',
      message: 'members: members offline seating-relay: relay offline',
    });
  });

  it('uses the oldest complete witness and earns empty only when every included source is empty', () => {
    expect(joinSeatsStandingTruth(membersVerified, relayVerified)).toEqual({
      kind: 'verified',
      at: at('2026-08-06T12:00:00.000Z'),
    });
    expect(
      joinSeatsStandingTruth(
        { kind: 'proven-empty', at: at('2026-08-06T12:00:00.000Z') },
        { kind: 'proven-empty', at: at('2026-08-06T12:10:00.000Z') },
      ),
    ).toEqual({ kind: 'proven-empty', at: at('2026-08-06T12:00:00.000Z') });
    expect(
      joinSeatsStandingTruth(
        membersVerified,
        { kind: 'proven-empty', at: at('2026-08-06T12:10:00.000Z') },
      ).kind,
    ).toBe('verified');
  });

  it('omits an unentitled relay instead of calling it denied or empty', () => {
    expect(
      joinSeatsStandingTruth(membersVerified, { kind: 'denied', reasonClass: 'APPROVALS_DENIED' }, false),
    ).toEqual(membersVerified);
  });

  it('keeps a proven-empty authenticated Members anomaly read-only', () => {
    expect(membersRegisterActionsAvailable(true, membersVerified)).toBe(true);
    expect(
      membersRegisterActionsAvailable(true, {
        kind: 'proven-empty',
        at: at('2026-08-06T12:00:00.000Z'),
      }),
    ).toBe(false);
    expect(
      membersRegisterActionsAvailable(true, {
        kind: 'stale',
        verifiedAt: at('2026-08-06T12:00:00.000Z'),
        message: 'rechecking',
      }),
    ).toBe(false);
  });
});
