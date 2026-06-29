import type { Amendment, Contract } from '@c3/types';

export interface BreakdownItem {
  label: string;
  value: number;
}

export const getWorkflowBreakdown = (
  contracts: Contract[],
): BreakdownItem[] => {
  const counts = new Map<string, number>();

  for (const contract of contracts) {
    counts.set(
      contract.ContractStage1,
      (counts.get(contract.ContractStage1) ?? 0) + 1,
    );
  }

  return [...counts.entries()].map(([label, value]) => ({
    label,
    value,
  }));
};

export const getDispositionBreakdown = (
  contracts: Contract[],
): BreakdownItem[] => {
  const counts = new Map<string, number>();

  for (const contract of contracts) {
    const disposition = contract.Disposition1 ?? 'None';

    counts.set(
      disposition,
      (counts.get(disposition) ?? 0) + 1,
    );
  }

  return [...counts.entries()].map(([label, value]) => ({
    label,
    value,
  }));
};

export const getAmendmentBreakdown = (
  amendments: Amendment[],
): BreakdownItem[] => {
  const counts = new Map<string, number>();

  for (const amendment of amendments) {
    const status = amendment.Status ?? 'Unknown';

    counts.set(
      status,
      (counts.get(status) ?? 0) + 1,
    );
  }

  return [...counts.entries()].map(([label, value]) => ({
    label,
    value,
  }));
};

export const getGameBreakdown = (
  contracts: Contract[],
): BreakdownItem[] => {
  const counts = new Map<string, number>();

  for (const contract of contracts) {
    const game = contract.GameTitle ?? 'Unknown';

    counts.set(
      game,
      (counts.get(game) ?? 0) + 1,
    );
  }

  return [...counts.entries()].map(([label, value]) => ({
    label,
    value,
  }));
};

export const getTeamBreakdown = (
  contracts: Contract[],
): BreakdownItem[] => {
  const counts = new Map<string, number>();

  for (const contract of contracts) {
    const team = contract.Team ?? 'Unknown';

    counts.set(
      team,
      (counts.get(team) ?? 0) + 1,
    );
  }

  return [...counts.entries()].map(([label, value]) => ({
    label,
    value,
  }));
};