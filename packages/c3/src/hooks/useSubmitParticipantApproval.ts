/**
 * useSubmitParticipantApproval.ts
 *
 * Mode-branching submit hooks for the Sprint 29B governed participant
 * membership operations (full ADR-013).
 *
 * Mock DSM  -> direct service write (established mock governance behaviour).
 * SP DSM    -> creates a C3Approvals row (Submitted). NO participant row is
 *              written at submission time — execution happens after owner
 *              approval via useExecuteApproval.
 *
 * Duplicate-pending protection (SP DSM): before creating an approval, the
 * hook lists approvals in Submitted/InReview/Approved and rejects when one
 * already exists for the same operationType + MissionID + PersonID
 * (DuplicatePendingRequestError). This is validated here in the submit flow —
 * the UI pending-chips are affordance only.
 *
 * Identity: TargetPersonID = the real canonical PersonID. Requester identity
 * is stamped by the approvals service from the authenticated session — never
 * taken from form state.
 */

import { useState } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { useApprovalsService } from '@c3/hooks/useApprovalsService';
import { useMissionService } from '@c3/hooks/useMissionService';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@c3/hooks/queryKeys';
import { DuplicatePendingRequestError } from '@c3/services/errors';
import type {
  AddMissionParticipantApprovalPayload,
  RemoveMissionParticipantApprovalPayload,
} from '@c3/services/interfaces/approvalPayloads';
import type { MissionParticipantRole } from '@c3/types';
import {
  PENDING_APPROVAL_STATUSES,
  normalizeExternalCode,
  validateAddParticipantPayload,
  validateRemoveParticipantPayload,
} from '@c3/utils/participantWrites';

// ---------------------------------------------------------------------------
// Outcome types
// ---------------------------------------------------------------------------

export type ParticipantSubmissionOutcome =
  | { mode: 'direct'; outcome: string }
  | { mode: 'approval'; approvalTitle: string; approvalId: number };

export interface AddParticipantSubmission {
  missionId: string;
  personId: string;
  externalCode: string;
  role: MissionParticipantRole;
  perDiemRate?: number;
  reason?: string;
}

export interface RemoveParticipantSubmission {
  missionId: string;
  personId: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Shared pending-duplicate guard
// ---------------------------------------------------------------------------

type PendingOp = 'AddMissionParticipant' | 'RemoveMissionParticipant';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useSubmitParticipantApproval = () => {
  const { config, currentUser } = useApp();
  const approvalsService = useApprovalsService();
  const missionService = useMissionService();
  const qc = useQueryClient();

  const [isPending, setIsPending] = useState(false);

  /** Throws DuplicatePendingRequestError when an in-flight request exists. */
  const assertNoPendingDuplicate = async (
    operationType: PendingOp,
    missionId: string,
    personId: string,
  ): Promise<void> => {
    const pending = await approvalsService.listApprovals({
      status: [...PENDING_APPROVAL_STATUSES],
    });
    for (const approval of pending) {
      if (approval.operationType !== operationType) continue;
      try {
        const p = JSON.parse(approval.payload ?? '') as Record<string, unknown>;
        if (p['missionId'] === missionId && p['personId'] === personId) {
          throw new DuplicatePendingRequestError(operationType, missionId, personId, approval.title);
        }
      } catch (err) {
        if (err instanceof DuplicatePendingRequestError) throw err;
        // Malformed payload on an unrelated approval — ignore.
      }
    }
  };

  const submitAdd = async (input: AddParticipantSubmission): Promise<ParticipantSubmissionOutcome> => {
    setIsPending(true);
    try {
      const errors = validateAddParticipantPayload(input);
      if (errors.length > 0) throw new Error(errors.join(' '));

      if (config.dataSourceMode !== 'sharepoint') {
        const result = await missionService.addMissionParticipant({
          MissionID: input.missionId,
          PersonID: input.personId,
          ExternalCode: input.externalCode,
          Role: input.role,
          PerDiemRate: input.perDiemRate,
          actorLoginName: currentUser.loginName,
        });
        void qc.invalidateQueries({ queryKey: queryKeys.mission.participants(input.missionId) });
        void qc.invalidateQueries({ queryKey: queryKeys.mission.allParticipants() });
        return { mode: 'direct', outcome: result.outcome };
      }

      await assertNoPendingDuplicate('AddMissionParticipant', input.missionId, input.personId);

      const payload: AddMissionParticipantApprovalPayload = {
        operationType: 'AddMissionParticipant',
        missionId: input.missionId,
        personId: input.personId,
        externalCode: normalizeExternalCode(input.externalCode),
        role: input.role,
        perDiemRate: input.perDiemRate,
        reason: input.reason?.trim() || undefined,
      };
      const result = await approvalsService.createApproval({
        operationType: 'AddMissionParticipant',
        targetPersonId: input.personId,
        reason: input.reason?.trim() || `Add ${input.personId} to ${input.missionId} as ${input.role}`,
        payload: JSON.stringify(payload),
      });
      void qc.invalidateQueries({ queryKey: queryKeys.approvals.all() });
      return { mode: 'approval', approvalTitle: result.title, approvalId: result.approvalId };
    } finally {
      setIsPending(false);
    }
  };

  const submitRemove = async (input: RemoveParticipantSubmission): Promise<ParticipantSubmissionOutcome> => {
    setIsPending(true);
    try {
      const errors = validateRemoveParticipantPayload(input);
      if (errors.length > 0) throw new Error(errors.join(' '));

      if (config.dataSourceMode !== 'sharepoint') {
        const result = await missionService.removeMissionParticipant({
          MissionID: input.missionId,
          PersonID: input.personId,
          reason: input.reason,
          actorLoginName: currentUser.loginName,
        });
        void qc.invalidateQueries({ queryKey: queryKeys.mission.participants(input.missionId) });
        void qc.invalidateQueries({ queryKey: queryKeys.mission.allParticipants() });
        return { mode: 'direct', outcome: result.outcome };
      }

      await assertNoPendingDuplicate('RemoveMissionParticipant', input.missionId, input.personId);

      const payload: RemoveMissionParticipantApprovalPayload = {
        operationType: 'RemoveMissionParticipant',
        missionId: input.missionId,
        personId: input.personId,
        reason: input.reason.trim(),
      };
      const result = await approvalsService.createApproval({
        operationType: 'RemoveMissionParticipant',
        targetPersonId: input.personId,
        reason: input.reason.trim(),
        payload: JSON.stringify(payload),
      });
      void qc.invalidateQueries({ queryKey: queryKeys.approvals.all() });
      return { mode: 'approval', approvalTitle: result.title, approvalId: result.approvalId };
    } finally {
      setIsPending(false);
    }
  };

  return { submitAdd, submitRemove, isPending };
};
