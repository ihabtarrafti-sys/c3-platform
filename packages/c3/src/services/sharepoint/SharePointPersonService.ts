import type { Activity, Contract, Person } from '@c3/types';
import type { IPersonService } from '../interfaces/IPersonService';

export const createSharePointPersonService = (): IPersonService => ({
  async listPeople(): Promise<Person[]> {
    console.warn('[C3] SharePointPersonService.listPeople: not implemented');
    return [];
  },

  async getPerson(personId: string): Promise<Person> {
    void personId;
    console.warn('[C3] SharePointPersonService.getPerson: not implemented');
    return null as unknown as Person;
  },

  async listPersonContracts(personId: number): Promise<Contract[]> {
    void personId;
    console.warn(
      '[C3] SharePointPersonService.listPersonContracts: not implemented',
    );
    return [];
  },

  async listPersonActivities(
    personId: string,
    limit?: number,
  ): Promise<Activity[]> {
    void personId;
    void limit;
    console.warn(
      '[C3] SharePointPersonService.listPersonActivities: not implemented',
    );
    return [];
  },
});
