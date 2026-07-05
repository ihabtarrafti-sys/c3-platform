/**
 * msalConfig.ts — pure construction of the MSAL browser configuration.
 * Authorization Code + PKCE via redirect; SINGLE-TENANT authority; no client
 * secret exists anywhere in the browser. Kept pure for unit testing.
 */
import type { Configuration } from '@azure/msal-browser';

export interface EntraWebConfig {
  readonly clientId: string;
  readonly tenantId: string;
  /** The SPA origin, e.g. https://staging.c3hq.org (no trailing slash). */
  readonly origin: string;
  /** Delegated API scope, e.g. api://<API_CLIENT_ID>/C3.Access */
  readonly apiScope: string;
}

export function buildMsalConfig(cfg: EntraWebConfig): Configuration {
  if (!cfg.clientId) throw new Error('Entra web config: clientId is required.');
  if (!cfg.tenantId) throw new Error('Entra web config: tenantId is required.');
  if (!cfg.apiScope) throw new Error('Entra web config: apiScope is required.');
  const origin = cfg.origin.replace(/\/$/, '');
  return {
    auth: {
      clientId: cfg.clientId,
      // Tenant-specific authority — never common/organizations/consumers.
      authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
      redirectUri: `${origin}/auth/callback`,
      postLogoutRedirectUri: `${origin}/`,
      navigateToLoginRequestUrl: false,
    },
    cache: {
      // Session-scoped cache: survives refresh in the tab, not shared across
      // browser profiles; tokens never persist beyond the session.
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
    system: {
      loggerOptions: {
        // MSAL's logger must never receive PII/tokens.
        piiLoggingEnabled: false,
        loggerCallback: () => {},
      },
    },
  };
}

/** The token request used everywhere (single delegated scope). */
export function apiTokenRequest(cfg: Pick<EntraWebConfig, 'apiScope'>): { scopes: string[] } {
  return { scopes: [cfg.apiScope] };
}
