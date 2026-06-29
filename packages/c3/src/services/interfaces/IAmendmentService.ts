import type { Amendment } from '@c3/types';

export interface IAmendmentService {
  listAllAmendments(): Promise<Amendment[]>;
  listContractAmendments(contractId: string): Promise<Amendment[]>;
  getAmendment(amendmentId: string): Promise<Amendment>;
}
