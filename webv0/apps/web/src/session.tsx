/**
 * session.tsx — client session + inline notifications (Phase 2B).
 *
 * The session is driven by the provider-neutral AuthClient (Entra MSAL or the
 * dev IdP). The C3 role/capabilities come ONLY from /api/v1/me — never from
 * token claims. Browser-side capability checks are UX-only; the API is the
 * authoritative enforcement boundary.
 *
 * States:
 *   loading        — initializing / restoring the session
 *   anonymous      — no provider session (sign-in screen)
 *   unprovisioned  — authenticated with the provider, but no C3 membership
 *                    (truthful access-not-provisioned screen)
 *   authenticated  — provider session + C3 membership resolved
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from './apiClient';
import { ApiError, type MeResponse } from './api';
import { authClient, AUTH_PROVIDER, IS_ENTRA } from './auth';
import type { AuthSession } from './auth';

type Status = 'loading' | 'authenticated' | 'anonymous' | 'unprovisioned';

interface SessionValue {
  status: Status;
  me: MeResponse | null;
  /** Truthful reason the last session resolution failed (shown on the sign-in screen). */
  authNotice: string | null;
  providerSession: AuthSession | null;
  authProvider: 'entra' | 'dev';
  /** Entra: interactive redirect sign-in. */
  signIn(intendedPath?: string): Promise<void>;
  /** Dev-only: form-driven sign-in via the dev IdP. */
  devLogin(input: { email: string; role: string; tenantSlug: string }): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [providerSession, setProviderSession] = useState<AuthSession | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  const resolveMe = useCallback(async (session: AuthSession | null) => {
    setProviderSession(session);
    if (!session) {
      setMe(null);
      setStatus('anonymous');
      return;
    }
    try {
      const m = await api.me();
      setMe(m);
      setAuthNotice(null);
      setStatus('authenticated');
    } catch (err) {
      setMe(null);
      if (err instanceof ApiError && err.status === 403 && err.code === 'ACCESS_NOT_PROVISIONED') {
        // Valid identity, no C3 membership: truthful state, not a login error.
        setStatus('unprovisioned');
        return;
      }
      if (err instanceof ApiError && err.status === 401) {
        // The API REJECTED the token: the session is dead. Clear ONLY the
        // local session — never bounce through the provider's logout page —
        // and surface the exact refusal on the sign-in screen.
        setAuthNotice(err.message);
        await authClient.clearLocalSession().catch(() => {});
        setStatus('anonymous');
        return;
      }
      // Anything else (network blip, 5xx, a busy server) is TRANSIENT: the
      // token was never rejected. Retry once; if it still fails, KEEP the
      // stored session — a later refresh recovers silently. Deleting it here
      // would sign the user out over a hiccup (a real defect S2's E2E load
      // exposed: reload → one failed /me → login screen).
      try {
        await new Promise((r) => setTimeout(r, 1500));
        const m = await api.me();
        setMe(m);
        setAuthNotice(null);
        setStatus('authenticated');
      } catch (retryErr) {
        setAuthNotice(retryErr instanceof ApiError ? retryErr.message : 'The service could not be reached.');
        setStatus('anonymous'); // stored session deliberately KEPT
      }
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = await authClient.initialize();
        await resolveMe(session);
      } catch {
        setStatus('anonymous');
      }
    })();
  }, [resolveMe]);

  const signIn = useCallback(async (intendedPath?: string) => {
    await authClient.signIn(intendedPath);
  }, []);

  const devLogin = useCallback(
    async (input: { email: string; role: string; tenantSlug: string }) => {
      // Build-time constant: under the entra (production) build this branch
      // throws first, so the dynamic dev-login module (and the dev-login route
      // string) is unreachable and excluded from the bundle entirely.
      if (IS_ENTRA) throw new Error('Development sign-in is not available in this build.');
      const { performDevLogin } = await import('./auth/devLogin');
      const session = await performDevLogin(input);
      await resolveMe(session);
    },
    [resolveMe],
  );

  const signOut = useCallback(async () => {
    setMe(null);
    setProviderSession(null);
    setStatus('anonymous');
    await authClient.signOut();
  }, []);

  const refresh = useCallback(async () => {
    await resolveMe(authClient.getSession());
  }, [resolveMe]);

  const value = useMemo<SessionValue>(
    () => ({ status, me, providerSession, authNotice, authProvider: AUTH_PROVIDER, signIn, devLogin, signOut, refresh }),
    [status, me, providerSession, authNotice, signIn, devLogin, signOut, refresh],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within SessionProvider');
  return ctx;
}

// ── inline notifications ─────────────────────────────────────────────────────
export type NotifyIntent = 'success' | 'error' | 'warning' | 'info';
export interface Notice {
  id: number;
  intent: NotifyIntent;
  message: string;
}

interface NotifyValue {
  notices: Notice[];
  notify(intent: NotifyIntent, message: string): void;
  dismiss(id: number): void;
}

const NotifyContext = createContext<NotifyValue | null>(null);
let noticeSeq = 1;

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const notify = useCallback((intent: NotifyIntent, message: string) => {
    const id = noticeSeq++;
    setNotices((n) => [...n, { id, intent, message }]);
  }, []);
  const dismiss = useCallback((id: number) => setNotices((n) => n.filter((x) => x.id !== id)), []);
  const value = useMemo(() => ({ notices, notify, dismiss }), [notices, notify, dismiss]);
  return <NotifyContext.Provider value={value}>{children}</NotifyContext.Provider>;
}

export function useNotify(): NotifyValue {
  const ctx = useContext(NotifyContext);
  if (!ctx) throw new Error('useNotify must be used within NotificationProvider');
  return ctx;
}
