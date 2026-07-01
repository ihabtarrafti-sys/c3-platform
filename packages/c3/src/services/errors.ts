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

import type { JourneyStatus } from '@c3/types';

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
