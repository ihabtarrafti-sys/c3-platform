import type { InitiateJourneyInput, Journey, JourneyType } from '@c3/types';

export interface IJourneyService {
  /**
   * Returns the active Journey of the given type for a Person, or null if none
   * exists. A Person should have at most one Active journey of each type at a
   * time.
   */
  getActiveJourney(personId: string, type: JourneyType): Promise<Journey | null>;

  /**
   * Returns all Journeys for a Person, ordered most-recent first.
   * When `type` is provided, results are filtered to that Journey type.
   * When omitted, all Journey types are returned.
   */
  listJourneysForPerson(personId: string, type?: JourneyType): Promise<Journey[]>;

  /**
   * Initiates a new Journey for a Person.
   * Journeys are initiated by operational decision — not by contract or document.
   * The Journey `Type` in the input determines what kind of passage is being opened.
   */
  initiateJourney(input: InitiateJourneyInput): Promise<Journey>;

  /**
   * Marks a Journey as Completed.
   * The gap this Journey was closing is considered closed.
   */
  completeJourney(journeyId: string): Promise<Journey>;

  /**
   * Marks a Journey as Suspended.
   * The gap remains open; the Journey is paused pending resolution of an
   * external blocker. The Journey may be reactivated or cancelled.
   */
  suspendJourney(journeyId: string): Promise<Journey>;

  /**
   * Marks a Journey as Cancelled.
   * The Journey will not be completed. The gap it was targeting remains open
   * until a new Journey is initiated, or the underlying state changes.
   */
  cancelJourney(journeyId: string): Promise<Journey>;

  /**
   * Returns all Active journeys across all persons.
   * When `type` is provided, results are filtered to that Journey type.
   *
   * Used by the Situation Room aggregation layer (useOperationalGaps) to
   * batch-fetch journey state for all persons in a single call, avoiding
   * N per-person queries. The caller maps results by PersonID.
   */
  listAllActiveJourneys(type?: JourneyType): Promise<Journey[]>;
}
