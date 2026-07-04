/**
 * useSubmitJourneyApproval.ts
 *
 * Mode-branching hook for submitting a Start Onboarding Journey action.
 *
 * Mock mode  -> calls useInitiateJourney().mutateAsync() -- direct journey creation,
 *              unchanged from pre-Phase-3A behaviour.
 *
 * SharePoint mode -> calls useApprovalsService().createApproval() -- creates one
 *              C3Approvals row (ApprovalStatus: Submitted). No C3Journeys row
 *              is created. Journey creation is deferred to Phase 4 (execution).
 *
 * Both inner hooks (useInitiateJourney, useApprovalsService) are always called
 * unconditionally -- React's rules of hooks prohibit conditional hook calls.
 * The runtime branch happens inside submitAsync, not at hook instantiation.
 *
 * isPending is managed via local useState. useInitiateJourney exposes its own
 * isPending from useMutation, but we need a single flag that covers both paths.
 * The finally block guarantees the flag clears even if the inner call throws.
 *
 * Sprint 18 Phase 3A.
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useApp } from '@c3/hooks/useApp';
import { useApprovalsService } from '@c3/hooks/useApprovalsService';
import { useInitiateJourney } from '@c3/hooks/useInitiateJourney';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { InitiateJourneyApprovalPayload } from '@c3/services/interfaces/approvalPayloads';
import type { Journey, ObligationAssignment } from '@c3/types';

// ---------------------------------------------------------------------------
// Input / Result types
// ---------------------------------------------------------------------------

export interface SubmitJourneyApprovalInput {
  /** Canonical PER-XXXX PersonID. */
  personId: string;
  /** Journey type. Only 'Onboarding' is produced in Sprint 18. */
  journeyType: 'Onboarding';
  /** Required -- maps to Journey.InitiationReason and Approval.Reason. */
  initiationReason: string;
  /** Governance owner name or email. */
  assignedTo: string;
  /** Optional operational notes. */
  notes?: string;
  /** MissionID when opened from a mission-scoped gap. */
  missionId?: string;
  /** Per-obligation ownership declarations. May be empty array. */
  obligationAssignments: ObligationAssignment[];
}

export type SubmissionOutcome =
  | { mode: 'direct';   journey: Journey }
  | { mode: 'approval'; approvalTitle: string; approvalId: number };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useSubmitJourneyApproval = () => {
  const { config, currentUser } = useApp();
  const initiateJourney = useInitiateJourney();
  const approvalsService = useApprovalsService();
  const queryClient = useQueryClient();

  const [isPending, setIsPending] = useState(false);

  const submitAsync = async (input: SubmitJourneyApprovalInput): Promise<SubmissionOutcome> => {
    setIsPending(true);
    try {
      if (config.dataSourceMode !== 'sharepoint') {
        // -- Mock / dev path --
        // Direct journey creation. Unchanged from pre-Phase-3A behaviour.
        const journey = await initiateJourney.mutateAsync({
          PersonID:         input.personId,
          Type:             input.journeyType,
          InitiatedBy:      currentUser.displayName,
          AssignedTo:       input.assignedTo,
          InitiationReason: input.initiationReason,
          Notes:            input.notes,
          MissionID:        input.missionId,
          obligationAssignments:
            input.obligationAssignments.length > 0
              ? input.obligationAssignments
              : undefined,
        });
        return { mode: 'direct', journey };
      }

      // -- SharePoint / approval path --
      // Submit an approval intent only. NO C3Journeys write occurs here.
      // Journey creation is deferred to execution time (Phase 4).
      const payload: InitiateJourneyApprovalPayload = {
        operationType:        'InitiateJourney',
        personId:             input.personId,
        journeyType:          input.journeyType,
        initiatedBy:          currentUser.loginName,  // claims format; durable audit identity
        initiationReason:     input.initiationReason,
        assignedTo:           input.assignedTo,
        notes:                input.notes || undefined,
        missionId:            input.missionId,
        obligationAssignments: input.obligationAssignments,
      };

      const result = await approvalsService.createApproval({
        operationType:  'InitiateJourney',
        targetPersonId: input.personId,
        reason:         input.initiationReason,
        payload:        JSON.stringify(payload),
      });

      // S31: refresh every approval surface (inbox, pending chips, person
      // history) immediately — the new row must not wait for the 30s poll.
      void queryClient.invalidateQueries({ queryKey: queryKeys.approvals.all() });

      return {
        mode:          'approval',
        approvalTitle: result.title,
        approvalId:    result.approvalId,
      };
    } finally {
      setIsPending(false);
    }
  };

  return { submitAsync, isPending };
};
