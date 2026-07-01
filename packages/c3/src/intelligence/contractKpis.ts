import type { Contract } from '@c3/types';
import { computeDaysToExpiry } from '@c3/utils/dateUtils';

export const isActiveDisposition = (contract: Contract) =>
  contract.Disposition1 === 'Active' || contract.Disposition1 === null;

export const isRenewalWindow = (contract: Contract) => {
  if (!contract.EndDate) return false;
  const days = computeDaysToExpiry(contract.EndDate);

  return isActiveDisposition(contract) && days >= 0 && days <= 90;
};

export const isCriticalRenewal = (contract: Contract) => {
  if (!contract.EndDate) return false;
  const days = computeDaysToExpiry(contract.EndDate);

  return isActiveDisposition(contract) && days >= 0 && days <= 30;
};

export const isNeedsAttention = (contract: Contract) =>
  isCriticalRenewal(contract) ||
  contract.ContractStage1 === 'Pending Approval' ||
  contract.ContractStage1 === 'Pending Signature';

export interface ContractKpis {
  totalContracts: number;
  activeContracts: number;
  renewalWindow: number;
  criticalRenewals: number;
  needsAttention: number;
  totalAmendments: number;
}

export const getContractKpis = (
  contracts: Contract[],
  totalAmendments = 0,
): ContractKpis => ({
  totalContracts: contracts.length,
  activeContracts: contracts.filter(isActiveDisposition).length,
  renewalWindow: contracts.filter(isRenewalWindow).length,
  criticalRenewals: contracts.filter(isCriticalRenewal).length,
  needsAttention: contracts.filter(isNeedsAttention).length,
  totalAmendments,
});