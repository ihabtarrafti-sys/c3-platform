import type { Amendment } from '@c3/types';
import type { IAmendmentService } from '../interfaces/IAmendmentService';
import { mockAmendments } from '../mockAmendments';

export const createMockAmendmentService = (): IAmendmentService => ({
  listAllAmendments(): Promise<Amendment[]> {
    return Promise.resolve(mockAmendments);
  },

  listContractAmendments(contractId: string): Promise<Amendment[]> {
    return Promise.resolve(
      mockAmendments.filter(
        amendment => String(amendment.ParentContractID) === contractId,
      ),
    );
  },

  getAmendment(amendmentId: string): Promise<Amendment> {
    const amendment = mockAmendments.find(
      item =>
        String(item.Id) === amendmentId || item.AmendmentID === amendmentId,
    );
    if (!amendment) {
      return Promise.reject(new Error(`Amendment not found: ${amendmentId}`));
    }
    return Promise.resolve(amendment);
  },
});
