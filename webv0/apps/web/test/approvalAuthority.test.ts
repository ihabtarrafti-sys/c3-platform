import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ApprovalSummaryDto } from '@c3web/api-contracts';
import { ApiError } from '../src/api';
import { ApprovalHistorySurface } from '../src/pages/ApprovalDetailPage';
import {
  approvalAuthorityActionOf,
  approvalCapabilityLineOf,
  approvalAuthorityCountsOf,
  approvalAuthorityStageOf,
  approvalDetailTruthOf,
  approvalHistoryTruthOf,
  approvalIdentityRelationOf,
  approvalRequesterActionsAvailable,
  type ApprovalWitnessFacts,
} from '../src/tablework/approvalAuthority';

const witnessedAt = Date.parse('2026-08-06T14:00:00.000Z');

function approval(
  status: ApprovalSummaryDto['status'],
  submittedBy = 'requester@example.com',
): ApprovalSummaryDto {
  const submittedAt = '2026-08-06T12:00:00.000Z';
  return {
    approvalId: `APR-${status}`,
    operationType: 'AddPerson',
    targetPersonId: 'N/A-NEW',
    targetId: null,
    reason: null,
    status,
    submittedBy,
    submittedAt,
    reviewedBy: status === 'Submitted' || status === 'Withdrawn' ? null : 'reviewer@example.com',
    reviewedAt: status === 'Submitted' || status === 'Withdrawn' ? null : '2026-08-06T12:10:00.000Z',
    rejectionReason: status === 'Rejected' ? 'Not approved.' : null,
    executedAt: status === 'Executed' ? '2026-08-06T12:20:00.000Z' : null,
    executionError: status === 'ExecutionFailed' ? 'Downstream refused the change.' : null,
    version: 2,
    editCount: 0,
    revisionOf: null,
    supersededBy: null,
    createdAt: submittedAt,
    updatedAt: submittedAt,
  };
}

function facts<T>(overrides: Partial<ApprovalWitnessFacts<T>> = {}): ApprovalWitnessFacts<T> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    dataUpdatedAt: witnessedAt,
    ...overrides,
  };
}

describe('Authority Relay completion axis', () => {
  it('keeps review, decision, execution, failed execution, and closure structurally distinct', () => {
    const statuses: ApprovalSummaryDto['status'][] = [
      'Submitted',
      'InReview',
      'Approved',
      'ExecutionFailed',
      'Executed',
      'Rejected',
      'Withdrawn',
    ];
    const stages = statuses.map((status) => approvalAuthorityStageOf(approval(status)));

    expect(stages.map((stage) => stage.stage)).toEqual([
      'review',
      'decision',
      'execution',
      'execution-failed',
      'closed',
      'closed',
      'closed',
    ]);
    expect(stages[2]?.headline).toBe('Execution required');
    expect(stages[4]?.headline).toBe('Execution recorded');
    expect(approvalAuthorityCountsOf(statuses.map((status) => approval(status)))).toEqual({
      review: 1,
      decision: 1,
      execution: 1,
      executionFailed: 1,
      closed: 3,
    });
  });
});

describe('approval authority integrity', () => {
  const reviewer = {
    identity: 'reviewer@example.com',
    canReviewApproval: true,
    canExecuteApproval: false,
  };

  it('uses canonical self-review semantics and fails closed when identity is indeterminate', () => {
    expect(approvalIdentityRelationOf(' Requester@Example.com ', 'requester@example.com')).toBe('self');
    expect(approvalIdentityRelationOf('not-an-identity', 'requester@example.com')).toBe('indeterminate');
    expect(approvalIdentityRelationOf('reviewer@example.com', 'requester@example.com')).toBe('distinct');

    expect(
      approvalAuthorityActionOf(
        approval('InReview', 'requester@example.com'),
        { ...reviewer, identity: ' REQUESTER@example.com ' },
        true,
      ),
    ).toMatchObject({ relation: 'self', action: null, reason: 'self' });
    expect(
      approvalAuthorityActionOf(
        approval('InReview'),
        { ...reviewer, identity: 'not-an-identity' },
        true,
      ),
    ).toMatchObject({ relation: 'indeterminate', action: null, reason: 'indeterminate' });
  });

  it('derives controls only from effective capabilities on a current approval witness', () => {
    expect(approvalAuthorityActionOf(approval('Submitted'), reviewer, true).action).toBe('begin-review');
    expect(approvalAuthorityActionOf(approval('InReview'), reviewer, true).action).toBe('decide');
    expect(
      approvalAuthorityActionOf(
        approval('Approved'),
        { ...reviewer, canReviewApproval: false, canExecuteApproval: true },
        true,
      ).action,
    ).toBe('execute');
    expect(approvalAuthorityActionOf(approval('InReview'), reviewer, false)).toMatchObject({
      action: null,
      reason: 'not-current',
    });
    expect(
      approvalAuthorityActionOf(
        approval('Executed'),
        { ...reviewer, canExecuteApproval: true },
        true,
      ),
    ).toMatchObject({ action: null, reason: 'closed' });
  });

  it('withholds requester edit, revise, withdraw, and resubmit paths on a stale approval version', () => {
    const own = approval('Submitted', 'requester@example.com');
    expect(approvalRequesterActionsAvailable(own, ' REQUESTER@example.com ', true)).toBe(true);
    expect(approvalRequesterActionsAvailable(own, ' REQUESTER@example.com ', false)).toBe(false);
    expect(approvalRequesterActionsAvailable(own, 'reviewer@example.com', true)).toBe(false);
    expect(approvalRequesterActionsAvailable(own, 'not-an-identity', true)).toBe(false);
  });

  it('names every effective capability combination without inferring standing from role', () => {
    expect(
      approvalCapabilityLineOf({
        canSubmitApproval: false,
        canReviewApproval: true,
        canExecuteApproval: true,
      }),
    ).toContain('review and execute eligible requests');
    expect(
      approvalCapabilityLineOf({
        canSubmitApproval: true,
        canReviewApproval: true,
        canExecuteApproval: false,
      }),
    ).toContain('does not hold execution standing');
    expect(
      approvalCapabilityLineOf({
        canSubmitApproval: false,
        canReviewApproval: false,
        canExecuteApproval: true,
      }),
    ).toContain('does not hold review standing');
    expect(
      approvalCapabilityLineOf({
        canSubmitApproval: true,
        canReviewApproval: false,
        canExecuteApproval: false,
      }),
    ).toContain('Another authorized person reviews and executes them');
    expect(
      approvalCapabilityLineOf({
        canSubmitApproval: false,
        canReviewApproval: false,
        canExecuteApproval: false,
      }),
    ).toContain('does not hold a review or execution action');
  });
});

describe('approval detail and history witnesses', () => {
  it('revokes cached detail and history on authoritative refusal', () => {
    const refusal = new ApiError(403, 'APPROVALS_REFUSED', 'Not available.');
    expect(
      approvalDetailTruthOf(facts({ data: { approval: approval('InReview') }, error: refusal })),
    ).toEqual({ kind: 'denied', reasonClass: 'APPROVALS_REFUSED' });
    expect(
      approvalHistoryTruthOf(facts({ data: { events: [{}] }, error: refusal })),
    ).toEqual({ kind: 'denied', reasonClass: 'APPROVALS_REFUSED' });
  });

  it('distinguishes loading, verified empty, failure, and stale history', () => {
    expect(approvalHistoryTruthOf(facts<{ events: unknown[] }>({ isLoading: true })).kind).toBe('loading');
    expect(approvalHistoryTruthOf(facts({ data: { events: [] } }))).toEqual({
      kind: 'proven-empty',
      at: new Date(witnessedAt),
    });
    expect(approvalHistoryTruthOf(facts<{ events: unknown[] }>({ error: new Error('offline') }))).toEqual({
      kind: 'fetch-failed',
      message: 'offline',
    });
    expect(
      approvalHistoryTruthOf(facts({ data: { events: [{}] }, isFetching: true })),
    ).toEqual({
      kind: 'stale',
      verifiedAt: new Date(witnessedAt),
      message: 'The approval history is being checked again.',
    });
  });

  it('renders no current empty-history claim during loading, failure, or stale revalidation', () => {
    const loading = renderToStaticMarkup(
      createElement(ApprovalHistorySurface, {
        state: { kind: 'loading' },
        entries: [],
        error: null,
      }),
    );
    const failed = renderToStaticMarkup(
      createElement(ApprovalHistorySurface, {
        state: { kind: 'fetch-failed', message: 'offline' },
        entries: [],
        error: new Error('offline'),
      }),
    );
    const stale = renderToStaticMarkup(
      createElement(ApprovalHistorySurface, {
        state: {
          kind: 'stale',
          verifiedAt: new Date(witnessedAt),
          message: 'Checking again.',
        },
        entries: [],
        error: null,
        rechecking: true,
      }),
    );
    const empty = renderToStaticMarkup(
      createElement(ApprovalHistorySurface, {
        state: { kind: 'proven-empty', at: new Date(witnessedAt) },
        entries: [],
        error: null,
      }),
    );

    expect(loading).toContain('data-truth="loading"');
    expect(loading).not.toContain('No events');
    expect(failed).toContain('data-truth="fetch-failed"');
    expect(failed).not.toContain('No events');
    expect(stale).toContain('data-truth="stale"');
    expect(stale).toContain('new check is in progress');
    expect(stale).toContain('last verified history contained no events');
    expect(stale).toContain('does not grant or veto authority');
    expect(stale).not.toContain('successfully witnessed history');
    expect(empty).toContain('data-truth="proven-empty"');
    expect(empty).toContain('No events are present in this successfully witnessed history.');
  });

  it('says when stale history is the result of a failed refresh rather than an in-flight check', () => {
    const markup = renderToStaticMarkup(
      createElement(ApprovalHistorySurface, {
        state: {
          kind: 'stale',
          verifiedAt: new Date(witnessedAt),
          message: 'network unavailable',
        },
        entries: [],
        error: new Error('network unavailable'),
        rechecking: false,
      }),
    );

    expect(markup).toContain('latest check failed: network unavailable');
    expect(markup).not.toContain('new check is in progress');
    expect(markup).not.toContain('successfully witnessed history');
  });

  it('renders actor provenance only from a verified event witness', () => {
    const markup = renderToStaticMarkup(
      createElement(ApprovalHistorySurface, {
        state: { kind: 'verified', at: new Date(witnessedAt) },
        entries: [
          {
            at: '2026-08-06T12:20:00.000Z',
            label: 'Approved → Executed',
            actor: 'executor@example.com',
            detail: 'Execution completed.',
          },
        ],
        error: null,
      }),
    );

    expect(markup).toContain('data-truth="verified"');
    expect(markup).toContain('executor@example.com');
    expect(markup).toContain('Approved → Executed');
  });
});
