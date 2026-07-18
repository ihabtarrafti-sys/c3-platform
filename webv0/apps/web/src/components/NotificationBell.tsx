import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Popover,
  PopoverSurface,
  PopoverTrigger,
  makeStyles,
} from '@fluentui/react-components';
import { api } from '../apiClient';
import { useNotifications } from '../queries';

/**
 * NotificationBell — S10, the L2 inbox surface. The rows it shows are
 * delivery + acknowledgement ONLY: signals stay derived in the engine, the
 * pipeline fan-out narrates approvals, and dedupe-on-first-crossing means a
 * condition observed a hundred times is still one row. Reading a row here
 * (clicking it) acknowledges it; nothing is ever deleted.
 *
 * Surface law (Direction E): the popover is a MATTE panel — notification rows
 * are data, and data never sits on glass.
 */

const useStyles = makeStyles({
  wrap: { position: 'relative', display: 'inline-flex' },
  bellButton: {
    minWidth: '36px',
    height: '36px',
    padding: '0',
    color: 'var(--c3-ink-mid)',
    ':hover': { color: 'var(--c3-ink)' },
  },
  badge: {
    position: 'absolute',
    // QA sweep: anchored over the glyph, a 2-digit badge covered most of the
    // bell — offset to the icon's top-right corner instead.
    top: '-4px',
    right: '-6px',
    minWidth: '16px',
    height: '16px',
    padding: '0 4px',
    borderRadius: '8px',
    backgroundColor: 'var(--c3-attention)',
    color: '#ffffff',
    fontSize: '10px',
    fontWeight: 700,
    lineHeight: '16px',
    textAlign: 'center',
    fontFamily: 'var(--c3-font-mono)',
    pointerEvents: 'none',
  },
  surface: {
    width: 'min(380px, 92vw)',
    maxHeight: '70vh',
    overflowY: 'auto',
    padding: '0',
    borderRadius: 'var(--c3-radius-float)',
    backgroundColor: 'var(--c3-surface-raised)',
    border: '1px solid var(--c3-hairline)',
    boxShadow: 'var(--c3-e2)',
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: '1px solid var(--c3-hairline)',
  },
  headTitle: {
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--c3-ink-mid)',
  },
  empty: {
    padding: '24px 16px',
    fontSize: '13px',
    color: 'var(--c3-ink-mid)',
    textAlign: 'center',
  },
  item: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '10px',
    width: '100%',
    padding: '10px 16px',
    border: 'none',
    borderBottom: '1px solid var(--c3-hairline)',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    textAlign: 'left',
    ':hover': { backgroundColor: 'var(--c3-hover)' },
    ':last-child': { borderBottom: 'none' },
  },
  dot: {
    flexShrink: 0,
    width: '7px',
    height: '7px',
    borderRadius: '50%',
    marginTop: '5px',
    backgroundColor: 'var(--c3-brand)',
  },
  dotRead: { backgroundColor: 'transparent' },
  itemBody: { display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 },
  itemTitle: { fontSize: '13px', color: 'var(--c3-ink)', lineHeight: '1.35' },
  itemTitleRead: { color: 'var(--c3-ink-mid)' },
  itemTime: {
    fontSize: '11px',
    color: 'var(--c3-ink-muted)',
    fontFamily: 'var(--c3-font-mono)',
  },
});

function BellIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

/** "3m" / "2h" / "5d" / date — honest, compact recency. */
function ago(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d`;
  return new Date(iso).toISOString().slice(0, 10);
}

export function NotificationBell() {
  const s = useStyles();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data } = useNotifications();

  const notifications = data?.notifications ?? [];
  const unread = data?.unreadCount ?? 0;

  const refresh = () => void qc.invalidateQueries({ queryKey: ['notifications'] });

  const openItem = (signalKey: string, link: string, readAt: string | null) => {
    setOpen(false);
    if (readAt === null) api.markNotificationRead(signalKey).then(refresh, refresh);
    navigate(link);
  };

  const markAll = () => {
    api.markAllNotificationsRead().then(refresh, refresh);
  };

  return (
    <div className={s.wrap}>
      <Popover open={open} onOpenChange={(_, d) => setOpen(d.open)} positioning="below-end" trapFocus>
        <PopoverTrigger disableButtonEnhancement>
          <Button
            appearance="transparent"
            className={s.bellButton}
            data-testid="notif-bell"
            aria-label={unread > 0 ? `Notifications: ${unread} unread` : 'Notifications'}
            title="Notifications"
          >
            <BellIcon />
          </Button>
        </PopoverTrigger>
        <PopoverSurface className={s.surface}>
          <div className={s.head}>
            <span className={s.headTitle}>Notifications</span>
            {unread > 0 && (
              <Button appearance="transparent" size="small" onClick={markAll} data-testid="notif-mark-all">
                Mark all read
              </Button>
            )}
          </div>
          {notifications.length === 0 ? (
            <div className={s.empty} data-testid="notif-empty">
              Nothing needs your attention.
            </div>
          ) : (
            notifications.map((n) => (
              <button
                key={n.signalKey}
                type="button"
                className={s.item}
                data-testid="notif-item"
                data-signal-key={n.signalKey}
                data-read={n.readAt !== null ? 'true' : 'false'}
                onClick={() => openItem(n.signalKey, n.link, n.readAt)}
              >
                <span className={n.readAt === null ? s.dot : `${s.dot} ${s.dotRead}`} aria-hidden="true" />
                <span className={s.itemBody}>
                  <span className={n.readAt === null ? s.itemTitle : `${s.itemTitle} ${s.itemTitleRead}`}>{n.title}</span>
                  <span className={s.itemTime}>{ago(n.emittedAt)}</span>
                </span>
              </button>
            ))
          )}
        </PopoverSurface>
      </Popover>
      {unread > 0 && (
        <span className={s.badge} data-testid="notif-badge" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </div>
  );
}
