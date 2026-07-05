/**
 * session.tsx — client session + inline notifications.
 *
 * Auth is via the development dev-login (the API's dev IdP). Browser-side role
 * checks here are UX-only; the API is the authoritative enforcement boundary.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setToken, getToken, type MeResponse } from './api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface SessionValue {
  status: Status;
  me: MeResponse | null;
  login(input: { email: string; role: string; tenantSlug: string }): Promise<void>;
  logout(): void;
  refresh(): Promise<void>;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);

  const loadMe = useCallback(async () => {
    if (!getToken()) {
      setMe(null);
      setStatus('anonymous');
      return;
    }
    try {
      const m = await api.me();
      setMe(m);
      setStatus('authenticated');
    } catch {
      setToken(null);
      setMe(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  const login = useCallback(
    async (input: { email: string; role: string; tenantSlug: string }) => {
      const res = await api.devLogin(input);
      setToken(res.token);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(() => {
    setToken(null);
    setMe(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<SessionValue>(() => ({ status, me, login, logout, refresh: loadMe }), [status, me, login, logout, loadMe]);
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
