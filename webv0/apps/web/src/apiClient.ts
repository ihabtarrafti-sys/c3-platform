/**
 * apiClient.ts — the wired application API client singleton: tokens from the
 * active AuthClient; 401 hands off to the approved reauthentication path.
 */
import { createApiClient } from './api';
import { authClient } from './auth';

export const api = createApiClient({
  baseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000',
  getToken: () => authClient.getAccessToken(),
  onUnauthorized: async (intendedPath) => {
    // Never start an interactive redirect FROM the auth callback route: a 401
    // there means the freshly-acquired token was rejected by the API (a
    // configuration fault) — reauthentication cannot fix it and loops the
    // browser through the identity provider. Let the error surface truthfully.
    if (typeof window !== 'undefined' && window.location.pathname.startsWith('/auth/callback')) return;
    await authClient.reauthenticate(intendedPath);
  },
});
