import type { InitiateJourneyInput, Journey } from '@c3/types';
import type { JourneyType } from '@c3/types';
import type { IJourneyService } from '../interfaces/IJourneyService';

/**
 * SharePoint implementation of IJourneyService.
 *
 * Graceful stub — read methods return empty/null and log warnings.
 * Write methods throw: they cannot safely no-op because callers expect a
 * returned Journey object and side effects in the data store.
 *
 * Blocked pending SharePoint list schema design and IT access.
 */
export const createSharePointJourneyService = (): IJourneyService => ({
  async getActiveJourney(personId: string, type: JourneyType): Promise<Journey | null> {
    void personId;
    void type;
    console.warn('[C3] SharePointJourneyService.getActiveJourney: not implemented');
    return null;
  },

  async listJourneysForPerson(personId: string, type?: JourneyType): Promise<Journey[]> {
    void personId;
    void type;
    console.warn('[C3] SharePointJourneyService.listJourneysForPerson: not implemented');
    return [];
  },

  async initiateJourney(input: InitiateJourneyInput): Promise<Journey> {
    void input;
    console.warn('[C3] SharePointJourneyService.initiateJourney: not implemented');
    throw new Error('SharePointJourneyService.initiateJourney: not implemented');
  },

  async completeJourney(journeyId: string): Promise<Journey> {
    void journeyId;
    console.warn('[C3] SharePointJourneyService.completeJourney: not implemented');
    throw new Error('SharePointJourneyService.completeJourney: not implemented');
  },

  async suspendJourney(journeyId: string): Promise<Journey> {
    void journeyId;
    console.warn('[C3] SharePointJourneyService.suspendJourney: not implemented');
    throw new Error('SharePointJourneyService.suspendJourney: not implemented');
  },

  async cancelJourney(journeyId: string): Promise<Journey> {
    void journeyId;
    console.warn('[C3] SharePointJourneyService.cancelJourney: not implemented');
    throw new Error('SharePointJourneyService.cancelJourney: not implemented');
  },

  async listAllActiveJourneys(type?: JourneyType): Promise<Journey[]> {
    void type;
    console.warn('[C3] SharePointJourneyService.listAllActiveJourneys: not implemented');
    return [];
  },
});
