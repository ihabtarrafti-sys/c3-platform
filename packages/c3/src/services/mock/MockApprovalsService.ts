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
  ApprovalQueryOptions,
  ApprovalReadResult,
  IApprovalsService,
  CreateApprovalRequest,
  CreateApprovalResult,
  PatchApprovalStatusRequest,
  StampExecutionRequest,
} from '../interfaces/IApprovalsService';
import {
  ACTIONABLE_STATUSES,
  DEFAULT_TERMINAL_HISTORY_LIMIT,
  PENDING_STATUSES,
  TERMINAL_STATUSES,
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

  // ── S31 semantic reads — identical OBSERVABLE semantics to the SP paged
  //    core (status filtering, Id-desc ordering, windowing, null-on-missing)
  //    with no artificial page simulation: the store is always complete, so
  //    completeness is inherent. Paging mechanics are proven against the REAL
  //    SP service via the injected fetch boundary in the s31 harness. ────────

  async listPendingApprovals(_opts?: ApprovalQueryOptions): Promise<C3Approval[]> {
    return approvalStore
      .filter(a => (PENDING_STATUSES as readonly string[]).includes(a.approvalStatus))
      .sort((a, b) => b.id - a.id);
  },

  async listActionableApprovals(_opts?: ApprovalQueryOptions): Promise<C3Approval[]> {
    return approvalStore
      .filter(a => (ACTIONABLE_STATUSES as readonly string[]).includes(a.approvalStatus))
      .sort((a, b) => b.id - a.id);
  },

  async listApprovalsByPerson(personId: string, _opts?: ApprovalQueryOptions): Promise<C3Approval[]> {
    const trimmed = personId.trim();
    if (!trimmed) return [];
    return approvalStore
      .filter(a => a.targetPersonId === trimmed)
      .sort((a, b) => b.id - a.id);
  },

  async listRecentTerminalApprovals(
    opts?: ApprovalQueryOptions & { limit?: number },
  ): Promise<C3Approval[]> {
    const limit = opts?.limit ?? DEFAULT_TERMINAL_HISTORY_LIMIT;
    return approvalStore
      .filter(a => (TERMINAL_STATUSES as readonly string[]).includes(a.approvalStatus))
      .sort((a, b) => b.id - a.id)
      .slice(0, limit);
  },

  async getApproval(id: number, _opts?: ApprovalQueryOptions): Promise<ApprovalReadResult | null> {
    const found = approvalStore.find(a => a.id === id);
    if (!found) return null;
    // Synthetic etag — mock has no concurrent editors; the value exists so the
    // freshness→update contract exercises the same code path in both DSMs.
    return { approval: { ...found }, etag: `"mock-${id}"` };
  },

  async patchApprovalStatus(id: number, req: PatchApprovalStatusRequest, _etag?: string): Promise<void> {
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

  async stampExecution(id: number, req: StampExecutionRequest, _etag?: string): Promise<void> {
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
