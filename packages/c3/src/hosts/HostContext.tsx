import { createContext, useContext } from 'react';

export type HostEnvironment = 'dev' | 'staging' | 'production';
export type HostDataSourceMode = 'mock' | 'sharepoint';

export interface HostContextValue {
  environment: HostEnvironment;
  dataSourceMode: HostDataSourceMode;
  spSiteUrl?: string;
  /** When true, the host signals that Fluent UI Toaster registration is unsafe (e.g. SPFx workbench). */
  disableToasts?: boolean;
}

export const defaultHostContext: HostContextValue = {
  environment: 'dev',
  dataSourceMode: 'mock',
  spSiteUrl: 'https://geekaygames.sharepoint.com/sites/C3',
};

const HostContext = createContext<HostContextValue>(defaultHostContext);

export const HostContextProvider = HostContext.Provider;

export const useHostContext = () => useContext(HostContext);