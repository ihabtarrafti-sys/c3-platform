/**
 * NotificationRegion — hosted-safe inline feedback surface (Sprint 33, RISK-1).
 *
 * The Fluent v9 <Toaster> is intentionally omitted in the SPFx-hosted host
 * (config.disableToasts === true) because its registration fails in that
 * environment (see App.tsx / TD-16). As a result, every governed-write outcome
 * dispatched through useToast() — submit / approve / reject / self-approval
 * refusal / execution success / execution FAILURE / recovery — was silent when
 * hosted: users saw no confirmation and, critically, no failure signal.
 *
 * This component provides an always-mounted, Toaster-independent notification
 * channel. It uses ONLY plain DOM (no Fluent Toaster / Tabster surface) so it
 * renders reliably in the hosted environment. useToast() routes to it when
 * toasts are disabled; when the Fluent Toaster is enabled (Mock / local host)
 * behaviour is unchanged (Mock DSM parity preserved).
 *
 * Accessibility: the region is an aria-live container; errors are assertive
 * alerts, successes are polite status messages. Messages auto-dismiss and can
 * be dismissed manually. No PII/token handling — callers pass short strings.
 */

import { createContext, useCallback, useContext, useRef, useState } from 'react';

export type C3NotificationIntent = 'success' | 'error';

export interface C3Notification {
  id: number;
  intent: C3NotificationIntent;
  title: string;
  body?: string;
}

interface NotificationApi {
  notify: (n: Omit<C3Notification, 'id'>) => void;
}

const NotificationContext = createContext<NotificationApi | null>(null);

/** Max concurrently-visible notifications. */
const MAX_VISIBLE = 4;
const SUCCESS_TTL_MS = 4000;
const ERROR_TTL_MS = 8000;

/**
 * Access the inline notification channel. Fails safe to a no-op if used
 * outside the provider (should not happen — provider wraps the app shell).
 */
export const useNotifications = (): NotificationApi => {
  const ctx = useContext(NotificationContext);
  return ctx ?? { notify: () => { /* no-op fail-safe */ } };
};

export const NotificationProvider = ({ children }: { children: React.ReactNode }) => {
  const [items, setItems] = useState<C3Notification[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems(prev => prev.filter(i => i.id !== id));
  }, []);

  const notify = useCallback((n: Omit<C3Notification, 'id'>) => {
    idRef.current += 1;
    const id = idRef.current;
    setItems(prev => [...prev, { ...n, id }].slice(-MAX_VISIBLE));
    const ttl = n.intent === 'error' ? ERROR_TTL_MS : SUCCESS_TTL_MS;
    setTimeout(() => {
      setItems(prev => prev.filter(i => i.id !== id));
    }, ttl);
  }, []);

  return (
    <NotificationContext.Provider value={{ notify }}>
      {children}
      <NotificationRegion items={items} onDismiss={dismiss} />
    </NotificationContext.Provider>
  );
};

// ---------------------------------------------------------------------------
// Presentational region — plain DOM only (no Fluent Toaster/Tabster surface).
// ---------------------------------------------------------------------------

const PALETTE: Record<C3NotificationIntent, { bg: string; border: string; fg: string; dot: string }> = {
  success: { bg: '#f1faf1', border: '#9fd89f', fg: '#0e700e', dot: '#107c10' },
  error:   { bg: '#fdf3f4', border: '#f3d6d8', fg: '#a4262c', dot: '#a4262c' },
};

const NotificationRegion = ({
  items,
  onDismiss,
}: {
  items: C3Notification[];
  onDismiss: (id: number) => void;
}) => {
  if (items.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        zIndex: 1000000,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 420,
        pointerEvents: 'none',
        fontFamily: 'Segoe UI, system-ui, sans-serif',
      }}
    >
      {items.map(n => {
        const c = PALETTE[n.intent];
        return (
          <div
            key={n.id}
            role={n.intent === 'error' ? 'alert' : 'status'}
            style={{
              pointerEvents: 'auto',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 6,
              border: `1px solid ${c.border}`,
              background: c.bg,
              boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
            }}
          >
            <span
              aria-hidden="true"
              style={{ width: 8, height: 8, borderRadius: 8, background: c.dot, marginTop: 6, flexShrink: 0 }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: c.fg, fontWeight: 600, fontSize: 13.5, lineHeight: '18px' }}>{n.title}</div>
              {n.body && (
                <div style={{ color: '#3b3a39', fontSize: 12.5, lineHeight: '17px', marginTop: 2 }}>{n.body}</div>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(n.id)}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#605e5c',
                cursor: 'pointer',
                fontSize: 14,
                lineHeight: '14px',
                padding: 2,
                flexShrink: 0,
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
};
