import type { Activity, Contract, Person } from '@c3/types';
import type { IPersonService } from '../interfaces/IPersonService';
import { mockContracts, mockPeople } from '../mockData';

export const createMockPersonService = (): IPersonService => ({
  listPeople(): Promise<Person[]> {
    return Promise.resolve(mockPeople);
  },

  getPerson(personId: string): Promise<Person> {
    const person = mockPeople.find(
      item => String(item.Id) === personId || item.PersonID === personId,
    );
    if (!person) {
      return Promise.reject(new Error(`Person not found: ${personId}`));
    }
    return Promise.resolve(person);
  },

  // Sprint 24 Phase 1: Filter by PersonID (PER-XXXX canonical FK).
  // PersonnelCode cross-reference removed — Contract.PersonID is now the FK.
  listPersonContracts(personId: string): Promise<Contract[]> {
    if (!personId || personId.trim().length === 0) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      mockContracts.filter(c => c.PersonID === personId),
    );
  },

  listPersonActivities(personId: string, limit?: number): Promise<Activity[]> {
    void personId;
    void limit;
    return Promise.resolve([]);
  },
});
