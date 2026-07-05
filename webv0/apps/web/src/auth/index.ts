/**
 * auth/index.ts — provider selection at BUILD time.
 *
 * `import.meta.env.VITE_AUTH_PROVIDER` is statically replaced by Vite, so the
 * dev branch (dev client + dev sign-in UI) is dead-code-eliminated from
 * production (entra) bundles — verified by the bundle-content check in the
 * gate/CI. Never infer the C3 role from anything here: /api/v1/me is the only
 * role source.
 */
import type { AuthClient } from './types';
import { createMsalAuthClient } from './msalClient';
import { createDevAuthClient } from './devClient';

export const AUTH_PROVIDER: 'entra' | 'dev' =
  (import.meta.env.VITE_AUTH_PROVIDER as string) === 'entra' ? 'entra' : 'dev';

export const IS_ENTRA = AUTH_PROVIDER === 'entra';

function buildClient(): AuthClient {
  if (IS_ENTRA) {
    return createMsalAuthClient({
      clientId: (import.meta.env.VITE_ENTRA_CLIENT_ID as string) ?? '',
      tenantId: (import.meta.env.VITE_ENTRA_TENANT_ID as string) ?? '',
      apiScope: (import.meta.env.VITE_ENTRA_API_SCOPE as string) ?? '',
      origin: window.location.origin,
    });
  }
  return createDevAuthClient();
}

export const authClient: AuthClient = buildClient();

export type { AuthClient, AuthSession } from './types';
