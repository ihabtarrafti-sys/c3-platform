import type { C3User } from '@c3/types';

export interface IUserService {
  listUsers(): Promise<C3User[]>;
}
