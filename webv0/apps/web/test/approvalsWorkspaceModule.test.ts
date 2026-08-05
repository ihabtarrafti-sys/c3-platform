import { describe, expect, it } from 'vitest';
import type { ApprovalSummaryDto } from '@c3web/api-contracts';
import { ApiError } from '../src/api';
import { approvalsTruthOf, type ApprovalsTruthFacts } from '../src/pages/ApprovalsPage';

const witnessedAt = Date.parse('2026-08-05T08:30:00.000Z');
const oneApproval = {} as ApprovalSummaryDto;

const facts = (overrides: Partial<ApprovalsTruthFacts> = {}): ApprovalsTruthFacts => ({
  canView: true,
  data: undefined,
  error: null,
  isLoading: false,
  isFetching: false,
  dataUpdatedAt: witnessedAt,
  ...overrides,
});

describe('Approvals Workspace OS witness', () => {
  it('derives each of the six truth states without borrowing another window witness', () => {
    expect(approvalsTruthOf(facts({ isLoading: true }))).toEqual({ kind: 'loading' });
    expect(approvalsTruthOf(facts({ data: { approvals: [oneApproval] } }))).toEqual({
      kind: 'verified',
      at: new Date(witnessedAt),
    });
    expect(approvalsTruthOf(facts({ data: { approvals: [] } }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(approvalsTruthOf(facts({ canView: false }))).toEqual({
      kind: 'denied',
      reasonClass: 'APPROVALS_UNAVAILABLE',
    });
    expect(approvalsTruthOf(facts({ error: new Error('offline') }))).toEqual({
      kind: 'fetch-failed',
      message: 'offline',
    });
    expect(
      approvalsTruthOf(facts({ data: { approvals: [oneApproval] }, isFetching: true })),
    ).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'Approvals are being checked again.',
    });
  });

  it.each([401, 403])('revokes cached approvals on authoritative HTTP %s', (status) => {
    expect(
      approvalsTruthOf(
        facts({
          data: { approvals: [oneApproval] },
          error: new ApiError(status, 'APPROVALS_REFUSED', 'Not available.'),
          isFetching: true,
        }),
      ),
    ).toEqual({ kind: 'denied', reasonClass: 'APPROVALS_REFUSED' });
  });

  it('marks a cached empty register stale during revalidation instead of asserting emptiness', () => {
    expect(approvalsTruthOf(facts({ data: { approvals: [] }, isFetching: true })).kind).toBe('stale');
  });
});
