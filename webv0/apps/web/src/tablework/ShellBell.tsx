/**
 * ShellBell.tsx — the L2 inbox surface on the Tablework frame (pivot W0-1).
 *
 * The Fluent bell's logic verbatim (delivery + acknowledgement only; reading a
 * row acknowledges it; nothing is deleted; the badge wears action blue — an
 * unread count is a nudge, never an alarm). Split into the BUTTON (ContextHeader
 * intent bar) and the DRAWER (one FloatSurface per frame, shared with the
 * narrow bar's Inbox via shellInbox). RECORDED DECISION (Neural-ruled, Aura
 * evidence): the re-skin-era app law kept this drawer opaque ("data never sits
 * on glass"); the committed v1.3.0 contract classes transient drawers as Float
 * — glass, fallback-first, reduced-effects collapse — and the contract wins on
 * converted routes. Testids byte-identical to the AppShell contract.
 */
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../apiClient';
import { useNotifications } from '../queries';
import { ago } from '../shellModel';
import { FloatSurface } from './materials';
import { useShellInbox } from './shellInbox';

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  );
}

export function ShellBellButton() {
  const { setOpen } = useShellInbox();
  const { data } = useNotifications();
  const unread = data?.unreadCount ?? 0;
  return (
    <span className="shell-bell">
      <button
        className="icon-button"
        type="button"
        onClick={() => setOpen(true)}
        data-testid="notif-bell"
        aria-label={unread > 0 ? `Notifications: ${unread} unread` : 'Notifications'}
        title="Notifications"
      >
        <BellIcon />
      </button>
      {unread > 0 && (
        <span className="bell-badge" data-testid="notif-badge" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </span>
  );
}

export function ShellBellDrawer() {
  const { open, setOpen } = useShellInbox();
  const navigate = useNavigate();
  const qc = useQueryClient();
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
    <FloatSurface open={open} onClose={() => setOpen(false)} labelledBy="notif-drawer-title">
      <div className="float-header">
        <div>
          <p className="eyebrow">Delivery and attention</p>
          <h2 id="notif-drawer-title">Notifications</h2>
        </div>
        <div className="message-actions">
          {unread > 0 && (
            <button className="quiet-action" type="button" onClick={markAll} data-testid="notif-mark-all">
              Mark all read
            </button>
          )}
          <button className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
        </div>
      </div>
      <div className="float-body notif-list">
        {notifications.length === 0 ? (
          <div className="notif-empty" data-testid="notif-empty">
            Nothing needs your attention.
          </div>
        ) : (
          notifications.map((n) => (
            <button
              key={n.signalKey}
              type="button"
              className="notif-item"
              data-testid="notif-item"
              data-signal-key={n.signalKey}
              data-read={n.readAt !== null ? 'true' : 'false'}
              onClick={() => openItem(n.signalKey, n.link, n.readAt)}
            >
              <span className={n.readAt === null ? 'notif-dot' : 'notif-dot read'} aria-hidden="true" />
              <span className="notif-body">
                <span className={n.readAt === null ? 'notif-title' : 'notif-title read'}>{n.title}</span>
                <span className="notif-time">{ago(n.emittedAt)}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </FloatSurface>
  );
}
