/**
 * commsDecisions.test.ts — C2: DECISION RECORDS, proven where the battle FAILED.
 *
 * ⚠️ THE FAIL THIS FILE EXISTS FOR: in the battle demo the wire schema accepted
 * `messageKind` and the persist layer silently DROPPED it — a defect living
 * BETWEEN two layers that each looked correct alone, and my capture then
 * "verified" it by matching body text that said "DECISION:". Two stacked
 * errors, one lesson:
 *
 *   **Assert the PERSISTED fact, never the posted one — and never the words.**
 *
 * So every assertion here reads the kind BACK: from the database row where the
 * claim can be checked, and from the thread read that every consumer uses.
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
const tokens = {} as { owner: string; ops: string };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
let missionId = '';

async function login(email: string, role: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug: 'alpha' } });
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { token: string }).token;
}

const post = (body: string, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/comms/missions/${missionId}/messages`,
    headers: auth(tokens.ops),
    payload: { body, links: [], clientMutationId: randomUUID(), ...extra },
  });

const thread = () => app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(tokens.ops) });

/** The ground truth: the SPINE row, not the response echo. */
async function persistedKind(messageId: string): Promise<{ kind: string; supersedes: string | null }> {
  const rows = await db.adminQuery<{ message_kind: string; supersedes_message_id: string | null }>(
    `SELECT message_kind, supersedes_message_id FROM comms_message WHERE message_id = $1`,
    [messageId],
  );
  return { kind: rows[0]?.message_kind ?? 'MISSING', supersedes: rows[0]?.supersedes_message_id ?? null };
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'comms-decisions-secret-0123456789',
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
  tokens.owner = await login('owner@alpha.com', 'owner');
  tokens.ops = await login('ops@alpha.com', 'operations');
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant WHERE slug = 'alpha'
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
  );
  const mission = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Decisions Cup', startsOn: '2026-08-01' } });
  missionId = (mission.json() as { mission: { missionId: string } }).mission.missionId;
});

describe('C2 — the kind survives the WHOLE way down (the battle FAIL, pinned)', () => {
  it('a decision persists AS a decision in the spine row — and a note persists as a note', async () => {
    const note = await post('an ordinary note');
    const decision = await post('scrim block runs 16:00–20:00', { messageKind: 'decision' });
    expect(decision.statusCode, decision.body).toBe(201);

    const noteId = (note.json() as { message: { messageId: string } }).message.messageId;
    const decisionId = (decision.json() as { message: { messageId: string } }).message.messageId;

    // THE ASSERTION THAT WOULD HAVE CAUGHT THE BATTLE FAIL: read it back from
    // the database, where the persist layer cannot flatter itself.
    expect((await persistedKind(noteId)).kind).toBe('note');
    expect((await persistedKind(decisionId)).kind).toBe('decision');
  });

  it('the kind reaches every CONSUMER through the ordinary thread read', async () => {
    const decision = await post('a ruling', { messageKind: 'decision' });
    const decisionId = (decision.json() as { message: { messageId: string } }).message.messageId;
    const view = await thread();
    const row = (view.json() as { messages: Array<Record<string, unknown>> }).messages.find((m) => m.messageId === decisionId);
    expect(row?.messageKind).toBe('decision');
    expect(row?.supersedesMessageId).toBeNull();
  });

  it('a decision may supersede an earlier decision — and BOTH the pointer and the target persist', async () => {
    const first = await post('scrim block runs 14:00–18:00', { messageKind: 'decision' });
    const firstId = (first.json() as { message: { messageId: string } }).message.messageId;
    const second = await post('scrim block moves to 16:00–20:00', { messageKind: 'decision', supersedesMessageId: firstId });
    expect(second.statusCode, second.body).toBe(201);
    const secondId = (second.json() as { message: { messageId: string } }).message.messageId;

    const persisted = await persistedKind(secondId);
    expect(persisted.kind).toBe('decision');
    expect(persisted.supersedes).toBe(firstId);
    // The superseded ruling STAYS — legible, not erased.
    expect((await persistedKind(firstId)).kind).toBe('decision');
    expect((await thread()).body).toContain('14:00');
  });
});

describe('C2 — the refusals (a ruling may not stand on an absence)', () => {
  it('a NOTE may not supersede anything (the wire refuses before the DB has to)', async () => {
    const decision = await post('a ruling', { messageKind: 'decision' });
    const decisionId = (decision.json() as { message: { messageId: string } }).message.messageId;
    const res = await post('just chatting', { supersedesMessageId: decisionId });
    expect(res.statusCode, res.body).toBe(400);
  });

  it('a RECALLED decision cannot be superseded — that would dress an absence as history', async () => {
    const first = await post('a ruling that gets recalled', { messageKind: 'decision' });
    const firstId = (first.json() as { message: { messageId: string } }).message.messageId;
    const recall = await app.inject({
      method: 'POST',
      url: `/api/v1/comms/messages/${firstId}/recall`,
      headers: auth(tokens.ops),
      payload: { reasonCode: 'AuthorRecall' },
    });
    expect(recall.statusCode, recall.body).toBe(200);

    const res = await post('replacing the recalled ruling', { messageKind: 'decision', supersedesMessageId: firstId });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.body).toContain('recalled');
  });

  it('a decision may not supersede a message in ANOTHER thread', async () => {
    const here = await post('a ruling here', { messageKind: 'decision' });
    const hereId = (here.json() as { message: { messageId: string } }).message.messageId;

    // A second mission = a second thread.
    const other = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Other Cup', startsOn: '2026-09-01' } });
    const otherMissionId = (other.json() as { mission: { missionId: string } }).mission.missionId;
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/comms/missions/${otherMissionId}/messages`,
      headers: auth(tokens.ops),
      payload: { body: 'reaching across threads', links: [], clientMutationId: randomUUID(), messageKind: 'decision', supersedesMessageId: hereId },
    });
    expect(res.statusCode, res.body).toBe(400);
  });

  it('the DATABASE refuses the shape too, not merely the application (0100’s CHECKs)', async () => {
    // ⚠️ The first version of this probe was VACUOUS: its INSERT…SELECT joined
    // rows that did not exist yet, inserted nothing, and therefore violated
    // nothing while looking like a passing test. A negative probe must first
    // prove it can insert AT ALL — so this one uses REAL ids from a real
    // message and asserts the positive control alongside the refusal.
    const seed = await post('a real message, so the thread and ids exist');
    const seedId = (seed.json() as { message: { messageId: string } }).message.messageId;
    const [row] = await db.adminQuery<{ tenant_id: string; thread_id: string; author_user_id: string }>(
      `SELECT tenant_id, thread_id, author_user_id FROM comms_message WHERE message_id = $1`,
      [seedId],
    );
    expect(row, 'the probe must have real ids to insert with').toBeTruthy();

    // POSITIVE CONTROL: the same insert WITHOUT the illegal pairing succeeds,
    // proving the refusal below is the CHECK and not a broken statement.
    await db.adminQuery(
      `INSERT INTO comms_message (tenant_id, message_id, thread_id, seq, author_user_id, author_label, client_mutation_id, message_kind, supersedes_message_id)
       VALUES ($1, 'MSG-9001', $2, 9001, $3, 'probe', gen_random_uuid(), 'decision', $4)`,
      [row!.tenant_id, row!.thread_id, row!.author_user_id, seedId],
    );

    // THE REFUSAL: a NOTE that supersedes is refused by 0100's CHECK.
    await expect(
      db.adminQuery(
        `INSERT INTO comms_message (tenant_id, message_id, thread_id, seq, author_user_id, author_label, client_mutation_id, message_kind, supersedes_message_id)
         VALUES ($1, 'MSG-9002', $2, 9002, $3, 'probe', gen_random_uuid(), 'note', $4)`,
        [row!.tenant_id, row!.thread_id, row!.author_user_id, seedId],
      ),
    ).rejects.toThrow(/comms_message_supersedes_is_a_decision|violates check/i);

    // …and an unknown KIND is refused by the vocabulary CHECK.
    await expect(
      db.adminQuery(
        `INSERT INTO comms_message (tenant_id, message_id, thread_id, seq, author_user_id, author_label, client_mutation_id, message_kind)
         VALUES ($1, 'MSG-9003', $2, 9003, $3, 'probe', gen_random_uuid(), 'proclamation')`,
        [row!.tenant_id, row!.thread_id, row!.author_user_id],
      ),
    ).rejects.toThrow(/comms_message_kind_vocabulary|violates check/i);
  });
});
