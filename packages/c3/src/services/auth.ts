import type { C3Role } from '@c3/types';

export interface C3CurrentUser {
  displayName: string;
  email: string;
  loginName: string;
  c3Role: C3Role;
}

export interface AuthService {
  getCurrentUser(): Promise<C3CurrentUser>;
  getAccessToken(resource?: string): Promise<string>;
}