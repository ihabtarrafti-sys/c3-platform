import type { ContractStage, Disposition } from '../types';

export interface UpdateContractStageInput {
  contractId: string;
  newContractStage: ContractStage;
  reason: string;
  performedByName: string;
  performedByEmail: string;
  performedByType: string;
}

export interface CaptureRenewalDecisionInput {
  contractId: string;
  disposition: Exclude<Disposition, null>;
  notes?: string;
  performedByName: string;
  performedByEmail: string;
  performedByType: string;
}

export interface CreateAmendmentInput {
  ContractID: string;
  AmendmentType: string;
  Description: string;
  EffectiveDate: string;
  PerformedByName: string;
  PerformedByEmail: string;
  PerformedByType: string;
}

export const flowService = (flowBaseUrl: string) => {
  void flowBaseUrl;

  return {
    updateContractStage(input: UpdateContractStageInput): Promise<void> {
      void input;
      return Promise.resolve();
    },

    captureRenewalDecision(input: CaptureRenewalDecisionInput): Promise<void> {
      void input;
      return Promise.resolve();
    },

    updatePerson(input: unknown): Promise<void> {
      void input;
      return Promise.resolve();
    },

    createAmendment(input: CreateAmendmentInput): Promise<{ amendmentId: string }> {
      void input;
      return Promise.resolve({ amendmentId: 'stub' });
    },
  };
};