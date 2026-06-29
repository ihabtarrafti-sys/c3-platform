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

  listPersonContracts(personId: number): Promise<Contract[]> {
    const person = mockPeople.find(p => p.Id === personId);
    if (!person) {
      return Promise.resolve([]);
    }
    return Promise.resolve(
      mockContracts.filter(
        contract =>
          contract.PersonnelCode &&
          contract.PersonnelCode === person.PersonnelCode,
      ),
    );
  },

  listPersonActivities(personId: string, limit?: number): Promise<Activity[]> {
    void personId;
    void limit;
    return Promise.resolve([]);
  },
});
