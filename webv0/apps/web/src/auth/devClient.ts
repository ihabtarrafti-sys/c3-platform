/**
 * devClient.ts — the development AuthClient (local/E2E ONLY). Wraps the API's
 * signed dev IdP: the token is issued by /api/v1/dev/login and stored for the
 * session. Production builds (VITE_AUTH_PROVIDER=entra) exclude this module
 * and the dev sign-in UI entirely.
 */
import type { AuthClient, AuthSession } from './types';

const TOKEN_KEY = 'c3web.dev.token';
const SESSION_KEY = 'c3web.dev.session';

export function createDevAuthClient(): AuthClient & {
  /** Called by the dev sign-in form after a successful /dev/login. */
  adoptDevLogin(token: string, session: AuthSession): void;
} {
  let session: AuthSession | null = null;

  const read = (k: string) => (typeof localStorage !== 'undefined' ? localStorage.getItem(k) : null);
  const write = (k: string, v: string | null) => {
    if (typeof localStorage === 'undefined') return;
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  };

  return {
    kind: 'dev',

    async initialize(): Promise<AuthSession | null> {
      const raw = read(SESSION_KEY);
      session = raw ? (JSON.parse(raw) as AuthSession) : null;
      return read(TOKEN_KEY) ? session : null;
    },

    async signIn(): Promise<void> {
      // Dev sign-in is form-driven (LoginGate); nothing to do here.
    },

    async completeRedirect() {
      return null; // no redirect flow in dev
    },

    async clearLocalSession(): Promise<void> {
      session = null;
      write(TOKEN_KEY, null);
      write(SESSION_KEY, null);
    },

    async signOut(): Promise<void> {
      session = null;
      write(TOKEN_KEY, null);
      write(SESSION_KEY, null);
    },

    async getAccessToken(): Promise<string | null> {
      return read(TOKEN_KEY);
    },

    async reauthenticate(): Promise<void> {
      // Dev semantics: drop the session so the sign-in screen renders.
      session = null;
      write(TOKEN_KEY, null);
      write(SESSION_KEY, null);
    },

    getSession(): AuthSession | null {
      return session;
    },

    adoptDevLogin(token: string, s: AuthSession): void {
      session = s;
      write(TOKEN_KEY, token);
      write(SESSION_KEY, JSON.stringify(s));
    },
  };
}
