/**
 * devLogin.ts — DEV-ONLY sign-in via the API's dev IdP. This module is loaded
 * through a dynamic import inside an `if (IS_ENTRA) throw` dead branch, so the
 * entra (production) bundle contains neither this code nor the dev-login route
 * string (enforced by scripts/verify-entra-bundle.mts).
 */
import { createApiClient } from '../api';
import { authClient } from './index';
import type { AuthSession } from './types';

export async function performDevLogin(input: { email: string; role: string; tenantSlug: string }): Promise<AuthSession> {
  const api = createApiClient({
    baseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000',
    getToken: async () => null,
    onUnauthorized: async () => {},
  });
  const res = await api.request<{ token: string; identity: string; displayName: string }>(
    'POST',
    '/api/v1/dev/login',
    { ...input, displayName: input.email },
  );
  const session: AuthSession = { identity: res.identity, displayName: res.displayName };
  const dev = authClient as typeof authClient & { adoptDevLogin?: (token: string, s: AuthSession) => void };
  dev.adoptDevLogin?.(res.token, session);
  return session;
}
