/**
 * services/errors.ts
 *
 * Shared domain error classes for C3 service operations.
 *
 * Sprint 19 Phase 2: Added InvalidTransitionError for journey lifecycle
 * management. This error is thrown by both the Mock and SharePoint journey
 * services when a caller requests a transition that is invalid for the
 * journey's current status (e.g. completing an already-Completed journey).
 *
 * Error classes for the ADR-013 governance approval execution flow
 * (DuplicateJourneyError, PayloadValidationError, PartialExecutionError)
 * remain co-located with useExecuteApproval.ts — they are specific to that
 * hook's five-step execution sequence and do not apply to the service layer.
 */

import type { JourneyStatus, KitStatus } from '@c3/types';
import { validKitTransitions } from '@c3/utils/kitLifecycle';

// ---------------------------------------------------------------------------
// InvalidTransitionError
// ---------------------------------------------------------------------------

/**
 * Thrown when a lifecycle transition is requested on a Journey whose current
 * status does not permit that operation.
 *
 * Valid transitions:
 *   Active    → Completed  (completeJourney)
 *   Active    → Suspended  (suspendJourney)
 *   Active    → Cancelled  (cancelJourney)
 *   Suspended → Active     (resumeJourney)
 *   Suspended → Cancelled  (cancelJourney)
 *
 * Any other combination throws this error. The service layer validates the
 * transition server-side (after fetching current status from SharePoint) so
 * the guard is authoritative regardless of UI state.
 */
export class InvalidTransitionError extends Error {
  override readonly name = 'InvalidTransitionError';

  constructor(
    public readonly journeyId: string,
    public readonly currentStatus: JourneyStatus,
    public readonly attemptedAction: 'complete' | 'suspend' | 'resume' | 'cancel',
  ) {
    super(
      `[C3/Journey] Cannot ${attemptedAction} journey ${journeyId}: ` +
      `current status is '${currentStatus}'. ` +
      `Valid transitions from '${currentStatus}': ` +
      `${InvalidTransitionError.allowedActionsFor(currentStatus).join(', ') || 'none'}.`,
    );
  }

  /** Human-readable list of allowed actions for a given status. */
  static allowedActionsFor(
    status: JourneyStatus,
  ): Array<'complete' | 'suspend' | 'resume' | 'cancel'> {
    switch (status) {
      case 'Active':    return ['complete', 'suspend', 'cancel'];
      case 'Suspended': return ['resume', 'cancel'];
      case 'Completed': return [];
      case 'Cancelled': return [];
    }
  }
}

// ---------------------------------------------------------------------------
// S29A — logistics write error classes (ADR-013 Addendum: Mission Kit
// Logistics Exemption). Thrown by Mock and SharePoint services; surfaced to
// operators via toasts — no silent mutation failures.
// ---------------------------------------------------------------------------

/** The row identified by the canonical compound key does not exist (or is inactive). */
export class RowNotFoundError extends Error {
  override readonly name = 'RowNotFoundError';
  constructor(list: string, identity: string) {
    super(`[C3] No active row found in ${list} for ${identity}. Refresh and verify the record still exists.`);
  }
}

/** More than one active row matched a compound key that must be unique. NO write occurs. */
export class DataIntegrityError extends Error {
  override readonly name = 'DataIntegrityError';
  constructor(list: string, identity: string, count: number) {
    super(
      `[C3] Data integrity: ${count} active rows in ${list} match ${identity} — expected exactly one. ` +
      `No write performed. Clean up the duplicates in SharePoint before retrying.`,
    );
  }
}

/** Another operator changed the row between read and write (HTTP 412). */
export class ConcurrencyError extends Error {
  override readonly name = 'ConcurrencyError';
  constructor(identity: string) {
    super(
      `[C3] Another operator changed ${identity} while you were editing. ` +
      `Refresh to load the latest state, then retry.`,
    );
  }
}

/** An active row with the same compound identity already exists. */
export class DuplicateKitAssignmentError extends Error {
  override readonly name = 'DuplicateKitAssignmentError';
  constructor(identity: string) {
    super(`[C3] A kit assignment already exists for ${identity}. Use a different AssignmentKey or update the existing item.`);
  }
}

/** The SharePoint list ACL denied the write (HTTP 403). */
export class WritePermissionError extends Error {
  override readonly name = 'WritePermissionError';
  constructor(list: string) {
    super(`[C3] SharePoint denied the write to ${list}. Your account may lack Edit permission on this list — contact the platform owner.`);
  }
}

/** The person is not an active participant of the mission (kit creation guard). */
export class ParticipantNotActiveError extends Error {
  override readonly name = 'ParticipantNotActiveError';
  constructor(missionId: string, personId: string) {
    super(`[C3] ${personId} is not an active participant of ${missionId}. Kit can only be assigned to active mission participants.`);
  }
}

// ---------------------------------------------------------------------------
// S29B — governed participant membership error classes
// ---------------------------------------------------------------------------

/** An ACTIVE participant row already exists and conflicts with the requested add. */
export class ParticipantConflictError extends Error {
  override readonly name = 'ParticipantConflictError';
  constructor(missionId: string, personId: string) {
    super(
      `[C3] An active participant row for ${personId} on ${missionId} exists with DIFFERENT ` +
      `fields than the approved request. No write performed. Reconcile the existing row ` +
      `(or submit a matching request) before retrying.`,
    );
  }
}

/** An active participant row already exists (duplicate add at submission time). */
export class DuplicateParticipantError extends Error {
  override readonly name = 'DuplicateParticipantError';
  constructor(missionId: string, personId: string) {
    super(`[C3] ${personId} is already an active participant of ${missionId}.`);
  }
}

/** Removal blocked: active kit assignments still exist for the person/mission. */
export class ActiveKitDependencyError extends Error {
  override readonly name = 'ActiveKitDependencyError';
  constructor(missionId: string, personId: string, count: number) {
    super(
      `[C3] Cannot remove ${personId} from ${missionId}: ${count} active kit assignment` +
      `${count !== 1 ? 's' : ''} exist${count === 1 ? 's' : ''}. Deactivate the kit items first.`,
    );
  }
}

/** A Submitted/InReview/Approved request for the same operation+mission+person already exists. */
export class DuplicatePendingRequestError extends Error {
  override readonly name = 'DuplicatePendingRequestError';
  constructor(operation: string, missionId: string, personId: string, approvalTitle: string) {
    super(
      `[C3] A ${operation} request for ${personId} on ${missionId} is already pending ` +
      `(${approvalTitle}). Wait for it to be executed or rejected before submitting another.`,
    );
  }
}

/** A kit status transition not permitted by the approved matrix. */
export class InvalidKitTransitionError extends Error {
  override readonly name = 'InvalidKitTransitionError';
  constructor(identity: string, from: KitStatus, to: KitStatus) {
    super(
      `[C3] Cannot move ${identity} from '${from}' to '${to}'. ` +
      `Valid transitions from '${from}': ${validKitTransitions(from).join(', ') || 'none'}.`,
    );
  }
}
