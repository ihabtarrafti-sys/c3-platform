import type { Activity, Contract } from '@c3/types';
import type { IContractService } from '../interfaces/IContractService';
import { mockContracts } from '../mockData';

export const createMockContractService = (): IContractService => ({
  listContracts(): Promise<Contract[]> {
    return Promise.resolve(mockContracts);
  },

  listRenewalContracts(): Promise<Contract[]> {
    return Promise.resolve(
      mockContracts.filter(
        contract =>
          contract.Disposition1 !== 'Terminated' &&
          contract.Disposition1 !== 'Archived',
      ),
    );
  },

  getContract(contractId: string): Promise<Contract> {
    // S32 (Part 19.4): look up by the canonical plain-text business Contract ID
    // (Title/ContractID), never the numeric SharePoint Id — mirrors
    // SharePointContractService.getContract (filters Title eq).
    const contract = mockContracts.find(item => item.ContractID === contractId);
    if (!contract) {
      return Promise.reject(new Error(`Contract not found: ${contractId}`));
    }
    return Promise.resolve(contract);
  },

  listContractActivities(contractId: string): Promise<Activity[]> {
    void contractId;
    return Promise.resolve([]);
  },
});
