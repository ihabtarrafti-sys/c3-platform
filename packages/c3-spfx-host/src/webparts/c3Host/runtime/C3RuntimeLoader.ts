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
  /** SPFx claims login name, e.g. "i:0#.f|membership|user@tenant.onmicrosoft.com". */
  userLoginName?: string;
  /** When true, the host signals that Fluent UI Toaster registration is unsafe in this environment. */
  disableToasts?: boolean;
  services?: PlatformServices;
}

export interface PlatformHost {
  container: HTMLElement;
  context: PlatformContext;
}

export interface PlatformMountOptions {
  context: PlatformContext;
  /**
   * TD-34 (Sprint 33): called exactly once after the runtime's FIRST React
   * commit. mount() returning only proves the render was SCHEDULED; this
   * signal is the host's proof that application DOM actually committed.
   */
  onFirstCommit?: () => void;
  /**
   * TD-34 (Sprint 33): called when the runtime root error boundary catches a
   * render-phase error (visible fallback already rendered by the runtime).
   * Sanitized name/message only.
   */
  onRuntimeError?: (errorName: string, errorMessage: string) => void;
}

export interface PlatformApplication {
  /** Mount the C3 application into the given container element. */
  mount(container: HTMLElement, options: PlatformMountOptions): void;
  /** Unmount and clean up the C3 application from the given container element. */
  unmount(container: HTMLElement): void;
}
