import { spfi, SPFI } from '@pnp/sp';
import '@pnp/sp/webs';
import '@pnp/sp/lists';
import '@pnp/sp/items';

import { mapContract, type SPContractItem } from '@c3/mappers';
import type { Activity, Contract } from '@c3/types';
import type { IContractService } from '../interfaces/IContractService';

export const createSharePointContractService = (
  siteUrl: string,
): IContractService => {
  const sp: SPFI = spfi(siteUrl);

  const listContracts = async (): Promise<Contract[]> => {
    const items = await sp.web.lists
      .getByTitle('C3_Contracts')
      .items.select(
        '*',
        'Person/Id',
        'Person/Title',
        'Team/Id',
        'Team/Title',
        'GameTitle/Id',
        'GameTitle/Title',
        'ContractOwner/Id',
        'ContractOwner/Title',
        'ContractOwner/EMail',
        'Manager/Id',
        'Manager/Title',
        'Manager/EMail',
        'Reviewer/Id',
        'Reviewer/Title',
        'Reviewer/EMail',
        'Approver/Id',
        'Approver/Title',
        'Approver/EMail',
      )
      .expand(
        'Person',
        'Team',
        'GameTitle',
        'ContractOwner',
        'Manager',
        'Reviewer',
        'Approver',
      )
      .top(5000)<SPContractItem[]>();

    return items.map(mapContract);
  };

  return {
    listContracts,

    async listRenewalContracts(): Promise<Contract[]> {
      const contracts = await listContracts();
      return contracts.filter(
        contract =>
          contract.Disposition1 !== 'Terminated' &&
          contract.Disposition1 !== 'Archived',
      );
    },

    async getContract(contractId: string): Promise<Contract> {
      const contracts = await listContracts();
      const contract = contracts.find(
        item =>
          String(item.Id) === contractId || item.ContractID === contractId,
      );
      if (!contract) {
        throw new Error(`Contract not found: ${contractId}`);
      }
      return contract;
    },

    async listContractActivities(contractId: string): Promise<Activity[]> {
      void contractId;
      console.warn(
        '[C3] SharePointContractService.listContractActivities: not implemented',
      );
      return [];
    },
  };
};
