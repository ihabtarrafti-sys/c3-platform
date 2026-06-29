import type { C3Role } from './roles';

export interface C3User {
  UserEmail: string;
  DisplayName: string;
  C3Role: C3Role;
  IsActive: boolean;
}