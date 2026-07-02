import type { Activity, Contract, Person } from '@c3/types';
import type { CreatePersonInput } from '@c3/types/people';

export interface IPersonService {
  listPeople(): Promise<Person[]>;
  getPerson(personId: string): Promise<Person>;
  listPersonContracts(personId: string): Promise<Contract[]>;
  listPersonActivities(personId: string, limit?: number): Promise<Activity[]>;

  /**
   * Creates a new person row and assigns a canonical PER-XXXX PersonID.
   *
   * Mock DSM:  Generates the next PER-XXXX from an in-memory counter and
   *            appends the new Person to the mock store.
   * SP DSM:    POST to C3People (TMP title), then MERGE Title = PER-XXXX
   *            using the SP atomic item ID as the sequence source.
   *            IsActive defaults to true on creation.
   *
   * Called exclusively by the AddPerson execution branch in useExecuteApproval.
   * Must NOT be called from any UI layer directly (ADR-013: no direct SP writes
   * from UI). The governed approval path is the only valid entry point.
   *
   * Returns the created Person with a canonical PersonID.
   * Throws on any failure — callers are responsible for stamping ExecutionFailed.
   *
   * Sprint 25.
   */
  createPerson(input: CreatePersonInput): Promise<Person>;
}
