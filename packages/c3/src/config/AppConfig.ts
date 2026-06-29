import type { AuthService } from '../services/auth';

export interface AppConfig {
  authService: AuthService;
  spSiteUrl: string;
  environment: 'dev' | 'staging' | 'production';
  dataSourceMode: 'mock' | 'sharepoint';
  /** When true, the Toaster is not mounted. Set by hosts where Fluent UI toaster registration is unsafe. */
  disableToasts?: boolean;
}