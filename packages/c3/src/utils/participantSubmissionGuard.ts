/**
 * participantSubmissionGuard.ts — Sprint 33 Correction Set D.
 *
 * PROVEN DEFECT (hosted, APR-0066): while TR/2026/007 + PER-0025 was already
 * ACTIVE, Operations could submit another AddMissionParticipant approval with
 * differing values. The approval entered the queue and only failed at
 * execution (ParticipantConflictError). The execution guard protected the
 * data, but the request was knowably impossible BEFORE submission.
 *
 * This module owns the SUBMISSION-time decision. It is pure and driven only
 * by the authoritative membership-state rows for the EXACT canonical
 * MissionID + PersonID pair (including inactive historical rows — absence
 * must never be inferred from an active-only query):
 *
 *   0 rows              → allow-create        (new governed add)
 *   1 inactive row      → allow-reactivation  (governed reactivation)
 *   1 active row        → refuse-active       (NO approval; identical or
 *                          differing fields both refuse — differing values
 *                          are NOT an update: UpdateMissionParticipant is
 *                          deferred)
 *   >1 rows             → fail-integrity      (fail closed, NO approval)
 *
 * Execution-time checks in the services remain the authoritative
 * race/concurrency boundary if state changes after submission.
 */

export interface ParticipantMembershipState {
  isActive: boolean;
}

export type ParticipantSubmissionDecision =
  | { kind: 'allow-create' }
  | { kind: 'allow-reactivation' }
  | { kind: 'refuse-active' }
  | { kind: 'fail-integrity'; rowCount: number };

/** Field-independent by construction: the decision sees ONLY row activity
 *  states, so identical vs differing proposed values cannot change it. */
export function decideParticipantSubmission(
  rows: ParticipantMembershipState[],
): ParticipantSubmissionDecision {
  if (rows.length === 0) return { kind: 'allow-create' };
  if (rows.length > 1) return { kind: 'fail-integrity', rowCount: rows.length };
  return rows[0].isActive ? { kind: 'refuse-active' } : { kind: 'allow-reactivation' };
}

/** Thrown at SUBMISSION time when the person is already an active participant
 *  on the mission. Truthful and update-honest: differing role/external
 *  code/per-diem must not be presented as an update (deferred feature). */
export class ParticipantAlreadyActiveError extends Error {
  override readonly name = 'ParticipantAlreadyActiveError';
  constructor(missionId: string, personId: string) {
    super(
      `${personId} is already an active participant on ${missionId} — no request was submitted. ` +
      `Changing an active participant's role, external code, or per-diem is not yet supported ` +
      `(UpdateMissionParticipant is deferred). To change membership, submit a governed removal first.`,
    );
  }
}

/** Thrown when more than one historical row exists for the exact pair —
 *  a data-integrity conflict; fail closed, create no approval. */
export class ParticipantHistoryIntegrityError extends Error {
  override readonly name = 'ParticipantHistoryIntegrityError';
  constructor(missionId: string, personId: string, rowCount: number) {
    super(
      `Data integrity conflict: ${rowCount} participant rows exist for ${personId} on ` +
      `${missionId} (expected at most one). No request was submitted — contact an administrator.`,
    );
  }
}
