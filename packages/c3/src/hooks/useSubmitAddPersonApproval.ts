/**
 * useSubmitAddPersonApproval.ts
 *
 * Mode-branching hook for submitting an Add Person action.
 *
 * Mock DSM  -> calls personService.createPerson() directly -- person is
 *              immediately available in the mock People list. Cache invalidated.
 *
 * SP DSM    -> submits a C3Approvals record (OperationType: AddPerson,
 *              ApprovalStatus: Submitted). No C3People row is created at
 *              submission time. Person creation is deferred to execution
 *              (owner Approve -> Execute).
 *
 * Both inner services (usePersonService, useApprovalsService) are always called
 * unconditionally -- React's rules of hooks prohibit conditional hook calls.
 * The runtime branch happens inside submitAsync, not at hook instantiation.
 *
 * isPending is managed via local useState. The finally block guarantees the
 * flag clears even if the inner call throws.
 *
 * Pattern follows useSubmitCredentialApproval (Sprint 20 Phase 3) and
 * useSubmitDeactivationApproval (Sprint 23 Phase 1).
 *
 * Sprint 25.
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 * See: packages/c3/src/hooks/useSubmitCredentialApproval.ts (reference pattern)
 */

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useApp } from '@c3/hooks/useApp';
import { useApprovalsService } from '@c3/hooks/useApprovalsService';
import { usePersonService } from '@c3/hooks/usePersonService';
import { queryKeys } from '@c3/hooks/queryKeys';
import type { AddPersonApprovalPayload } from '@c3/services/interfaces/approvalPayloads';
import type { CreatePersonInput, Person } from '@c3/types';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export type AddPersonInput = CreatePersonInput;

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type AddPersonSubmissionOutcome =
  | {
      /** Mock DSM: person was created directly. */
      mode: 'direct';
      person: Person;
    }
  | {
      /**
       * SP DSM: an AddPerson approval was submitted.
       * No C3People row exists yet -- it is created at execution time.
       */
      mode: 'approval';
      approvalTitle: string;
      approvalId: number;
    };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useSubmitAddPersonApproval = () => {
  const { config, currentUser } = useApp();
  const personService           = usePersonService();    // always called (rules of hooks)
  const approvalsService        = useApprovalsService(); // always called
  const queryClient             = useQueryClient();

  const [isPending, setIsPending] = useState(false);

  /**
   * Submit an Add Person action.
   *
   * Mock DSM: creates the person directly; invalidates people.all() so
   *           PeopleWorkspace reflects the new person immediately.
   * SP DSM:   submits an AddPerson approval only. No C3People write.
   *
   * Throws on failure in both modes -- callers (AddPersonPanel) catch and toast.
   */
  const submitAsync = async (
    input: AddPersonInput,
  ): Promise<AddPersonSubmissionOutcome> => {
    setIsPending(true);
    try {
      if (config.dataSourceMode !== 'sharepoint') {
        // -- Mock / dev path --
        // Direct person creation. Person is immediately available.
        const person = await personService.createPerson(input);

        // Invalidate people list so PeopleWorkspace and any summary views refresh.
        void queryClient.invalidateQueries({ queryKey: queryKeys.people.all() });

        return { mode: 'direct', person };
      }

      // -- SharePoint / approval path --
      // Submit an AddPerson approval intent only.
      // NO C3People write occurs here.
      // Person creation (POST -> MERGE PER-XXXX) is deferred to execution time.
      //
      // targetPersonId uses PENDING-ADDPERSON as a placeholder -- the person does
      // not exist yet so no PER-XXXX is available at submission time. The SP list
      // TargetPersonID column requires a non-empty value; an empty string triggers
      // a SharePoint choice validation error. After execution the field is
      // backfilled to the created PER-XXXX via stampExecution targetPersonId option.
      const payload: AddPersonApprovalPayload = {
        operationType:    'AddPerson',
        fullName:         input.FullName,
        ign:              input.IGN,
        nationality:      input.Nationality,
        primaryRole:      input.PrimaryRole,
        personnelCode:    input.PersonnelCode,
        currentTeam:      input.CurrentTeam,
        currentGameTitle: input.CurrentGameTitle,
        primaryDepartment: input.PrimaryDepartment,
        notes:            input.Notes,
        requestedBy:      currentUser.loginName || undefined,
      };

      const result = await approvalsService.createApproval({
        operationType:  'AddPerson',
        targetPersonId: 'PENDING-ADDPERSON',  // placeholder -- backfilled to PER-XXXX at execution
        reason:         `Create new person: ${input.FullName}`,
        payload:        JSON.stringify(payload),
      });

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
