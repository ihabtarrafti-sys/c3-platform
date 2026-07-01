import type { Activity, Contract, Person } from '@c3/types';

export interface IPersonService {
  listPeople(): Promise<Person[]>;
  getPerson(personId: string): Promise<Person>;
  listPersonContracts(personId: string): Promise<Contract[]>;
  listPersonActivities(personId: string, limit?: number): Promise<Activity[]>;
}
