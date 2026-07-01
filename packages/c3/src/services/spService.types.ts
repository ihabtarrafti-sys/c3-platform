import type { Activity, Amendment, C3User, Contract, Person } from '@c3/types';
import type { AdapterInfo, DiagnosticsReport } from '@c3/types';

export interface SPService {
  listContracts(): Promise<Contract[]>;
  listRenewalContracts(): Promise<Contract[]>;
  getContract(contractId: string): Promise<Contract>;

  listPeople(): Promise<Person[]>;
  getPerson(personId: string): Promise<Person>;
  listPersonContracts(personId: string): Promise<Contract[]>;
  listPersonActivities(personId: string, limit?: number): Promise<Activity[]>;

  listAllAmendments(): Promise<Amendment[]>;
  listContractAmendments(contractId: string): Promise<Amendment[]>;
  getAmendment(amendmentId: string): Promise<Amendment>;

  listContractActivities(contractId: string): Promise<Activity[]>;

  listUsers(): Promise<C3User[]>;

  getDiagnostics(): Promise<DiagnosticsReport>;

  getAdapterInfo(): AdapterInfo;
}