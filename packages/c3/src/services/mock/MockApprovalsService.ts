/**
 * MockApprovalsService.ts
 *
 * In-memory mock implementation of IApprovalsService.
 *
 * Sprint 18 Phase 2B: createApproval live.
 * Sprint 18 Phase 3B: listApprovals and patchApprovalStatus live.
 * Sprint 18 Phase 4A: stampExecution live.
 *
 * Gate-free creation: mock submissions are always accepted (ADR-013 constraint #9).
 * Self-approval: enforced in patchApprovalStatus -- throws if ReviewedBy === SubmittedBy.
 *
 * SubmittedBy / ReviewedBy are stamped from currentUserLoginName supplied at
 * factory creation -- callers do not supply identity fields.
 */

import type {
  IApprovalsService,
  CreateApprovalRequest,
  CreateApprovalResult,
  PatchApprovalStatusRequest,
  StampExecutionRequest,
} from '../interfaces/IApprovalsService';
import type { C3Approval } from '@c3/utils/spApprovalMapper';

const PREFIX = '[C3/Approvals/Mock]';

// In-memory store -- reset between module evaluations (hot reload aware).
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

  async listApprovals(filter?: { status?: string[] }): Promise<C3Approval[]> {
    const statuses: string[] = filter?.status ?? ['Submitted', 'InReview'];
    const results = approvalStore.filter(a => statuses.includes(a.approvalStatus));
    console.info(`${PREFIX} listApprovals: returning ${results.length} records (filter: ${statuses.join(', ')})`);
    return [...results];
  },

  async getApproval(_id: number): Promise<null> {
    console.warn(`${PREFIX} getApproval: not implemented -- Phase 4`);
    throw new Error(`${PREFIX} getApproval: not implemented`);
  },

  async patchApprovalStatus(id: number, req: PatchApprovalStatusRequest): Promise<void> {
    const idx = approvalStore.findIndex(a => a.id === id);
    if (idx === -1) {
      throw new Error(`${PREFIX} patchApprovalStatus: record ${id} not found`);
    }

    const existing = approvalStore[idx];

    // Self-approval enforcement (ADR-013)
    if (currentUserLoginName && currentUserLoginName === existing.submittedBy) {
      throw new Error(`[C3/Approvals] Self-approval not permitted (ADR-013). ReviewedBy must differ from SubmittedBy.`);
    }

    // Rejected requires a rejection reason
    if (req.newStatus === 'Rejected' && !req.rejectionReason?.trim()) {
      throw new Error(`${PREFIX} patchApprovalStatus: rejectionReason is required when rejecting`);
    }

    const now = new Date().toISOString();

    approvalStore = [
      ...approvalStore.slice(0, idx),
      {
        ...existing,
        approvalStatus:  req.newStatus,
        reviewedBy:      currentUserLoginName,
        reviewedAt:      now,
        rejectionReason: req.newStatus === 'Rejected' ? (req.rejectionReason ?? '') : existing.rejectionReason,
      },
      ...approvalStore.slice(idx + 1),
    ];

    console.info(`${PREFIX} patchApprovalStatus: ${existing.title} (ID ${id}) -> ${req.newStatus}`);
  },

  async stampExecution(id: number, req: StampExecutionRequest): Promise<void> {
    const idx = approvalStore.findIndex(a => a.id === id);
    if (idx === -1) {
      throw new Error(`${PREFIX} stampExecution: record ${id} not found`);
    }

    const existing = approvalStore[idx];

    let patch: Partial<C3Approval>;

    if (req.newStatus === 'Executed') {
      // Executed: stamp ExecutedAt, clear ExecutionError.
      // If targetPersonId is supplied (AddPerson path), backfill targetPersonId
      // in the mock record -- mirrors the SP MERGE behaviour.
      patch = {
        approvalStatus: 'Executed',
        executedAt:     req.executedAt,
        executionError: undefined,
        ...(req.targetPersonId ? { targetPersonId: req.targetPersonId } : {}),
      };
    } else {
      // ExecutionFailed: stamp ExecutionError, do NOT set ExecutedAt
      patch = {
        approvalStatus: 'ExecutionFailed',
        executionError: req.executionError,
        executedAt:     undefined,
      };
    }

    approvalStore = [
      ...approvalStore.slice(0, idx),
      { ...existing, ...patch },
      ...approvalStore.slice(idx + 1),
    ];

    console.info(`${PREFIX} stampExecution: ${existing.title} (ID ${id}) -> ${req.newStatus}`);
  },
});
