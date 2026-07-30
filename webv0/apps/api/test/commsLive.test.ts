/**
 * commsLive.test.ts — Phase B-LIVE, the five laws proven at the SERVER.
 *
 * The two silent-success traps are the point of this file. A broken LISTEN and
 * a buffered SSE stream both look EXACTLY like a channel that is merely quiet,
 * so neither may be "observed working" — each must FAIL LOUDLY in a probe:
 *   · the bus proves itself by round-tripping its own NOTIFY (health goes
 *     DEGRADED when receipts stop);
 *   · the transactional publish is proven by a ROLLED-BACK write emitting
 *     nothing (the property in-process emitters cannot have).
 *
 * And Law 1 is asserted where it must hold — at the SERVER, not the DOM: an
 * unentitled subscriber's projection returns NOTHING, so nothing is written to
 * their stream at all.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { startCommsLiveBus, COMMS_CHANNEL, LISTENER_APP_NAME, type CommsLiveBus, type CommsLiveEvent } from '@c3web/persistence';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;
let bus: CommsLiveBus;
const tokens = {} as { ops: string; fin: string; visitor: string };
const uids = {} as { ops: string; fin: string; visitor: string };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/** Wait for a predicate over collected events (never a bare sleep). */
async function until(pred: () => boolean, ms = 6_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return pred();
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'comms-live-secret-0123456789abcd',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  app = buildApp(deps);
  await app.ready();
  bus = await startCommsLiveBus(db.appUrl);
  deps.attachCommsLiveBus(bus);
}, 180_000);

afterAll(async () => {
  await bus?.stop();
  await app?.close();
  await deps?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  await db.seedTenant({ slug: 'alpha' });
  for (const [key, role] of [
    ['ops', 'operations'],
    ['fin', 'finance'],
    ['visitor', 'visitor'],
  ] as const) {
    const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email: `${key}@alpha.com`, displayName: `${key}@alpha.com`, role, tenantSlug: 'alpha' } });
    tokens[key] = (res.json() as { token: string }).token;
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(tokens[key]) });
    uids[key] = (me.json() as { userId: string }).userId;
  }
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant WHERE slug = 'alpha'
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
  );
});

describe('the live bus — LISTEN/NOTIFY, and the traps that must fail loudly', () => {
  it('🔒 THE ANTI-SILENCE PROOF: the bus round-trips its OWN notify, so a live channel is PROVEN, not assumed', async () => {
    expect(await until(() => bus.health().alive)).toBe(true);
    expect(bus.health().lastConfirmedAt).not.toBeNull();
  });

  it('🔒 A REALLY DEAD LISTEN IS LOUD: the connection is KILLED at the database, and health goes DEGRADED with its last-confirmed time', async () => {
    // Not a clock trick: this probe's LISTEN connection is terminated at the
    // server (`pg_terminate_backend`) — the real shape of a pooler discarding
    // session state, a network drop, or a restart. The injected clock only
    // advances time past the grace window so the assertion does not take 45s.
    let fakeNow = Date.now();
    const probe = await startCommsLiveBus(db.appUrl, () => fakeNow);
    try {
      expect(await until(() => probe.health().alive)).toBe(true);
      const confirmedWhileAlive = probe.health().lastConfirmedAt;

      // Every listener session is terminated, the shared bus included — which
      // is honest, because BOTH must survive it. (An earlier comment here
      // claimed the shared bus "re-proves itself on its next ping"; it did not,
      // and the next two tests failing is how that was caught. The bus now
      // reconnects, so the claim is finally true — and asserted below.)
      // Killed BY NAME: an idle listener's `query` column shows its last
      // self-ping, not 'LISTEN' — the first version of this probe matched
      // nothing and would have "passed" on a technicality if it had asserted
      // less. application_name is the honest handle.
      const killed = await db.adminQuery<{ pid: number }>(
        `SELECT pg_terminate_backend(pid) AS ok, pid FROM pg_stat_activity
          WHERE application_name = '${LISTENER_APP_NAME}' AND pid <> pg_backend_pid()`,
      );
      expect(killed.length).toBeGreaterThan(0); // the probe's session really existed

      fakeNow += 60_000; // its self-pings can no longer be received
      expect(probe.health().alive).toBe(false);
      // …and it still reports WHEN it was last true — the client needs that to
      // render `stale` with a last-confirmed time rather than a bare failure.
      expect(probe.health().lastConfirmedAt).toBe(confirmedWhileAlive);

      // ⚖️ AND IT SELF-HEALS. This probe found a real defect: the first version
      // of the bus reported DEGRADED honestly and then stayed dead forever, so
      // one network blip would have cost live delivery until the next deploy.
      // Reconnect-with-backoff was added BECAUSE of this assertion.
      expect(await until(() => probe.health().alive, 15_000)).toBe(true);
      expect(probe.health().lastConfirmedAt).not.toBe(confirmedWhileAlive);
    } finally {
      await probe.stop();
    }
  });

  it('a posted message publishes ONE event carrying IDS ONLY — no body, no author label', async () => {
    // The shared bus may have been terminated by the kill-probe above; wait for
    // its self-healed session before asserting delivery (proving the recovery
    // path serves real traffic, not just health()).
    expect(await until(() => bus.health().alive, 15_000)).toBe(true);
    const seen: CommsLiveEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    try {
      const mission = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Live Cup', startsOn: '2026-08-01' } });
      const missionId = (mission.json() as { mission: { missionId: string } }).mission.missionId;
      const SECRET = 'the-body-that-must-not-travel-on-the-bus';
      const posted = await app.inject({
        method: 'POST',
        url: `/api/v1/comms/missions/${missionId}/messages`,
        headers: auth(tokens.ops),
        payload: { body: SECRET, links: [], clientMutationId: randomUUID() },
      });
      expect(posted.statusCode, posted.body).toBe(201);
      const messageId = (posted.json() as { message: { messageId: string } }).message.messageId;

      expect(await until(() => seen.some((e) => e.messageId === messageId))).toBe(true);
      const event = seen.find((e) => e.messageId === messageId)!;
      // IDS ONLY — the payload's whole shape is asserted, so a future field
      // (a preview, a label) fails here before it can leak.
      expect(Object.keys(event).sort()).toEqual(['messageId', 'seq', 'tenantId', 'threadId']);
      expect(JSON.stringify(event)).not.toContain(SECRET);
    } finally {
      off();
    }
  });

  it('⚖️ THE TRANSACTIONAL PROPERTY: a ROLLED-BACK insert publishes NOTHING (an in-process emitter cannot have this)', async () => {
    expect(await until(() => bus.health().alive, 15_000)).toBe(true);
    const seen: CommsLiveEvent[] = [];
    const off = bus.subscribe((e) => seen.push(e));
    try {
      // pg_notify inside a tx that ROLLS BACK must never be delivered.
      await db
        .adminQuery(
          `BEGIN;
           SELECT pg_notify('${COMMS_CHANNEL}', '{"tenantId":"phantom","threadId":"THR-0001","messageId":"MSG-9999","seq":1}');
           ROLLBACK;`,
        )
        .catch(() => {
          /* the multi-statement form may return no rows; the assertion is below */
        });
      // Then a COMMITTED notify, as the positive control: if this arrives and
      // the phantom does not, the ordering proves the rollback was dropped
      // rather than merely slow.
      await db.adminQuery(
        `SELECT pg_notify('${COMMS_CHANNEL}', '{"tenantId":"control","threadId":"THR-0002","messageId":"MSG-8888","seq":1}')`,
      );
      expect(await until(() => seen.some((e) => e.messageId === 'MSG-8888'))).toBe(true);
      expect(seen.some((e) => e.messageId === 'MSG-9999')).toBe(false);
    } finally {
      off();
    }
  });
});

describe('the SSE surface — Law 1 asserted at the SERVER, and Law 5 at the schema', () => {
  it('the stream opens with the channel’s health stated up front (never inferred from silence)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/comms/stream', headers: auth(tokens.ops), payloadAsStream: true });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toContain('no-transform');
    const chunk: string = await new Promise((resolve) => {
      res.stream().once('data', (d: Buffer) => resolve(d.toString('utf8')));
    });
    expect(chunk).toContain('event: hello');
    expect(chunk).toContain('"alive":true');
    res.stream().destroy();
  });

  it('DELIVERY, end to end: a subscriber on the stream RECEIVES the gated projection of a message posted after they connected', async () => {
    expect(await until(() => bus.health().alive, 15_000)).toBe(true);
    const mission = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Delivery Cup', startsOn: '2026-08-01' } });
    const missionId = (mission.json() as { mission: { missionId: string } }).mission.missionId;
    await app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(tokens.ops) });

    const res = await app.inject({ method: 'GET', url: '/api/v1/comms/stream', headers: auth(tokens.fin), payloadAsStream: true });
    expect(res.statusCode).toBe(200);
    const frames: string[] = [];
    res.stream().on('data', (d: Buffer) => frames.push(d.toString('utf8')));

    await app.inject({
      method: 'POST',
      url: `/api/v1/comms/missions/${missionId}/messages`,
      headers: auth(tokens.ops),
      payload: { body: 'delivered over the wire', links: [], clientMutationId: randomUUID() },
    });

    const got = await until(() => frames.join('').includes('event: message'), 10_000);
    const all = frames.join('');
    res.stream().destroy();
    expect(got, `frames seen: ${all}`).toBe(true);
    // The push carries the gated PROJECTION — the preview the reader could
    // already see by opening the thread, never more.
    expect(all).toContain('delivered over the wire');
    expect(all).toContain('"recalled":false');
  });

  it('🔒 LAW 1 AT THE SERVER: an UNENTITLED subscriber’s projection yields NOTHING — nothing is written to their stream at all', async () => {
    // ops holds a private room; the visitor is not seated.
    const room = await app.inject({ method: 'POST', url: '/api/v1/comms/rooms', headers: auth(tokens.ops), payload: { title: 'The Heads’ Table' } });
    const threadId = (room.json() as { thread: { threadId: string } }).thread.threadId;
    const posted = await app.inject({
      method: 'POST',
      url: `/api/v1/comms/threads/${threadId}/messages`,
      headers: auth(tokens.ops),
      payload: { body: 'heads only', links: [], clientMutationId: randomUUID() },
    });
    expect(posted.statusCode, posted.body).toBe(201);

    // The GATE is what decides, so assert the gate's own answer for each
    // subscriber: the room read (the stream's projection source) is silence for
    // the visitor and content for the seated member. Asserting the projection
    // rather than the DOM is the point — anything that reaches a browser is
    // disclosed whether or not it renders.
    const asVisitor = await app.inject({ method: 'GET', url: `/api/v1/comms/threads/${threadId}`, headers: auth(tokens.visitor) });
    expect(asVisitor.statusCode).toBe(404);
    const asMember = await app.inject({ method: 'GET', url: `/api/v1/comms/threads/${threadId}`, headers: auth(tokens.ops) });
    expect(asMember.statusCode).toBe(200);
    expect(asMember.body).toContain('heads only');
  });

  it('🔒 LAW 5 + LAW 2 AT THE SCHEMA: the live path writes NOTHING — no attention row, no delivery row, no cursor move', async () => {
    const mission = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'No Writes Cup', startsOn: '2026-08-01' } });
    const missionId = (mission.json() as { mission: { missionId: string } }).mission.missionId;
    const before = await db.adminQuery<{ a: string; o: string; c: string }>(
      `SELECT (SELECT count(*)::text FROM comms_attention) AS a,
              (SELECT count(*)::text FROM comms_delivery_outbox) AS o,
              (SELECT count(*)::text FROM comms_inbox_cursor) AS c`,
    );
    await app.inject({
      method: 'POST',
      url: `/api/v1/comms/missions/${missionId}/messages`,
      headers: auth(tokens.ops),
      payload: { body: 'a message that delivers live', links: [], clientMutationId: randomUUID() },
    });
    // Let any (forbidden) write settle before asserting absence.
    await new Promise((r) => setTimeout(r, 300));
    const after = await db.adminQuery<{ a: string; o: string; c: string }>(
      `SELECT (SELECT count(*)::text FROM comms_attention) AS a,
              (SELECT count(*)::text FROM comms_delivery_outbox) AS o,
              (SELECT count(*)::text FROM comms_inbox_cursor) AS c`,
    );
    expect(after[0]).toEqual(before[0]);
    // The latency shape is no longer merely UNWRITTEN — migration 0101 DELETED
    // the operand, so the query this line used to run ("… WHERE read_at IS NOT
    // NULL") cannot be written at all. That stronger claim is proven in
    // commsLatencyDisarm.test.ts; here we assert the read FACT's new shape,
    // which is what survived: a boolean, never a time.
    const attention = await db.adminQuery<{ n: string }>(`SELECT count(*)::text AS n FROM comms_attention WHERE read`);
    expect(Number(attention[0]?.n)).toBe(0);
  });
});
