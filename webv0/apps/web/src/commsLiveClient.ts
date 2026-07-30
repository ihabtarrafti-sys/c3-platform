/**
 * commsLiveClient.ts — Phase B-LIVE (client): the live channel as a WITNESS.
 *
 * ⚠️ TRANSPORT NOTE — why `fetch` + a stream reader and NOT `EventSource`:
 * the browser's EventSource API cannot carry an `Authorization` header, and
 * the only way to authenticate it would be a token in the query string. A
 * bearer token in a URL is written to proxy logs, browser history and
 * referrers — the standing rule is that sensitive data never travels in URL
 * parameters, so the API that forces it is the API we do not use. `fetch`
 * carries the header, gives us the same event framing, and lets us implement
 * reconnect deliberately rather than inheriting a black box.
 *
 * THE HEALTH CONTRACT (Phase A composed): a live connection is a witness whose
 * health is a fact.
 *   · frames arriving, heartbeat fresh → the region reads normally;
 *   · heartbeat missed (2× the server's interval) or the server reports the
 *     bus DEGRADED → `stale`, carrying the LAST CONFIRMED time;
 *   · never confirmed at all → the region keeps the fetched view readable but
 *     stale, and governed actions stay absent until the channel proves itself.
 * A buffered stream delivers nothing INCLUDING heartbeats, so buffering
 * surfaces as staleness rather than as a healthy-looking socket.
 *
 * RECONNECT RE-WITNESSES: a resumed stream proves the CONNECTION, not the
 * CONTENT — so on every (re)connect the client refetches rather than assuming
 * its cached rows are current.
 */

/** The server's heartbeat is 10s; two missed beats is the staleness line. */
const HEARTBEAT_GRACE_MS = 25_000;
const RECONNECT_BASE_MS = 500;
const RECONNECT_MAX_MS = 10_000;

export interface CommsLivePush {
  readonly threadId: string;
  readonly messageId: string;
  readonly seq: number;
  readonly authorLabel: string | null;
  readonly preview?: string;
  readonly recalled: boolean;
}

export interface CommsLiveState {
  /** The stream is open AND its heartbeat is fresh AND the bus is alive. */
  readonly healthy: boolean;
  /** When the channel was last PROVEN — the stale stamp's timestamp. */
  readonly lastConfirmedAt: string | null;
}

export interface CommsLiveHandlers {
  onPush(push: CommsLivePush): void;
  /** Fired on every (re)connect: the region must RE-WITNESS, never assume. */
  onReconnect(): void;
  onState(state: CommsLiveState): void;
}

/**
 * Open the live channel. Returns a stop function. Never throws: a channel that
 * cannot open reports unhealthy and keeps retrying — the surface stays honest
 * either way.
 */
export function openCommsLive(
  baseUrl: string,
  getToken: () => Promise<string | null> | string | null,
  handlers: CommsLiveHandlers,
): () => void {
  let stopped = false;
  let controller: AbortController | null = null;
  let backoff = RECONNECT_BASE_MS;
  let lastFrameAt = 0;
  let lastConfirmedAt: string | null = null;
  let busAlive = false;

  const emitState = (): void => {
    const fresh = lastFrameAt !== 0 && Date.now() - lastFrameAt < HEARTBEAT_GRACE_MS;
    handlers.onState({ healthy: fresh && busAlive, lastConfirmedAt });
  };

  // The staleness detector runs on a timer, not on frames: a stream that goes
  // silent produces NO event to react to, which is precisely the failure mode.
  const watchdog = setInterval(emitState, 5_000);

  const consume = async (): Promise<void> => {
    controller = new AbortController();
    const token = await getToken();
    const res = await fetch(`${baseUrl}/api/v1/comms/stream`, {
      headers: {
        accept: 'text/event-stream',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`stream ${res.status}`);

    lastFrameAt = Date.now();
    handlers.onReconnect(); // re-witness: the connection is proven, not the content
    backoff = RECONNECT_BASE_MS;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      lastFrameAt = Date.now(); // ANY frame, comment included, proves liveness
      buffer += decoder.decode(value, { stream: true });
      let cut = buffer.indexOf('\n\n');
      while (cut !== -1) {
        const raw = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        cut = buffer.indexOf('\n\n');
        const eventLine = raw.split('\n').find((l) => l.startsWith('event: '));
        const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
        if (!eventLine || !dataLine) continue; // a bare `: heartbeat` comment
        const name = eventLine.slice(7).trim();
        let payload: unknown;
        try {
          payload = JSON.parse(dataLine.slice(6));
        } catch {
          continue;
        }
        if (name === 'hello' || name === 'health') {
          const h = payload as { alive: boolean; lastConfirmedAt: string | null };
          busAlive = h.alive;
          lastConfirmedAt = h.lastConfirmedAt;
          emitState();
        } else if (name === 'message') {
          handlers.onPush(payload as CommsLivePush);
        }
      }
    }
  };

  const loop = async (): Promise<void> => {
    while (!stopped) {
      try {
        await consume();
      } catch {
        /* the reconnect below is the whole response */
      }
      busAlive = false;
      emitState();
      if (stopped) return;
      await new Promise((r) => setTimeout(r, backoff));
      backoff = Math.min(backoff * 2, RECONNECT_MAX_MS);
    }
  };
  void loop();

  return () => {
    stopped = true;
    clearInterval(watchdog);
    controller?.abort();
  };
}
