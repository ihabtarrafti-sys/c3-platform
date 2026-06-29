export type PlatformEnvironment = 'dev' | 'staging' | 'production';
export type PlatformDataSourceMode = 'mock' | 'sharepoint';

export interface PlatformServices {
  auth?: unknown;
  storage?: unknown;
  navigation?: unknown;
  telemetry?: unknown;
  configuration?: unknown;
}

export interface PlatformContext {
  environment: PlatformEnvironment;
  dataSourceMode: PlatformDataSourceMode;
  /** Absolute URL of the SharePoint web. Required when dataSourceMode is 'sharepoint'. */
  spSiteUrl?: string;
  services?: PlatformServices;
}

export interface PlatformHost {
  container: HTMLElement;
  context: PlatformContext;
}

export interface PlatformManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  entry: string;
}

export interface PlatformApplication {
  start(host: PlatformHost): Promise<void>;
  stop(): Promise<void>;
}