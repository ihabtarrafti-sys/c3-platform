import type { Amendment } from '@c3/types';
import type { IAmendmentService } from '../interfaces/IAmendmentService';

export const createSharePointAmendmentService = (): IAmendmentService => ({
  async listAllAmendments(): Promise<Amendment[]> {
    console.warn(
      '[C3] SharePointAmendmentService.listAllAmendments: not implemented',
    );
    return [];
  },

  async listContractAmendments(contractId: string): Promise<Amendment[]> {
    void contractId;
    console.warn(
      '[C3] SharePointAmendmentService.listContractAmendments: not implemented',
    );
    return [];
  },

  async getAmendment(amendmentId: string): Promise<Amendment> {
    void amendmentId;
    console.warn(
      '[C3] SharePointAmendmentService.getAmendment: not implemented',
    );
    return null as unknown as Amendment;
  },
});
