/**
 * msalClient.ts — the Entra AuthClient over @azure/msal-browser.
 * Authorization Code + PKCE, redirect-based. No raw OAuth cryptography is
 * implemented here — MSAL owns the protocol. Tokens are held by MSAL's cache
 * and are NEVER logged or persisted by our code.
 */
import {
  PublicClientApplication,
  InteractionRequiredAuthError,
  type AccountInfo,
} from '@azure/msal-browser';
import type { AuthClient, AuthSession } from './types';
import { buildMsalConfig, apiTokenRequest, type EntraWebConfig } from './msalConfig';

function toSession(account: AccountInfo | null): AuthSession | null {
  if (!account) return null;
  return { identity: account.username, displayName: account.name ?? account.username };
}

export function createMsalAuthClient(cfg: EntraWebConfig): AuthClient {
  const pca = new PublicClientApplication(buildMsalConfig(cfg));
  const tokenRequest = apiTokenRequest(cfg);
  let initialized = false;

  async function ensureInit(): Promise<void> {
    if (!initialized) {
      await pca.initialize();
      initialized = true;
    }
  }

  function activeAccount(): AccountInfo | null {
    const active = pca.getActiveAccount();
    if (active) return active;
    const all = pca.getAllAccounts();
    if (all.length > 0) {
      pca.setActiveAccount(all[0]!);
      return all[0]!;
    }
    return null;
  }

  return {
    kind: 'entra',

    async initialize(): Promise<AuthSession | null> {
      await ensureInit();
      // Completes a pending auth-code redirect if one is in flight; otherwise
      // restores the cached account (session survives a refresh).
      const result = await pca.handleRedirectPromise();
      if (result?.account) pca.setActiveAccount(result.account);
      return toSession(activeAccount());
    },

    async signIn(intendedPath?: string): Promise<void> {
      await ensureInit();
      await pca.loginRedirect({ ...tokenRequest, state: intendedPath ?? '' });
      // Redirect navigation — never resolves in practice.
    },

    async completeRedirect() {
      await ensureInit();
      const result = await pca.handleRedirectPromise();
      if (!result?.account) {
        const session = toSession(activeAccount());
        return session ? { session, intendedPath: null } : null;
      }
      pca.setActiveAccount(result.account);
      return { session: toSession(result.account)!, intendedPath: result.state || null };
    },

    async signOut(): Promise<void> {
      await ensureInit();
      await pca.logoutRedirect({ account: activeAccount() ?? undefined });
    },

    async getAccessToken(): Promise<string | null> {
      await ensureInit();
      const account = activeAccount();
      if (!account) return null;
      try {
        const res = await pca.acquireTokenSilent({ ...tokenRequest, account });
        return res.accessToken;
      } catch (err) {
        if (err instanceof InteractionRequiredAuthError) return null;
        throw err;
      }
    },

    async reauthenticate(intendedPath?: string): Promise<void> {
      await ensureInit();
      // Loop guard: at most ONE interactive redirect per minute. If a redirect
      // just happened and the API still 401s, the token is being rejected
      // server-side — another round trip through the IdP cannot help, and
      // unbounded redirects lock the browser into a sign-in loop.
      const GUARD_KEY = 'c3web.reauth.at';
      const last = Number(sessionStorage.getItem(GUARD_KEY) ?? '0');
      if (Date.now() - last < 60_000) return;
      sessionStorage.setItem(GUARD_KEY, String(Date.now()));
      await pca.acquireTokenRedirect({ ...tokenRequest, state: intendedPath ?? '' });
    },

    getSession(): AuthSession | null {
      return initialized ? toSession(activeAccount()) : null;
    },
  };
}
