import type { C3User } from '@c3/types';
import type { IUserService } from '../interfaces/IUserService';

export const createMockUserService = (): IUserService => ({
  listUsers(): Promise<C3User[]> {
    return Promise.resolve([]);
  },
});
