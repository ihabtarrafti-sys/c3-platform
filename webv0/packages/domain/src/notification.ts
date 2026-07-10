/**
 * notification.ts — S10, Layer 2 of the notification model (the
 * pressure-tested taxonomy, sealed in the plan of record):
 *
 *   L1 toasts (ephemeral UX)  ·  L2 THIS — per-user ack-able attention rows
 *   L3 record activity = a projection of L4  ·  L4 the audit stream (sacred)
 *   L5 email = a DELIVERY CHANNEL of L2, never a separate system.
 *
 * The law here: SIGNALS STAY DERIVED. "Expiring soon" is a condition
 * becoming true, not an event — so the engine keeps deriving it fresh every
 * read, and only DELIVERY (this row) and ACKNOWLEDGEMENT (read_at) are
 * stored. UNIQUE (tenant, user, signal_key) = dedupe-on-first-crossing:
 * one row per condition per user, ever, no matter how often it is observed.
 */

export interface C3Notification {
  readonly tenantId: string;
  /** The recipient (email identity). */
  readonly userIdentity: string;
  /** Stable key — the dedupe identity (a signal key, or APR-XXXX:Status). */
  readonly signalKey: string;
  /** 'pipeline' for approval transitions; otherwise the signal kind. */
  readonly kind: string;
  readonly title: string;
  /** In-app route the row links to. */
  readonly link: string;
  readonly emittedAt: string;
  readonly readAt: string | null;
}
