/**
 * types.ts — the provider-neutral browser AuthClient contract.
 *
 * Two implementations:
 *   - MsalAuthClient (Entra, @azure/msal-browser, auth-code + PKCE, redirect);
 *   - DevAuthClient (the local/E2E dev IdP flow — never in production builds).
 *
 * The UI and API client depend ONLY on this interface. No token is ever
 * logged; no C3 role is ever inferred from token claims (the API's /me is the
 * single role source).
 */

export interface AuthSession {
  /** Provider-side identity hint for display while /me loads. */
  readonly identity: string;
  readonly displayName: string;
}

export interface AuthClient {
  readonly kind: 'entra' | 'dev';

  /** Initialize + restore any persisted session (also completes a pending
   *  redirect when the current URL is the auth callback). */
  initialize(): Promise<AuthSession | null>;

  /** Begin interactive sign-in. For Entra this REDIRECTS (never resolves);
   *  `intendedPath` is round-tripped so deep links survive authentication. */
  signIn(intendedPath?: string): Promise<void>;

  /** Complete the redirect on /auth/callback; returns the restored intended
   *  path (null when none was carried). */
  completeRedirect(): Promise<{ session: AuthSession; intendedPath: string | null } | null>;

  signOut(): Promise<void>;

  /** Acquire an API access token silently. Returns null when interactive
   *  reauthentication is required (caller decides when to trigger it). */
  getAccessToken(): Promise<string | null>;

  /** Interactive reauthentication (Entra: redirect; dev: clears the session
   *  so the sign-in screen renders). */
  reauthenticate(intendedPath?: string): Promise<void>;

  getSession(): AuthSession | null;
}
