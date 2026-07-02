/**
 * useSubmitCredentialApproval.ts
 *
 * Mode-branching hook for submitting an Add Credential action.
 *
 * Mock mode  -> calls useAddCredential().mutateAsync() -- direct credential creation,
 *              preserving the pre-Phase-3 behaviour exactly. TanStack cache
 *              invalidation (person.credentials + credentials.all) fires as normal.
 *
 * SharePoint mode -> calls useApprovalsService().createApproval() -- creates one
 *              C3Approvals row (OperationType: AddCredential, ApprovalStatus: Submitted).
 *              No C3Credentials row is created at submission time.
 *              Credential creation is deferred to execution (owner Approve -> Execute).
 *
 * Both inner hooks (useAddCredential, useApprovalsService) are always called
 * unconditionally -- React's rules of hooks prohibit conditional hook calls.
 * The runtime branch happens inside submitAsync, not at hook instantiation.
 *
 * isPending is managed via local useState. useAddCredential exposes its own
 * isPending from useMutation, but we need a single flag that covers both paths.
 * The finally block guarantees the flag clears even if the inner call throws.
 *
 * Sprint 20 Phase 3.
 * See: docs/adr/ADR-013-Governance-Approval-Pattern.md
 * See: packages/c3/src/hooks/useSubmitJourneyApproval.ts (pattern reference)
 */

import { useState } from 'react';

import { useApp } from '@c3/hooks/useApp';
import { useApprovalsService } from '@c3/hooks/useApprovalsService';
import { useAddCredential } from '@c3/hooks/useAddCredential';
import type { AddCredentialApprovalPayload } from '@c3/services/interfaces/approvalPayloads';
import type { Credential, CreateCredentialInput } from '@c3/types';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type CredentialSubmissionOutcome =
  | {
      /** Mock DSM: credential was created directly. */
      mode: 'direct';
      credential: Credential;
    }
  | {
      /**
       * SP DSM: an approval record was submitted.
       * No credential row exists yet -- it is created at execution time.
       */
      mode: 'approval';
      approvalTitle: string;
      approvalId: number;
    };

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export const useSubmitCredentialApproval = () => {
  const { config }       = useApp();
  const addCredential    = useAddCredential();          // always called (rules of hooks)
  const approvalsService = useApprovalsService();       // always called

  const [isPending, setIsPending] = useState(false);

  /**
   * Submit an Add Credential action.
   *
   * Mock DSM: creates the credential directly (existing path, unchanged).
   * SP DSM:   submits an AddCredential approval. No credential row created.
   *
   * Throws on failure in both modes -- callers (AddCredentialPanel) catch
   * and show error toasts.
   */
  const submitAsync = async (
    input: CreateCredentialInput,
  ): Promise<CredentialSubmissionOutcome> => {
    setIsPending(true);
    try {
      if (config.dataSourceMode !== 'sharepoint') {
        // -- Mock / dev path --
        // Direct credential creation. Unchanged from pre-Phase-3 behaviour.
        // Cache invalidation (person.credentials + credentials.all) fires via
        // useAddCredential.onSuccess as before.
        const credential = await addCredential.mutateAsync(input);
        return { mode: 'direct', credential };
      }

      // -- SharePoint / approval path --
      // Submit an AddCredential approval intent only.
      // NO C3Credentials write occurs here.
      // Credential creation is deferred to execution time.
      const payload: AddCredentialApprovalPayload = {
        operationType:          'AddCredential',
        holderPersonId:         input.HolderPersonID,
        credentialType:         input.Type,           // CredentialType union -> string in payload
        referenceNumber:        input.ReferenceNumber,
        issuedBy:               input.IssuedBy,
        issuedDate:             input.IssuedDate,
        expiryDate:             input.ExpiryDate,
        validFromDate:          input.ValidFromDate,
        subType:                input.SubType,
        notes:                  input.Notes,
        supersedesCredentialId: input.SupersedesCredentialID,
      };

      const result = await approvalsService.createApproval({
        operationType:  'AddCredential',
        targetPersonId: input.HolderPersonID,
        reason: `Add ${input.Type} credential for ${input.HolderPersonID}`,
        payload: JSON.stringify(payload),
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
