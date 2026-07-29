/**
 * commsSpaces.test.ts — Phase B (activation): the laws of rooms, DMs and the
 * attention ledger, proven adversarially.
 *
 *  - CONCEALMENT IS UNIFORM: a non-member's read of a room/DM is the thread's
 *    own 404, byte-shaped like a thread that never existed — not even owners
 *    get existence.
 *  - STANDING IS DERIVED: a removed member loses the room at the NEXT read;
 *    nothing is snapshotted.
 *  - THE ROOM LOG IS THE RECORD: membership changes append 0090's own event
 *    vocabulary in the same tx.
 *  - DM CONVERGENCE: concurrent opens of the same pair converge on ONE thread
 *    (the hash unique, raced for real).
 *  - RETENTION RIDES THE INSERT: DM messages carry retention_due_at; anchored
 *    and room messages carry NULL.
 *  - THE LEDGER IS ME-PREDICATED: each caller sees only their stations; unread
 *    is re-derived from lastSeq − cursor (instance 8 — never carried).
 *  - THE RECALL LANE FOLLOWED THE SPINE: author-recall works inside a DM and
 *    the recalled arm is structurally bodiless there too.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;
const tokens = {} as { owner: string; ops: string; fin: string; visitor: string };
const uids = {} as { owner: string; ops: string; fin: string; visitor: string };

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function login(email: string, role: string): Promise<{ token: string; userId: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug: 'alpha' } });
  expect(res.statusCode, res.body).toBe(200);
  const token = (res.json() as { token: string }).token;
  const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(token) });
  return { token, userId: (me.json() as { userId: string }).userId };
}

async function entitle(): Promise<void> {
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant WHERE slug = 'alpha'
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active', effective_until = NULL`,
  );
}

const createRoom = (t: string, title = 'The Heads’ Table') =>
  app.inject({ method: 'POST', url: '/api/v1/comms/rooms', headers: auth(t), payload: { title } });
const invite = (t: string, threadId: string, userId: string, role: 'member' | 'admin' = 'member') =>
  app.inject({ method: 'POST', url: `/api/v1/comms/threads/${threadId}/participants`, headers: auth(t), payload: { userId, role } });
const remove = (t: string, threadId: string, userId: string) =>
  app.inject({ method: 'POST', url: `/api/v1/comms/threads/${threadId}/participants/${userId}/remove`, headers: auth(t) });
const readRoom = (t: string, threadId: string) =>
  app.inject({ method: 'GET', url: `/api/v1/comms/threads/${threadId}`, headers: auth(t) });
const postTo = (t: string, threadId: string, body: string) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/comms/threads/${threadId}/messages`,
    headers: auth(t),
    payload: { body, links: [], clientMutationId: randomUUID() },
  });
const openDm = (t: string, otherUserId: string) =>
  app.inject({ method: 'POST', url: '/api/v1/comms/direct', headers: auth(t), payload: { otherUserId } });

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'comms-spaces-secret-0123456789ab',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  app = buildApp(deps);
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await deps?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  await db.seedTenant({ slug: 'alpha' });
  for (const [key, role] of [
    ['owner', 'owner'],
    ['ops', 'operations'],
    ['fin', 'finance'],
    ['visitor', 'visitor'],
  ] as const) {
    const { token, userId } = await login(`${key}@alpha.com`, role);
    tokens[key] = token;
    uids[key] = userId;
  }
  await entitle();
});

describe('the Heads’ Table — v1’s ONE private class', () => {
  it('creation is operational-only; the creator takes the admin seat; the log opens with Created', async () => {
    expect((await createRoom(tokens.fin)).statusCode).toBe(403);
    expect((await createRoom(tokens.visitor)).statusCode).toBe(403);
    const res = await createRoom(tokens.ops);
    expect(res.statusCode, res.body).toBe(201);
    const threadId = (res.json() as { thread: { threadId: string } }).thread.threadId;
    const room = await readRoom(tokens.ops, threadId);
    expect(room.statusCode, room.body).toBe(200);
    const j = room.json() as { participants: Array<{ userId: string; role: string }>; events: Array<{ eventType: string }> };
    expect(j.participants).toEqual([{ userId: uids.ops, role: 'admin', displayName: 'ops@alpha.com' }]);
    expect(j.events.map((e) => e.eventType)).toEqual(['Created']);
  });

  it('CONCEALMENT IS UNIFORM: a non-member — owner included — gets the room’s own 404, byte-shaped like a room that never existed', async () => {
    const created = await createRoom(tokens.ops);
    const threadId = (created.json() as { thread: { threadId: string } }).thread.threadId;

    const nonMember = await readRoom(tokens.owner, threadId);
    const neverExisted = await readRoom(tokens.owner, 'THR-9999');
    expect(nonMember.statusCode).toBe(404);
    expect(neverExisted.statusCode).toBe(404);
    // The SHAPE is identical up to the echoed id — existence never leaks.
    const norm = (b: string, id: string) => b.replaceAll(id, 'THR-X').replace(/"correlationId":"[^"]+"/, '');
    expect(norm(nonMember.body, threadId)).toBe(norm(neverExisted.body, 'THR-9999'));
    // And a non-member cannot post, invite, or remove — same absence.
    expect((await postTo(tokens.owner, threadId, 'knock knock')).statusCode).toBe(404);
    expect((await invite(tokens.owner, threadId, uids.fin)).statusCode).toBe(404);
  });

  it('STANDING IS DERIVED PER READ: invited → reads; removed → the very next read is the room’s own 404; the log holds both acts', async () => {
    const created = await createRoom(tokens.ops);
    const threadId = (created.json() as { thread: { threadId: string } }).thread.threadId;
    expect((await invite(tokens.ops, threadId, uids.fin)).statusCode, 'invite').toBe(200);
    expect((await readRoom(tokens.fin, threadId)).statusCode).toBe(200);

    expect((await remove(tokens.ops, threadId, uids.fin)).statusCode, 'remove').toBe(200);
    expect((await readRoom(tokens.fin, threadId)).statusCode).toBe(404);

    const log = (await readRoom(tokens.ops, threadId)).json() as { events: Array<{ eventType: string }> };
    expect(log.events.map((e) => e.eventType)).toEqual(['Created', 'ParticipantAdded', 'ParticipantRemoved']);
  });

  it('a room cannot lose its last admin seat', async () => {
    const created = await createRoom(tokens.ops);
    const threadId = (created.json() as { thread: { threadId: string } }).thread.threadId;
    const res = await remove(tokens.ops, threadId, uids.ops);
    expect(res.statusCode, res.body).toBe(400);
    // Hand the seat over, then the departure is legal.
    expect((await invite(tokens.ops, threadId, uids.owner, 'admin')).statusCode).toBe(200);
    expect((await remove(tokens.ops, threadId, uids.ops)).statusCode).toBe(200);
  });

  it('membership management is the ADMIN seat, not org rank: a member cannot invite', async () => {
    const created = await createRoom(tokens.ops);
    const threadId = (created.json() as { thread: { threadId: string } }).thread.threadId;
    await invite(tokens.ops, threadId, uids.owner); // owner seated as MEMBER
    const res = await invite(tokens.owner, threadId, uids.fin);
    expect(res.statusCode, res.body).toBe(403);
  });
});

describe('direct threads', () => {
  it('DM CONVERGENCE, raced for real: concurrent opens of the same pair land on ONE thread', async () => {
    const [a, b] = await Promise.all([openDm(tokens.ops, uids.fin), openDm(tokens.fin, uids.ops)]);
    expect(a.statusCode, a.body).toBe(200);
    expect(b.statusCode, b.body).toBe(200);
    const idA = (a.json() as { thread: { threadId: string } }).thread.threadId;
    const idB = (b.json() as { thread: { threadId: string } }).thread.threadId;
    expect(idA).toBe(idB);
    const rows = await db.adminQuery<{ n: string }>(`SELECT count(*)::text AS n FROM comms_thread WHERE kind = 'direct'`);
    expect(Number(rows[0]?.n)).toBe(1);
  });

  it('RETENTION RIDES THE INSERT: DM messages carry retention_due_at ≈ now + 90d; anchored/room messages carry NULL', async () => {
    const dm = await openDm(tokens.ops, uids.fin);
    const dmId = (dm.json() as { thread: { threadId: string } }).thread.threadId;
    expect((await postTo(tokens.ops, dmId, 'between us')).statusCode).toBe(201);

    const room = await createRoom(tokens.ops);
    const roomId = (room.json() as { thread: { threadId: string } }).thread.threadId;
    expect((await postTo(tokens.ops, roomId, 'heads only')).statusCode).toBe(201);

    const rows = await db.adminQuery<{ thread_id: string; days: string | null }>(
      `SELECT thread_id, EXTRACT(day FROM retention_due_at - now())::text AS days FROM comms_message ORDER BY thread_id`,
    );
    const dmRow = rows.find((r) => r.thread_id === dmId);
    const roomRow = rows.find((r) => r.thread_id === roomId);
    expect(dmRow?.days === '89' || dmRow?.days === '90').toBe(true);
    expect(roomRow?.days).toBeNull();
  });

  it('a DM is invisible to everyone outside the pair — the owner included', async () => {
    const dm = await openDm(tokens.ops, uids.fin);
    const dmId = (dm.json() as { thread: { threadId: string } }).thread.threadId;
    expect((await readRoom(tokens.owner, dmId)).statusCode).toBe(404);
    expect((await readRoom(tokens.visitor, dmId)).statusCode).toBe(404);
    expect((await readRoom(tokens.fin, dmId)).statusCode).toBe(200);
  });

  it('the recall lane FOLLOWED the spine: author-recall works in a DM and the recalled arm is structurally bodiless', async () => {
    const SECRET = 'the-dm-body-that-must-not-survive';
    const dm = await openDm(tokens.ops, uids.fin);
    const dmId = (dm.json() as { thread: { threadId: string } }).thread.threadId;
    const posted = await postTo(tokens.ops, dmId, SECRET);
    const messageId = (posted.json() as { message: { messageId: string } }).message.messageId;
    const rec = await app.inject({
      method: 'POST',
      url: `/api/v1/comms/messages/${messageId}/recall`,
      headers: auth(tokens.ops),
      payload: { reasonCode: 'AuthorRecall' },
    });
    expect(rec.statusCode, rec.body).toBe(200);
    const after = await readRoom(tokens.fin, dmId);
    expect(after.body).not.toContain(SECRET);
    const row = (after.json() as { messages: Array<Record<string, unknown>> }).messages.find((m) => m.messageId === messageId);
    expect(row?.recalled).toBe(true);
    expect(row).not.toHaveProperty('body');
  });
});

describe('0098 — the direct-seat immutability belt (DB-enforced)', () => {
  it('a DM’s seats cannot be updated or deleted, even by the admin connection', async () => {
    const dm = await openDm(tokens.ops, uids.fin);
    const dmId = (dm.json() as { thread: { threadId: string } }).thread.threadId;
    await expect(
      db.adminQuery(`UPDATE comms_thread_participant SET removed_at = now() WHERE thread_id = $1`, [dmId]),
    ).rejects.toThrow(/DIRECT_SEATS_IMMUTABLE/);
    await expect(
      db.adminQuery(`DELETE FROM comms_thread_participant WHERE thread_id = $1`, [dmId]),
    ).rejects.toThrow(/DIRECT_SEATS_IMMUTABLE/);
    // …while a ROOM's soft removal stays legal (its lifecycle, its log).
    const room = await createRoom(tokens.ops);
    const roomId = (room.json() as { thread: { threadId: string } }).thread.threadId;
    await invite(tokens.ops, roomId, uids.fin);
    expect((await remove(tokens.ops, roomId, uids.fin)).statusCode).toBe(200);
  });
});

describe('the attention ledger', () => {
  it('IS ME-PREDICATED: each caller sees only their own stations; unread derives from lastSeq − cursor and RE-DERIVES after the cursor moves', async () => {
    // A mission thread with one message → ops has posted, fin has never read.
    const mission = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Ledger Probe', startsOn: '2026-08-01' } });
    const missionId = (mission.json() as { mission: { missionId: string } }).mission.missionId;
    await app.inject({
      method: 'POST',
      url: `/api/v1/comms/missions/${missionId}/messages`,
      headers: auth(tokens.ops),
      payload: { body: 'first word', links: [], clientMutationId: randomUUID() },
    });

    const finLedger = (await app.inject({ method: 'GET', url: '/api/v1/comms/ledger', headers: auth(tokens.fin) })).json() as {
      threads: Array<{ thread: { threadId: string }; unread: number }>;
    };
    expect(finLedger.threads.length).toBe(1);
    expect(finLedger.threads[0]?.unread).toBe(1);

    // The cursor advances → the ledger RE-DERIVES to caught-up (never carried).
    await app.inject({ method: 'POST', url: `/api/v1/comms/missions/${missionId}/read`, headers: auth(tokens.fin), payload: { seq: 1 } });
    const after = (await app.inject({ method: 'GET', url: '/api/v1/comms/ledger', headers: auth(tokens.fin) })).json() as {
      threads: Array<{ unread: number }>;
    };
    expect(after.threads.length).toBe(0);

    // Obligation stations are the CALLER's: mint accountable=fin, acceptance=owner.
    const mint = await app.inject({
      method: 'POST',
      url: `/api/v1/comms/missions/${missionId}/obligations`,
      headers: auth(tokens.ops),
      payload: {
        description: 'Bring the charger',
        accountableUserId: uids.fin,
        beneficiary: { kind: 'account', userId: uids.owner },
        acceptance: { kind: 'account', userId: uids.owner },
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        evidenceRequirement: 'A photo of the charger.',
        clientMutationId: randomUUID(),
      },
    });
    expect(mint.statusCode, mint.body).toBe(201);
    const finStations = (await app.inject({ method: 'GET', url: '/api/v1/comms/ledger', headers: auth(tokens.fin) })).json() as Record<string, unknown[]>;
    const ownerStations = (await app.inject({ method: 'GET', url: '/api/v1/comms/ledger', headers: auth(tokens.owner) })).json() as Record<string, unknown[]>;
    const opsStations = (await app.inject({ method: 'GET', url: '/api/v1/comms/ledger', headers: auth(tokens.ops) })).json() as Record<string, unknown[]>;
    expect(finStations.awaitingMyDelivery?.length).toBe(1); // fin is accountable
    expect(ownerStations.awaitingMyDelivery?.length).toBe(0); // owner is acceptance, not obligor
    expect(opsStations.watching?.length).toBe(1); // ops asked; others act
  });

  it('a DM thread with unread rides MY ledger and nobody else’s', async () => {
    const dm = await openDm(tokens.ops, uids.fin);
    const dmId = (dm.json() as { thread: { threadId: string } }).thread.threadId;
    await postTo(tokens.ops, dmId, 'ping');
    const fin = (await app.inject({ method: 'GET', url: '/api/v1/comms/ledger', headers: auth(tokens.fin) })).json() as {
      threads: Array<{ thread: { threadId: string } }>;
    };
    expect(fin.threads.some((t) => t.thread.threadId === dmId)).toBe(true);
    const owner = (await app.inject({ method: 'GET', url: '/api/v1/comms/ledger', headers: auth(tokens.owner) })).json() as {
      threads: Array<{ thread: { threadId: string } }>;
    };
    expect(owner.threads.some((t) => t.thread.threadId === dmId)).toBe(false);
  });
});

describe('the lapse posture, inherited unchanged', () => {
  it('lapsed: room reads flow; posts and invites refuse 403 MODULE_READ_ONLY', async () => {
    const created = await createRoom(tokens.ops);
    const threadId = (created.json() as { thread: { threadId: string } }).thread.threadId;
    await db.adminQuery(`UPDATE tenant_module_entitlement SET state = 'lapsed' WHERE module_key = 'comms'`);
    expect((await readRoom(tokens.ops, threadId)).statusCode).toBe(200);
    const post = await postTo(tokens.ops, threadId, 'too late');
    expect(post.statusCode).toBe(403);
    expect(post.body).toContain('MODULE_READ_ONLY');
    expect((await invite(tokens.ops, threadId, uids.fin)).statusCode).toBe(403);
  });
});
