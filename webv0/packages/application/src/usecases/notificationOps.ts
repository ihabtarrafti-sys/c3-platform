/**
 * notificationOps — S10: the L2 inbox. Rows are written by (a) the approval
 * pipeline fan-out (inside appendApprovalEvent's transaction) and (b) the
 * derived-signal CROSSING SWEEP below, invoked when the Situation Room is
 * read — deterministic, no daemon, and the dedupe UNIQUE means observing a
 * condition twice never notifies twice. Signals stay derived; these rows
 * are delivery + acknowledgement only.
 */
import type { Actor, C3Notification, Signal } from '@c3web/domain';
import type { Persistence } from '../ports';

const INBOX_CAP = 100;

export interface NotificationInbox {
  readonly notifications: readonly C3Notification[];
  readonly unreadCount: number;
}

/** The actor's own inbox — identity-scoped by construction. */
export async function listNotifications(p: Persistence, actor: Actor): Promise<NotificationInbox> {
  const rows = await p.reads.forActor(actor).listNotifications(actor.identity, INBOX_CAP);
  return { notifications: rows, unreadCount: rows.filter((n) => n.readAt === null).length };
}

export async function markNotificationRead(p: Persistence, actor: Actor, signalKey: string): Promise<void> {
  await p.writes.transaction(actor, (tx) => tx.markNotificationRead(actor.identity, signalKey));
}

export async function markAllNotificationsRead(p: Persistence, actor: Actor): Promise<number> {
  return p.writes.transaction(actor, (tx) => tx.markAllNotificationsRead(actor.identity));
}

/** Route a signal's primary action to an in-app link (default: the cockpit). */
function signalLink(signal: Signal): string {
  const a = signal.actions[0];
  if (a?.missionId) return `/missions/${a.missionId}`;
  if (a?.approvalId) return `/approvals/${a.approvalId}`;
  if (a?.agreementId) return `/agreements/${a.agreementId}`;
  if (a?.personId) return `/people/${a.personId}`;
  return '/situation';
}

/**
 * The crossing sweep: called after the situation engine ran (owner/ops
 * surface). Each CURRENT signal lands one row per operational recipient —
 * ON CONFLICT DO NOTHING makes re-observation free. Failures never break
 * the read (the cockpit's truth does not depend on delivery).
 */
export async function sweepSignalNotifications(
  p: Persistence,
  actor: Actor,
  signals: readonly Signal[],
  recipients: readonly string[],
): Promise<void> {
  if (signals.length === 0 || recipients.length === 0) return;
  try {
    await p.writes.transaction(actor, async (tx) => {
      for (const signal of signals) {
        if (signal.band === 'inMotion') continue; // already being handled — no new attention row
        for (const identity of recipients) {
          await tx.insertNotification({
            userIdentity: identity,
            signalKey: signal.key,
            kind: signal.kind,
            title: signal.headline,
            link: signalLink(signal),
          });
        }
      }
    });
  } catch {
    // Delivery is best-effort; the situation read stays truthful regardless.
  }
}
