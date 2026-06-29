/**
 * MockApprovalsService.ts
 *
 * In-memory mock implementation of IApprovalsService.
 *
 * Sprint 18 Phase 2B — createApproval is live (synthetic APR-XXXX sequence).
 * listApprovals, getApproval, patchApprovalStatus are Phase 3 stubs that throw.
 *
 * Gate-free: mock submissions are always accepted without auth or role checks.
 * This matches the ADR-013 constraint that the mock is gate-free (constraint #9).
 *
 * SubmittedBy is stamped from currentUserLoginName supplied at factory creation —
 * the caller does not supply identity fields.
 */

import type {
  IApprovalsService,
  CreateApprovalRequest,
  CreateApprovalResult,
} from '../interfaces/IApprovalsService';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

const PREFIX = '[C3/Approvals/Mock]';

// In-memory store — reset between module evaluations (hot reload aware).
let approvalStore: C3Approval[] = [];
let nextApprovalIndex = 1;

export const createMockApprovalsService = (
  currentUserLoginName: string,
): IApprovalsService => ({

  async createApproval(req: CreateApprovalRequest): Promise<CreateApprovalResult> {
    const title = `APR-${String(nextApprovalIndex).padStart(4, '0')}`;
    const id    = nextApprovalIndex;
    nextApprovalIndex++;

    const approval: C3Approval = {
      id,
      title,
      operationType:   req.operationType,
      targetId:        req.targetId,
      targetPersonId:  req.targetPersonId,
      submittedBy:     currentUserLoginName,
      submittedAt:     new Date().toISOString(),
      approvalStatus:  'Submitted',
      reviewedBy:      undefined,
      reviewedAt:      undefined,
      executedAt:      undefined,
      executionError:  undefined,
      delegatedBy:     undefined,
      delegateTo:      undefined,
      reason:          req.reason,
      rejectionReason: undefined,
      payload:         req.payload,
    };

    approvalStore = [...approvalStore, approval];

    console.info(`${PREFIX} createApproval: created ${title} for ${req.targetPersonId}`);

    return { approvalId: id, title, status: 'Submitted' };
  },

  async listApprovals(_filter?: Record<string, unknown>): Promise<never[]> {
    console.warn(`${PREFIX} listApprovals: not implemented — Phase 3`);
    throw new Error(`${PREFIX} listApprovals: not implemented`);
  },

  async getApproval(_id: number): Promise<null> {
    console.warn(`${PREFIX} getApproval: not implemented — Phase 3`);
    throw new Error(`${PREFIX} getApproval: not implemented`);
  },

  async patchApprovalStatus(_id: number, _update: Record<string, unknown>): Promise<never> {
    console.warn(`${PREFIX} patchApprovalStatus: not implemented — Phase 3`);
    throw new Error(`${PREFIX} patchApprovalStatus: not implemented`);
  },
});
