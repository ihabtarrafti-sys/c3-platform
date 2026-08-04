/**
 * commsStream.ts — Phase B-LIVE: the SSE surface.
 *
 * ⛔ LAW 1, MADE STRUCTURAL: the bus payload is ids only, and for EACH
 * subscriber this route runs the per-kind thread gate at PUSH TIME and then
 * re-reads the message through the SAME tombstone-joined spine the thread read
 * uses. An unentitled subscriber has NOTHING written to their stream — so
 * "the client never receives-then-filters" is not a rule the client must obey,
 * it is a state the client cannot reach. Two consequences fall out for free:
 * the toast's content ceiling IS the thread's own projection, and a recalled
 * message pushes as its tombstone automatically.
 *
 * ⛔ LAW 5: this route writes NOTHING — no cursor advance, no receipt, no
 * attention row, no delivery timestamp. A toast that appeared is not a receipt,
 * and no per-person delivery→read interval is recorded anywhere, so none can
 * be derived later (Law 2: the read layer cannot rank what the write layer
 * never recorded).
 *
 * 🔒 The heartbeat is the anti-buffering proof: a buffered stream delivers
 * nothing, INCLUDING heartbeats, so the client's missing-heartbeat detector
 * turns "silently buffered" into "visibly stale". The bus's own health rides
 * the same channel, so a broken LISTEN surfaces too.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CommsLiveBus } from '@c3web/persistence';
import { getThreadRoom } from '@c3web/application';
import { isDomainError, type Actor } from '@c3web/domain';
import type { Persistence } from '@c3web/application';

const HEARTBEAT_MS = 10_000;

/** What a subscriber may be told about a message, once gated. */
interface StreamPush {
  readonly threadId: string;
  readonly messageId: string;
  readonly seq: number;
  readonly authorLabel: string | null;
  /** Present only when the viewer may see it; absent for a recalled message. */
  readonly preview?: string;
  readonly recalled: boolean;
}

/**
 * The gate + projection for ONE subscriber and ONE event. Returns null when
 * this subscriber may learn nothing — including the event's existence.
 *
 * It deliberately reuses the ordinary thread read rather than a bespoke query:
 * the same gate, the same spine, the same recall semantics. A separate "stream
 * read" would be a second disclosure surface to keep in sync, which is how
 * leaks are born. (`getThreadRoom` covers ANCHORED threads too — the per-kind
 * gate lives inside it — so one path serves every kind. The cost is one page
 * read per subscriber per event; correctness first, and the read is the one
 * already optimized by ReadStore.batch.)
 */
async function projectForSubscriber(
  p: Persistence,
  actor: Actor,
  threadId: string,
  messageId: string,
): Promise<StreamPush | null> {
  try {
    const room = await getThreadRoom(p, actor, threadId, { limit: 50 });
    const hit = room.messages.find((m) => m.messageId === messageId);
    if (!hit) return null;
    return hit.recalled !== undefined
      ? { threadId, messageId, seq: hit.seq, authorLabel: hit.authorship.label, recalled: true }
      : {
          threadId,
          messageId,
          seq: hit.seq,
          authorLabel: hit.authorship.label,
          recalled: false,
          preview: hit.body.slice(0, 140),
        };
  } catch (err) {
    // ⛔ CR-013. This was a bare `catch { return null }`, and the comment named
    // only the CONCEALMENT arms — not entitled, not seated, thread gone — which
    // are correctly silent, because silence is the same posture the 404 takes.
    //
    // But the same catch also absorbed **database and runtime failures**, and the
    // heartbeat reports health from the live BUS alone. So projection could be
    // failing for every event on the stream while `alive: true` went out every
    // few seconds. *A subscriber cannot distinguish "nothing is happening" from
    // "everything is failing" — and the instrument said things were fine.*
    //
    // A `DomainError` is a decision the product made and stated; anything else is
    // a surprise, and a surprise must not be reported as a governed silence.
    if (isDomainError(err)) return null;
    throw err;
  }
}

export function registerCommsStream(
  app: FastifyInstance,
  // The bus arrives via a GETTER, not a value: it is attached AFTER boot (its
  // LISTEN connection is established asynchronously), so capturing the value at
  // registration time would pin `null` forever and the stream would be
  // permanently DEGRADED while looking perfectly healthy in code review.
  deps: { P: Persistence; getBus: () => CommsLiveBus | null; actorOf: (req: FastifyRequest) => Actor },
): void {
  app.get('/api/v1/comms/stream', async (req: FastifyRequest, reply: FastifyReply) => {
    const actor = deps.actorOf(req);
    const bus = deps.getBus();

    // ⚠️ MERGE fastify's computed headers, never replace them. Writing to
    // `reply.raw` bypasses fastify's header pipeline entirely, so anything a
    // hook has already set — CORS above all — is LOST unless carried across
    // deliberately. `app.inject` cannot catch this (it has no origin policy),
    // so the browser was the only instrument that could: the stream failed
    // with a bare "Failed to fetch" while every server-side test passed.
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string | number | string[]>),
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Defeats nginx-style proxy buffering where honored; the heartbeat
      // detector is the guarantee where it is not.
      'x-accel-buffering': 'no',
    });

    const send = (event: string, data: unknown): void => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // The channel states its own health up front, so a client that connects to
    // a DEGRADED bus knows immediately rather than inferring from silence.
    send('hello', { alive: bus?.health().alive ?? false, lastConfirmedAt: bus?.health().lastConfirmedAt ?? null });

    const unsubscribe =
      bus?.subscribe((e) => {
        if (e.tenantId !== actor.tenantId) return; // tenancy first, always
        void (async () => {
          try {
            const push = await projectForSubscriber(deps.P, actor, e.threadId, e.messageId);
            if (push) send('message', push);
          } catch (err) {
            // ⛔ CR-013, the half that makes the throw useful. An unexpected
            // projection failure is now LOGGED — it was previously absorbed with
            // no trace anywhere — and the subscriber is told the stream is not
            // healthy, instead of receiving heartbeats that describe only the bus.
            //
            // ⚖️ The client's whole contract here is "go stale rather than trust
            // silence". Reporting `alive: true` while projection fails is the one
            // thing that breaks it, because silence then looks like calm.
            req.log.error({ err, threadId: e.threadId }, 'comms stream projection failed');
            send('health', { alive: false, lastConfirmedAt: bus?.health().lastConfirmedAt ?? null });
          }
        })();
      }) ?? (() => {});

    const heartbeat = setInterval(() => {
      const h = bus?.health() ?? { alive: false, lastConfirmedAt: null };
      // A comment frame keeps proxies honest; the health event lets the client
      // distinguish "quiet" from "broken" without guessing.
      reply.raw.write(`: heartbeat\n\n`);
      send('health', h);
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      // NOTHING is written on disconnect: no session row, no last-seen. A
      // dropped connection leaves no trace anywhere (Law 3).
    });

    // Keep the request open; fastify must not serialize a reply for a stream.
    return reply;
  });
}
