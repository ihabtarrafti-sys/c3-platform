import type { C3User } from '@c3/types';
import type { IUserService } from '../interfaces/IUserService';

export const createSharePointUserService = (): IUserService => ({
  async listUsers(): Promise<C3User[]> {
    console.warn('[C3] SharePointUserService.listUsers: not implemented');
    return [];
  },
});
