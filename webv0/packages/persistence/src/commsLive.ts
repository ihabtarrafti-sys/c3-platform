/**
 * commsLive.ts — Phase B-LIVE: the fan-out substrate.
 *
 * PostgreSQL LISTEN/NOTIFY, not an in-process emitter, for three reasons — the
 * third being the one that matters: no new infrastructure; it survives a
 * multi-instance API (an in-process bus silently drops subscribers on other
 * instances, and a live channel that quietly misses messages is worse than
 * none); and **NOTIFY is TRANSACTIONAL** — it fires on COMMIT and never on
 * rollback, so the publish rides the message-insert tx and a rolled-back post
 * cannot produce a phantom toast. The fast path inherits the record's
 * atomicity for free.
 *
 * ⛔ LAW 3 (presence stays refused), answered without theater: routing needs to
 * know which connections are open, so this module does not pretend otherwise —
 * it BOUNDS the map instead. The map is process-local, in-memory and ephemeral;
 * NOTHING is written on connect or disconnect (no session row, no last-seen);
 * and the exported surface is `subscribe()` / `publish()` / `health()` ONLY —
 * there is deliberately no `has(userId)`, no count, no list, so "who is online"
 * is not answerable from here even by a future caller. Presence therefore
 * remains unbuildable without adding a new store, which is the real guarantee.
 *
 * 🔒 THE SILENT-SUCCESS TRAP, PRE-EMPTED: a broken LISTEN (a transaction-mode
 * pooler, a missing grant, a dead socket) looks EXACTLY like a quiet channel.
 * So the bus round-trips its own NOTIFY: it publishes a periodic ping and
 * requires receipt. No ping within the window ⇒ `health()` reports DEGRADED,
 * which the API surfaces so the client's region can go `stale` rather than
 * presenting old content as current. The channel proves itself; it is never
 * assumed to work because nothing arrived. It also RECONNECTS with backoff: a
 * channel that dies once must not stay dead, and health keeps reporting when it
 * was last PROVEN right through the gap.
 */
import { Client } from 'pg';

/** The one channel. Payloads are IDS ONLY — see publishCommsEvent. */
export const COMMS_CHANNEL = 'c3_comms_live';

/** The listener's `application_name` — its identity in pg_stat_activity. */
export const LISTENER_APP_NAME = 'c3_comms_live_listener';

/** What travels: the FACT that a thread advanced. Never a body, never a label —
 *  the per-subscriber gate re-reads content at push time (Law 1, structural). */
export interface CommsLiveEvent {
  readonly tenantId: string;
  readonly threadId: string;
  readonly messageId: string;
  readonly seq: number;
}

interface Ping {
  readonly ping: string;
}

type Listener = (event: CommsLiveEvent) => void;

export interface CommsLiveBus {
  /** Register a fan-out sink. Returns its unsubscribe. */
  subscribe(listener: Listener): () => void;
  /** Is the channel PROVEN alive (a self-ping round-tripped inside the window)? */
  health(): { alive: boolean; lastConfirmedAt: string | null };
  stop(): Promise<void>;
}

const PING_INTERVAL_MS = 15_000;
/** Two missed pings ⇒ degraded. Generous enough to survive one hiccup, tight
 *  enough that a dead LISTEN is a fact within a minute. */
const PING_GRACE_MS = PING_INTERVAL_MS * 2 + 5_000;

/**
 * Start the listener on its OWN session-scoped connection. A pooled client is
 * wrong here: LISTEN is session state, and a transaction-mode pooler would
 * silently discard it — which is precisely why health() exists.
 */
export async function startCommsLiveBus(connectionString: string, now: () => number = Date.now): Promise<CommsLiveBus> {
  const listeners = new Set<Listener>();
  let lastPingAt: number | null = null;
  let stopped = false;
  let client: Client | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 250;

  const deliver = (payload: string): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return; // an unparseable payload is not an event; never guess
    }
    if (parsed !== null && typeof parsed === 'object' && 'ping' in (parsed as Ping)) {
      lastPingAt = now();
      return;
    }
    const e = parsed as CommsLiveEvent;
    if (typeof e?.threadId !== 'string' || typeof e?.messageId !== 'string' || typeof e?.tenantId !== 'string') return;
    for (const l of listeners) {
      try {
        l(e);
      } catch {
        /* one sink's failure never stops the others */
      }
    }
  };

  const ping = async (): Promise<void> => {
    if (stopped || !client) return;
    try {
      await client.query(`SELECT pg_notify($1, $2)`, [COMMS_CHANNEL, JSON.stringify({ ping: 'self' })]);
    } catch {
      /* the missed receipt is the signal — no need to interpret the error */
    }
  };

  /**
   * RECONNECT, because a listener that dies once must not stay dead. The first
   * version of this bus reported DEGRADED honestly and then never recovered —
   * a single network blip would have cost live delivery until the next deploy.
   * The probe that kills the connection at the database is what surfaced it.
   *
   * `lastPingAt` is deliberately NOT reset here: health must keep telling the
   * truth about when the channel was last PROVEN, right through the gap.
   */
  const connect = async (): Promise<void> => {
    if (stopped) return;
    const c = new Client({
      connectionString,
      application_name: LISTENER_APP_NAME,
      options: '-c client_encoding=UTF8',
    });
    // A dropped session must not crash the process: pg emits 'error' on a
    // terminated backend, and an unhandled one is fatal.
    c.on('error', () => void scheduleReconnect());
    c.on('end', () => void scheduleReconnect());
    c.on('notification', (msg) => {
      if (msg.payload) deliver(msg.payload);
    });
    await c.connect();
    await c.query(`LISTEN ${COMMS_CHANNEL}`);
    client = c;
    backoffMs = 250; // a successful attach resets the ladder
    await ping(); // prove the NEW session immediately, never assume it
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer) return;
    const previous = client;
    client = null;
    previous?.end().catch(() => {});
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect().catch(() => scheduleReconnect());
    }, backoffMs);
    reconnectTimer.unref?.();
    backoffMs = Math.min(backoffMs * 2, 5_000);
  };

  await connect();
  const timer = setInterval(() => void ping(), PING_INTERVAL_MS);
  timer.unref?.();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    health() {
      const alive = lastPingAt !== null && now() - lastPingAt < PING_GRACE_MS;
      return { alive, lastConfirmedAt: lastPingAt === null ? null : new Date(lastPingAt).toISOString() };
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      listeners.clear();
      await client?.end().catch(() => {});
    },
  };
}
