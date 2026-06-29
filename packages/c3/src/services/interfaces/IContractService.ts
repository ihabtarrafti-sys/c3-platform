import type { Activity, Contract } from '@c3/types';

export interface IContractService {
  listContracts(): Promise<Contract[]>;
  listRenewalContracts(): Promise<Contract[]>;
  getContract(contractId: string): Promise<Contract>;
  listContractActivities(contractId: string): Promise<Activity[]>;
}
