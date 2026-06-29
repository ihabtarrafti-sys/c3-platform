import type { AuthService } from '../services/auth';

export interface AppConfig {
  authService: AuthService;
  spSiteUrl: string;
  environment: 'dev' | 'staging' | 'production';
  dataSourceMode: 'mock' | 'sharepoint';
}