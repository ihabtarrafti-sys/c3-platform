import type { InitiateJourneyInput, Journey, JourneyStatus, JourneyType } from '@c3/types';

export interface JourneyTransitionRequest {
  journeyId: string;
  actorLoginName: string;
  reason?: string;
}

export function canComplete(status: JourneyStatus): boolean {
  return status === 'Active';
}

export function canSuspend(status: JourneyStatus): boolean {
  return status === 'Active';
}

export function canResume(status: JourneyStatus): boolean {
  return status === 'Suspended';
}

export function canCancel(status: JourneyStatus): boolean {
  return status === 'Active' || status === 'Suspended';
}

export interface IJourneyService {
  getActiveJourney(personId: string, type: JourneyType): Promise<Journey | null>;
  listJourneysForPerson(personId: string, type?: JourneyType): Promise<Journey[]>;
  initiateJourney(input: InitiateJourneyInput): Promise<Journey>;
  completeJourney(req: JourneyTransitionRequest): Promise<Journey>;
  suspendJourney(req: JourneyTransitionRequest): Promise<Journey>;
  resumeJourney(req: Omit<JourneyTransitionRequest, 'reason'>): Promise<Journey>;
  cancelJourney(req: JourneyTransitionRequest): Promise<Journey>;
  listAllActiveJourneys(type?: JourneyType): Promise<Journey[]>;
}
