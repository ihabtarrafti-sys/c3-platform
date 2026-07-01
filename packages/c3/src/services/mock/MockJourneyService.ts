import type { InitiateJourneyInput, Journey } from '@c3/types';
import type { JourneyType } from '@c3/types';
import type { IJourneyService, JourneyTransitionRequest } from '../interfaces/IJourneyService';
import { canCancel, canComplete, canResume, canSuspend } from '../interfaces/IJourneyService';
import { InvalidTransitionError } from '../errors';

/**
 * Mock journey data — one journey per person in the credential mock set.
 *
 * Journey status reflects what the credential evaluation would produce:
 *   PER-0001 (Abdulaziz) — Active   (Travel AtRisk; journey open with obligation assignment)
 *   PER-0002 (Mohammad)  — Active   (Visa + Emirates ID unsatisfied; journey open, unassigned)
 *   PER-0003 (Diab)      — Completed (all obligations satisfied; journey closed)
 *
 * Sprint 9 (S9-2): JRN-0001 carries an obligationAssignment for Travel, so
 * Abdulaziz's Travel gap renders as Covered in the Situation Room. JRN-0002
 * has no assignments, so Mohammad's gaps remain Routed. Together the two seeds
 * demonstrate all three ownership states across the mock dataset.
 *
 * Sprint 10 (M10-4): initiateJourney now propagates MissionID from input.
 * Existing seeds do not carry MissionID (pre-Mission era journeys).
 *
 * Sprint 19 Phase 2: completeJourney, suspendJourney, resumeJourney, cancelJourney
 * updated to use JourneyTransitionRequest. Transition guards and Notes audit
 * append added. InvalidTransitionError thrown on invalid status.
 */
const MOCK_JOURNEYS: Journey[] = [
  {
    JourneyID: 'JRN-0001',
    PersonID: 'PER-0001',
    Type: 'Onboarding',
    Status: 'Active',
    InitiatedAt: '2026-01-10T09:00:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: 'ops.coordinator@geekay.gg',
    InitiationReason: 'New season roster — UAE operations onboarding.',
    ContractID: 'CTR-0001',
    obligationAssignments: [
      {
        obligationType: 'Travel',
        requirement: 'Travel Authorization',
        assignedTo: 'pro.coordinator@geekay.gg',
        assignedAt: '2026-01-10T09:30:00Z',
      },
    ],
  },
  {
    JourneyID: 'JRN-0002',
    PersonID: 'PER-0002',
    Type: 'Onboarding',
    Status: 'Active',
    InitiatedAt: '2026-02-15T11:30:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: 'ops.coordinator@geekay.gg',
    InitiationReason: 'Transfer window acquisition — onboarding initiated.',
  },
  {
    JourneyID: 'JRN-0003',
    PersonID: 'PER-0003',
    Type: 'Onboarding',
    Status: 'Completed',
    InitiatedAt: '2025-09-01T08:00:00Z',
    InitiatedBy: 'ops.coordinator@geekay.gg',
    AssignedTo: 'ops.coordinator@geekay.gg',
    InitiationReason: 'Pre-season onboarding.',
    ContractID: 'CTR-0003',
    CompletedAt: '2025-10-14T16:00:00Z',
    Notes: 'All credentials verified and filed. Cleared for full operations.',
  },
];

let journeyStore: Journey[] = [...MOCK_JOURNEYS];
let nextJourneyIndex = journeyStore.length + 1;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findJourney(journeyId: string): Journey {
  const existing = journeyStore.find(j => j.JourneyID === journeyId);
  if (!existing) {
    throw new Error(`[MockJourneyService] Journey not found: ${journeyId}`);
  }
  return existing;
}

function updateJourneyInStore(journeyId: string, patch: Partial<Journey>): Journey {
  const existing = findJourney(journeyId);
  const updated: Journey = { ...existing, ...patch };
  journeyStore = journeyStore.map(j => (j.JourneyID === journeyId ? updated : j));
  return updated;
}

/**
 * Builds the structured audit line appended to Notes on each lifecycle transition.
 * Format: "[ISO_TIMESTAMP] ACTION by LOGINNAME[ — reason]"
 */
function buildAuditLine(
  action: 'COMPLETED' | 'SUSPENDED' | 'RESUMED' | 'CANCELLED',
  actorLoginName: string,
  reason?: string,
): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] ${action} by ${actorLoginName}`;
  return reason ? `${base} — ${reason}` : base;
}

/**
 * Appends an audit line to existing Notes, preserving existing content.
 * If Notes is blank, the audit line becomes the entire Notes value.
 */
function appendAuditLine(existingNotes: string | undefined, line: string): string {
  if (!existingNotes || !existingNotes.trim()) return line;
  return `${existingNotes}\n${line}`;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createMockJourneyService = (): IJourneyService => ({
  async getActiveJourney(personId: string, type: JourneyType): Promise<Journey | null> {
    return journeyStore.find(
      j => j.PersonID === personId && j.Type === type && j.Status === 'Active',
    ) ?? null;
  },

  async listJourneysForPerson(personId: string, type?: JourneyType): Promise<Journey[]> {
    return journeyStore
      .filter(j => j.PersonID === personId && (type === undefined || j.Type === type))
      .sort((a, b) => b.InitiatedAt.localeCompare(a.InitiatedAt));
  },

  async initiateJourney(input: InitiateJourneyInput): Promise<Journey> {
    const journey: Journey = {
      JourneyID: `JRN-${String(nextJourneyIndex++).padStart(4, '0')}`,
      PersonID:  input.PersonID,
      Type:      input.Type,
      Status:    'Active',
      InitiatedAt:      new Date().toISOString(),
      InitiatedBy:      input.InitiatedBy,
      AssignedTo:       input.AssignedTo,
      InitiationReason: input.InitiationReason,
      ContractID:       input.ContractID,
      MissionID:        input.MissionID,
      Notes:            input.Notes,
      obligationAssignments:
        input.obligationAssignments && input.obligationAssignments.length > 0
          ? input.obligationAssignments
          : undefined,
    };
    journeyStore = [...journeyStore, journey];
    return journey;
  },

  async completeJourney(req: JourneyTransitionRequest): Promise<Journey> {
    const { journeyId, actorLoginName, reason } = req;
    if (!actorLoginName.trim()) {
      throw new Error('[MockJourneyService] completeJourney: actorLoginName is empty. Refusing to write without an identifiable actor.');
    }
    const existing = findJourney(journeyId);
    if (!canComplete(existing.Status)) {
      throw new InvalidTransitionError(journeyId, existing.Status, 'complete');
    }
    const now = new Date().toISOString();
    const auditLine = buildAuditLine('COMPLETED', actorLoginName, reason);
    return updateJourneyInStore(journeyId, {
      Status:      'Completed',
      CompletedAt: now,
      Notes:       appendAuditLine(existing.Notes, auditLine),
    });
  },

  async suspendJourney(req: JourneyTransitionRequest): Promise<Journey> {
    const { journeyId, actorLoginName, reason } = req;
    if (!actorLoginName.trim()) {
      throw new Error('[MockJourneyService] suspendJourney: actorLoginName is empty. Refusing to write without an identifiable actor.');
    }
    const existing = findJourney(journeyId);
    if (!canSuspend(existing.Status)) {
      throw new InvalidTransitionError(journeyId, existing.Status, 'suspend');
    }
    const auditLine = buildAuditLine('SUSPENDED', actorLoginName, reason);
    return updateJourneyInStore(journeyId, {
      Status: 'Suspended',
      Notes:  appendAuditLine(existing.Notes, auditLine),
    });
  },

  async resumeJourney(req: Omit<JourneyTransitionRequest, 'reason'>): Promise<Journey> {
    const { journeyId, actorLoginName } = req;
    if (!actorLoginName.trim()) {
      throw new Error('[MockJourneyService] resumeJourney: actorLoginName is empty. Refusing to write without an identifiable actor.');
    }
    const existing = findJourney(journeyId);
    if (!canResume(existing.Status)) {
      throw new InvalidTransitionError(journeyId, existing.Status, 'resume');
    }
    const auditLine = buildAuditLine('RESUMED', actorLoginName, undefined);
    return updateJourneyInStore(journeyId, {
      Status: 'Active',
      Notes:  appendAuditLine(existing.Notes, auditLine),
    });
  },

  async cancelJourney(req: JourneyTransitionRequest): Promise<Journey> {
    const { journeyId, actorLoginName, reason } = req;
    if (!actorLoginName.trim()) {
      throw new Error('[MockJourneyService] cancelJourney: actorLoginName is empty. Refusing to write without an identifiable actor.');
    }
    const existing = findJourney(journeyId);
    if (!canCancel(existing.Status)) {
      throw new InvalidTransitionError(journeyId, existing.Status, 'cancel');
    }
    const auditLine = buildAuditLine('CANCELLED', actorLoginName, reason);
    return updateJourneyInStore(journeyId, {
      Status: 'Cancelled',
      Notes:  appendAuditLine(existing.Notes, auditLine),
    });
  },

  async listAllActiveJourneys(type?: JourneyType): Promise<Journey[]> {
    return journeyStore.filter(
      j => j.Status === 'Active' && (type === undefined || j.Type === type),
    );
  },
});
