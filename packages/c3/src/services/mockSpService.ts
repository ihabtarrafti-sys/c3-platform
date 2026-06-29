import type { SPService } from './spService.types';
import { createMockServiceRegistry } from './mock';

export const mockSpService = (): SPService => {
  const registry = createMockServiceRegistry();

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
