import type { SPService } from './spService.types';
import { createSharePointServiceRegistry } from './sharepoint';

export const createSharePointSPService = (siteUrl: string): SPService => {
  const registry = createSharePointServiceRegistry(siteUrl);

  return {
    listContracts: () => registry.contracts.listContracts(),
    listRenewalContracts: () => registry.contracts.listRenewalContracts(),
    getContract: (contractId) => registry.contracts.getContract(contractId),
    listContractActivities: (contractId) =>
      registry.contracts.listContractActivities(contractId),

    listPeople: () => registry.people.listPeople(),
    getPerson: (personId) => registry.people.getPerson(personId),
    listPersonContracts: (personId) =>
      registry.people.listPersonContracts(personId),
    listPersonActivities: (personId, limit) =>
      registry.people.listPersonActivities(personId, limit),

    listAllAmendments: () => registry.amendments.listAllAmendments(),
    listContractAmendments: (contractId) =>
      registry.amendments.listContractAmendments(contractId),
    getAmendment: (amendmentId) =>
      registry.amendments.getAmendment(amendmentId),

    listUsers: () => registry.users.listUsers(),

    getDiagnostics: () => registry.diagnostics.getDiagnostics(),
    getAdapterInfo: () => registry.diagnostics.getAdapterInfo(),
  };
};
