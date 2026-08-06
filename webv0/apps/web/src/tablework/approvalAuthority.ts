import type { ApprovalSummaryDto } from '@c3web/api-contracts';
import { checkSelfReview } from '@c3web/domain';
import { ApiError } from '../api';
import { truthStateOf, type WitnessState } from './TruthPanel';

export type ApprovalAuthorityStage = 'review' | 'decision' | 'execution' | 'execution-failed' | 'closed';

export interface ApprovalAuthorityStageView {
  readonly stage: ApprovalAuthorityStage;
  readonly step: string;
  readonly headline: string;
  readonly detail: string;
}

export interface ApprovalAuthorityCounts {
  readonly review: number;
  readonly decision: number;
  readonly execution: number;
  readonly executionFailed: number;
  readonly closed: number;
}

export type ApprovalIdentityRelation = 'self' | 'distinct' | 'indeterminate';
export type ApprovalAuthorityAction = 'begin-review' | 'decide' | 'execute';

export interface ApprovalAuthorityActor {
  readonly identity: string | null | undefined;
  readonly canReviewApproval: boolean;
  readonly canExecuteApproval: boolean;
}

type ApprovalAuthoritySubject = Pick<ApprovalSummaryDto, 'status' | 'submittedBy'>;

export interface EffectiveApprovalCapabilities {
  readonly canSubmitApproval: boolean;
  readonly canReviewApproval: boolean;
  readonly canExecuteApproval: boolean;
}

export interface ApprovalAuthorityActionView {
  readonly relation: ApprovalIdentityRelation;
  readonly action: ApprovalAuthorityAction | null;
  readonly reason: 'available' | 'self' | 'indeterminate' | 'not-current' | 'no-standing' | 'closed';
}

export interface ApprovalWitnessFacts<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly dataUpdatedAt: number;
}

/**
 * Human-readable standing comes from the effective `/me` capabilities, never
 * from a role name. That matters for bounded approver delegation, which raises
 * review + execute standing without widening the delegate's role disclosure.
 */
export function approvalCapabilityLineOf(capabilities: EffectiveApprovalCapabilities): string {
  const { canSubmitApproval, canReviewApproval, canExecuteApproval } = capabilities;
  if (canReviewApproval && canExecuteApproval) {
    return canSubmitApproval
      ? 'This session can submit, review, and execute eligible requests. Its own submissions still require another person.'
      : 'This session can review and execute eligible requests. Its own submissions still require another person.';
  }
  if (canReviewApproval) {
    return canSubmitApproval
      ? 'This session can submit and review eligible requests, but it does not hold execution standing. Its own submissions still require another person.'
      : 'This session can review eligible requests, but it does not hold execution standing. Its own submissions still require another person.';
  }
  if (canExecuteApproval) {
    return canSubmitApproval
      ? 'This session can submit requests and execute eligible approved requests, but it does not hold review standing. Its own submissions still require another person.'
      : 'This session can execute eligible approved requests, but it does not hold review standing. Its own submissions still require another person.';
  }
  if (canSubmitApproval) {
    return 'This session can submit and withdraw its own requests. Another authorized person reviews and executes them.';
  }
  return 'This session can read this register. It does not hold a review or execution action here.';
}

interface ApprovalHistoryView {
  readonly events: readonly unknown[];
}

/**
 * The register's completion axis. This is deliberately separate from the
 * generic status badge: Approved is a completed DECISION and an outstanding
 * EXECUTION, while Executed is the only status that records execution.
 */
export function approvalAuthorityStageOf(approval: ApprovalSummaryDto): ApprovalAuthorityStageView {
  switch (approval.status) {
    case 'Submitted':
      return {
        stage: 'review',
        step: '01 · Request',
        headline: 'Review required',
        detail: 'No review decision or execution is recorded.',
      };
    case 'InReview':
      return {
        stage: 'decision',
        step: '02 · Review',
        headline: 'Decision required',
        detail: 'Review has started; no approval or rejection is recorded.',
      };
    case 'Approved':
      return {
        stage: 'execution',
        step: '03 · Decision',
        headline: 'Execution required',
        detail: 'The decision is recorded. The approved change has not executed.',
      };
    case 'ExecutionFailed':
      return {
        stage: 'execution-failed',
        step: '04 · Execution',
        headline: 'Execution did not complete',
        detail: 'The decision still stands; execution requires an authorized retry.',
      };
    case 'Executed':
      return {
        stage: 'closed',
        step: '04 · Execution',
        headline: 'Execution recorded',
        detail: 'This request records a completed execution.',
      };
    case 'Rejected':
      return {
        stage: 'closed',
        step: 'Closed · Decision',
        headline: 'Closed without execution',
        detail: 'The request was rejected and did not execute.',
      };
    case 'Withdrawn':
      return {
        stage: 'closed',
        step: 'Closed · Request',
        headline: 'Closed without execution',
        detail: 'The request was withdrawn and did not execute.',
      };
  }
}

export function approvalAuthorityCountsOf(approvals: readonly ApprovalSummaryDto[]): ApprovalAuthorityCounts {
  return approvals.reduce<ApprovalAuthorityCounts>(
    (counts, approval) => {
      const stage = approvalAuthorityStageOf(approval).stage;
      if (stage === 'execution-failed') return { ...counts, executionFailed: counts.executionFailed + 1 };
      return { ...counts, [stage]: counts[stage] + 1 };
    },
    { review: 0, decision: 0, execution: 0, executionFailed: 0, closed: 0 },
  );
}

export function approvalIdentityRelationOf(
  actorIdentity: string | null | undefined,
  submittedBy: string | null | undefined,
): ApprovalIdentityRelation {
  const check = checkSelfReview(actorIdentity, submittedBy);
  if (!check.blocked) return 'distinct';
  return check.reason === 'self' ? 'self' : 'indeterminate';
}

/** Requester-owned mutations also target a specific approval version. */
export function approvalRequesterActionsAvailable(
  approval: Pick<ApprovalSummaryDto, 'submittedBy'>,
  actorIdentity: string | null | undefined,
  currentlyWitnessed: boolean,
): boolean {
  return currentlyWitnessed && approvalIdentityRelationOf(actorIdentity, approval.submittedBy) === 'self';
}

/**
 * Mirrors the server's fail-closed identity decision without replacing it.
 * `currentlyWitnessed` is supplied by the approval-detail truth state. Event
 * history is independent provenance evidence: its availability neither grants
 * nor vetoes authority. A stale approval row remains readable but never
 * advertises a time-sensitive action against an unwitnessed version.
 */
export function approvalAuthorityActionOf(
  approval: ApprovalAuthoritySubject,
  actor: ApprovalAuthorityActor,
  currentlyWitnessed: boolean,
): ApprovalAuthorityActionView {
  const relation = approvalIdentityRelationOf(actor.identity, approval.submittedBy);
  if (!currentlyWitnessed) return { relation, action: null, reason: 'not-current' };
  if (relation === 'self') return { relation, action: null, reason: 'self' };
  if (relation === 'indeterminate') return { relation, action: null, reason: 'indeterminate' };

  if (approval.status === 'Submitted') {
    return actor.canReviewApproval
      ? { relation, action: 'begin-review', reason: 'available' }
      : { relation, action: null, reason: 'no-standing' };
  }
  if (approval.status === 'InReview') {
    return actor.canReviewApproval
      ? { relation, action: 'decide', reason: 'available' }
      : { relation, action: null, reason: 'no-standing' };
  }
  if (approval.status === 'Approved' || approval.status === 'ExecutionFailed') {
    return actor.canExecuteApproval
      ? { relation, action: 'execute', reason: 'available' }
      : { relation, action: null, reason: 'no-standing' };
  }
  return { relation, action: null, reason: 'closed' };
}

function currentQueryTruth<T>(
  facts: ApprovalWitnessFacts<T>,
  isEmpty: (data: T) => boolean,
  recheckingMessage: string,
): WitnessState {
  // A named refusal revokes cached approval content. A detail 404 is an
  // unavailable record, not permission to retain an earlier projection.
  if (facts.error instanceof ApiError && [401, 403, 404].includes(facts.error.status)) {
    return { kind: 'denied', reasonClass: facts.error.code || `HTTP_${facts.error.status}` };
  }

  const base = truthStateOf(
    {
      data: facts.data,
      error: facts.error,
      isLoading: facts.isLoading,
      dataUpdatedAt: facts.dataUpdatedAt,
    },
    isEmpty,
  );
  if (
    facts.isFetching &&
    facts.data !== undefined &&
    (base.kind === 'verified' || base.kind === 'proven-empty')
  ) {
    return {
      kind: 'stale',
      verifiedAt: new Date(facts.dataUpdatedAt > 0 ? facts.dataUpdatedAt : 0),
      message: recheckingMessage,
    };
  }
  return base;
}

export function approvalDetailTruthOf<T>(facts: ApprovalWitnessFacts<T>): WitnessState {
  return currentQueryTruth(facts, () => false, 'The approval record is being checked again.');
}

export function approvalHistoryTruthOf<T extends ApprovalHistoryView>(facts: ApprovalWitnessFacts<T>): WitnessState {
  return currentQueryTruth(facts, (view) => view.events.length === 0, 'The approval history is being checked again.');
}

export function isCurrentApprovalWitness(state: WitnessState): boolean {
  return state.kind === 'verified' || state.kind === 'proven-empty';
}
