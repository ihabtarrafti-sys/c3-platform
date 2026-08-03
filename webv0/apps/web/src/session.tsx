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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api } from './apiClient';
import { ApiError, type MeResponse } from './api';
import { authClient, AUTH_PROVIDER, IS_ENTRA } from './auth';
import type { AuthSession } from './auth';

type Status = 'loading' | 'authenticated' | 'anonymous' | 'unprovisioned';

/**
 * The waiting person's truthful view of membership resolution. This stays
 * separate from the legacy session status: `unprovisioned` continues to gate
 * every product route, while the relay says why the gate is closed and what a
 * single explicit recheck learned.
 */
export type MembershipRelayState =
  | { readonly kind: 'checking' }
  | { readonly kind: 'not_seated' }
  | { readonly kind: 'verification_failed'; readonly message: string }
  | { readonly kind: 'ambiguous' }
  | { readonly kind: 'confirmed'; readonly me: MeResponse };

type MembershipReadResult = MembershipRelayState | { readonly kind: 'session_rejected'; readonly message: string };

/** One authoritative /me read. Deliberately contains no retry. */
export async function readMembershipOnce(readMe: () => Promise<MeResponse> = () => api.me()): Promise<MembershipReadResult> {
  try {
    return { kind: 'confirmed', me: await readMe() };
  } catch (err) {
    if (err instanceof ApiError && err.status === 403 && err.code === 'ACCESS_NOT_PROVISIONED') {
      return { kind: 'not_seated' };
    }
    if (err instanceof ApiError && err.status === 403 && err.code === 'MEMBERSHIP_AMBIGUOUS') {
      return { kind: 'ambiguous' };
    }
    if (err instanceof ApiError && err.status === 401) {
      return { kind: 'session_rejected', message: err.message };
    }
    return {
      kind: 'verification_failed',
      message: err instanceof ApiError ? err.message : 'The membership register could not be reached.',
    };
  }
}

interface SessionValue {
  status: Status;
  me: MeResponse | null;
  /** Truthful reason the last session resolution failed (shown on the sign-in screen). */
  authNotice: string | null;
  membershipRelay: MembershipRelayState;
  providerSession: AuthSession | null;
  authProvider: 'entra' | 'dev';
  /** Entra: interactive redirect sign-in. */
  signIn(intendedPath?: string): Promise<void>;
  /** Dev-only: form-driven sign-in via the dev IdP. */
  devLogin(input: { email: string; role: string; tenantSlug: string }): Promise<void>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
  /** Re-read /me exactly once without discarding the provider session. */
  checkSeat(): Promise<void>;
  /** Admit a confirmed result into the product tree; the current URL stays put. */
  enterSeat(): void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [providerSession, setProviderSession] = useState<AuthSession | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [membershipRelay, setMembershipRelay] = useState<MembershipRelayState>({ kind: 'checking' });
  const seatCheckInFlight = useRef<number | null>(null);
  const seatCheckSequence = useRef(0);
  // Every membership read belongs to exactly one session-resolution epoch.
  // Sign-out, refresh, or a newer login invalidates older responses before
  // they can write a stale identity back into the product boundary.
  const resolutionEpoch = useRef(0);

  const resolveMe = useCallback(async (
    session: AuthSession | null,
    options: { handoff?: boolean; retryTransient?: boolean } = {},
  ) => {
    const epoch = ++resolutionEpoch.current;
    const isCurrent = () => resolutionEpoch.current === epoch;
    setProviderSession(session);
    if (!session) {
      setMe(null);
      setMembershipRelay({ kind: 'checking' });
      setStatus('anonymous');
      return;
    }
    setMembershipRelay({ kind: 'checking' });

    let result = await readMembershipOnce();
    if (!isCurrent()) return;
    // Preserve the established one-retry protection during session restore,
    // but never retry a named refusal and never retry an explicit seat check.
    if (result.kind === 'verification_failed' && options.retryTransient) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!isCurrent()) return;
      result = await readMembershipOnce();
      if (!isCurrent()) return;
    }

    if (result.kind === 'confirmed') {
      setAuthNotice(null);
      setMembershipRelay(result);
      if (options.handoff) {
        // A person who was waiting sees the positive witness before product
        // routes mount. `enterSeat` performs the only status transition.
        setMe(null);
        setStatus('unprovisioned');
      } else {
        setMe(result.me);
        setStatus('authenticated');
      }
      return;
    }

    if (result.kind === 'session_rejected') {
      setMe(null);
      setProviderSession(null);
      setAuthNotice(result.message);
      // A 401 is the one result that does discard the rejected local session.
      // The relay remains `checking` but is hidden behind `anonymous`; a
      // rejected provider session never masquerades as a register verdict.
      await authClient.clearLocalSession().catch(() => {});
      if (!isCurrent()) return;
      setStatus('anonymous');
      return;
    }

    // Both named 403 outcomes and a transient verification failure retain the
    // valid provider session. The relay, not the sign-in screen, owns them.
    setMe(null);
    setAuthNotice(null);
    setMembershipRelay(result);
    setStatus('unprovisioned');
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const session = await authClient.initialize();
        await resolveMe(session, { retryTransient: true });
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
    resolutionEpoch.current += 1;
    seatCheckSequence.current += 1;
    seatCheckInFlight.current = null;
    setMe(null);
    setProviderSession(null);
    setAuthNotice(null);
    setMembershipRelay({ kind: 'checking' });
    setStatus('anonymous');
    await authClient.signOut();
  }, []);

  const refresh = useCallback(async () => {
    await resolveMe(authClient.getSession(), { retryTransient: true });
  }, [resolveMe]);

  const checkSeat = useCallback(async () => {
    if (seatCheckInFlight.current !== null) return;
    const checkId = ++seatCheckSequence.current;
    seatCheckInFlight.current = checkId;
    try {
      // No redirect and no provider logout: this is exactly one membership
      // read against the existing provider session. The current route remains
      // the intended destination throughout the relay.
      await resolveMe(authClient.getSession(), { handoff: true });
    } finally {
      // A stale check must not clear the lock belonging to a newer session.
      if (seatCheckInFlight.current === checkId) seatCheckInFlight.current = null;
    }
  }, [resolveMe]);

  const enterSeat = useCallback(() => {
    if (membershipRelay.kind !== 'confirmed') return;
    setMe(membershipRelay.me);
    setStatus('authenticated');
  }, [membershipRelay]);

  const value = useMemo<SessionValue>(
    () => ({
      status,
      me,
      providerSession,
      authNotice,
      membershipRelay,
      authProvider: AUTH_PROVIDER,
      signIn,
      devLogin,
      signOut,
      refresh,
      checkSeat,
      enterSeat,
    }),
    [status, me, providerSession, authNotice, membershipRelay, signIn, devLogin, signOut, refresh, checkSeat, enterSeat],
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
  const { me } = useSession();
  // The identity a notice belongs to: actor AND tenant. Either changing (a
  // tenant switch keeps the actor; a re-login keeps neither) must gate it.
  const identityKey = me ? `${me.userId}@${me.tenantSlug}` : 'anon';
  const [notices, setNotices] = useState<Array<Notice & { key: string }>>([]);

  // UX11 disclosure fix: on ANY identity change (sign-out, re-login, tenant
  // switch) drop notices minted under the prior identity, so none can carry a
  // previous actor's name / id / amount forward.
  useEffect(() => {
    setNotices((n) => (n.some((x) => x.key !== identityKey) ? n.filter((x) => x.key === identityKey) : n));
  }, [identityKey]);

  const notify = useCallback(
    (intent: NotifyIntent, message: string) => {
      const id = noticeSeq++;
      setNotices((n) => [...n, { id, intent, message, key: identityKey }]);
    },
    [identityKey],
  );
  const dismiss = useCallback((id: number) => setNotices((n) => n.filter((x) => x.id !== id)), []);
  // Belt-and-braces: even in the render before the effect runs, only
  // current-identity notices are exposed — a session-A notice can never RENDER
  // under session B.
  const visible = useMemo(() => notices.filter((n) => n.key === identityKey), [notices, identityKey]);
  const value = useMemo(() => ({ notices: visible, notify, dismiss }), [visible, notify, dismiss]);
  return <NotifyContext.Provider value={value}>{children}</NotifyContext.Provider>;
}

export function useNotify(): NotifyValue {
  const ctx = useContext(NotifyContext);
  if (!ctx) throw new Error('useNotify must be used within NotificationProvider');
  return ctx;
}
