/**
 * apiClient.ts — the wired application API client singleton: tokens from the
 * active AuthClient; 401 hands off to the approved reauthentication path.
 */
import { createApiClient } from './api';
import { authClient } from './auth';

export const api = createApiClient({
  baseUrl: (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:4000',
  getToken: () => authClient.getAccessToken(),
  onUnauthorized: (intendedPath) => authClient.reauthenticate(intendedPath),
});
