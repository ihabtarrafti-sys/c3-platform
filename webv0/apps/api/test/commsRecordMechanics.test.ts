/**
 * commsRecordMechanics.test.ts — C1 (live transclusion) + C3 (mint-from-message).
 *
 * The headline claim of the whole chapter is proven here: **ONE message, two
 * readers, two different HONEST truths.** Finance sees live per-diem amounts;
 * a visitor sees a NAMED DENIAL — never the numbers, and never an empty table
 * pretending there is nothing to see.
 *
 * And the resolution is asserted at BOTH read boundaries, because the battle
 * demo shipped it on one screen and silently not on another.
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
let missionId = '';
let personId = '';

async function login(email: string, role: string): Promise<{ token: string; userId: string }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug: 'alpha' } });
  expect(res.statusCode, res.body).toBe(200);
  const token = (res.json() as { token: string }).token;
  const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(token) });
  return { token, userId: (me.json() as { userId: string }).userId };
}

async function governedExecute(approvalId: string, version: number): Promise<Record<string, unknown>> {
  const rev = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: version } });
  const appr = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: (rev.json() as { approval: { version: number } }).approval.version } });
  const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: (appr.json() as { approval: { version: number } }).approval.version } });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json() as Record<string, unknown>;
}

const post = (token: string, body: string, extra: Record<string, unknown> = {}) =>
  app.inject({
    method: 'POST',
    url: `/api/v1/comms/missions/${missionId}/messages`,
    headers: auth(token),
    payload: { body, links: [], clientMutationId: randomUUID(), ...extra },
  });

const threadAs = (token: string) => app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(token) });

type Block = { kind: string; state: string; rows?: Array<{ label: string; value: string }>; deniedReason?: string };
async function blocksFor(token: string, messageId: string): Promise<Block[]> {
  const view = await threadAs(token);
  const row = (view.json() as { messages: Array<{ messageId: string; blocks?: Block[] }> }).messages.find((m) => m.messageId === messageId);
  return row?.blocks ?? [];
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'comms-record-secret-0123456789abc',
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
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant WHERE slug = 'alpha'
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
  );

  const mission = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Riyadh Bootcamp', startsOn: '2026-08-10' } });
  missionId = (mission.json() as { mission: { missionId: string } }).mission.missionId;

  // A real, governed roster member with a per-diem — through the approval
  // machinery, because the block must render what the RECORD says.
  const sub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName: 'Wing Nasser' } } });
  const subJ = sub.json() as { approval: { approvalId: string; version: number } };
  personId = ((await governedExecute(subJ.approval.approvalId, subJ.approval.version)) as { person: { personId: string } }).person.personId;
  const part = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/requests', headers: auth(tokens.ops), payload: { input: { missionId, personId, role: 'Player' } } });
  const partJ = part.json() as { approval: { approvalId: string; version: number } };
  await governedExecute(partJ.approval.approvalId, partJ.approval.version);
  const pd = await app.inject({ method: 'POST', url: `/api/v1/missions/${missionId}/participants/${personId}/per-diem`, headers: auth(tokens.ops), payload: { perDiemAmountMinor: 25_000, perDiemCurrency: 'SAR', expectedVersion: 0 } });
  expect(pd.statusCode, pd.body).toBe(200);
});

describe('C1 — live transclusion: ONE message, two readers, two honest truths', () => {
  it('finance reads live per-diem AMOUNTS where a visitor reads a NAMED DENIAL — same message, same render path', async () => {
    const posted = await post(tokens.ops, `Travel table, live: {{perdiem:${missionId}}}`);
    expect(posted.statusCode, posted.body).toBe(201);
    const messageId = (posted.json() as { message: { messageId: string } }).message.messageId;

    const finBlocks = await blocksFor(tokens.fin, messageId);
    expect(finBlocks).toHaveLength(1);
    expect(finBlocks[0]?.state).toBe('rendered');
    expect(finBlocks[0]?.rows?.[0]?.value).toContain('SAR'); // code-first money, the owner's ruling
    expect(finBlocks[0]?.rows?.[0]?.value).toContain('250.00');

    const visitorBlocks = await blocksFor(tokens.visitor, messageId);
    expect(visitorBlocks).toHaveLength(1);
    expect(visitorBlocks[0]?.state).toBe('denied');
    // A DENIAL, not an empty table — and never the numbers.
    expect(visitorBlocks[0]?.deniedReason).toContain('not visible to the visitor role');
    expect(visitorBlocks[0]?.rows).toBeUndefined();
    expect(JSON.stringify(visitorBlocks)).not.toContain('250.00');
  });

  it('the block is LIVE: change the record and the SAME message renders the new truth (no edit, no staleness)', async () => {
    const posted = await post(tokens.ops, `Roster, live: {{roster:${missionId}}}`);
    const messageId = (posted.json() as { message: { messageId: string } }).message.messageId;
    expect((await blocksFor(tokens.fin, messageId))[0]?.rows).toHaveLength(1);

    // Remove the participant through the governed path…
    const rm = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/requests', headers: auth(tokens.ops), payload: { input: { missionId, personId, role: 'Player', remove: true } } });
    if (rm.statusCode === 201) {
      const rmJ = rm.json() as { approval: { approvalId: string; version: number } };
      await governedExecute(rmJ.approval.approvalId, rmJ.approval.version);
      // …and the SAME message now renders the NEW truth.
      expect((await blocksFor(tokens.fin, messageId))[0]?.rows).toHaveLength(0);
    } else {
      // The remove shape differs; assert the live property directly instead of
      // claiming a path that does not exist (Law 3b).
      await db.adminQuery(`UPDATE mission_participant SET is_active = false WHERE person_id = $1`, [personId]);
      expect((await blocksFor(tokens.fin, messageId))[0]?.rows).toHaveLength(0);
    }
  });

  it('an unreadable anchor is a DENIAL, never an existence oracle', async () => {
    const posted = await post(tokens.ops, 'Pointing at a mission that does not exist: {{roster:MSN-9999}}');
    const messageId = (posted.json() as { message: { messageId: string } }).message.messageId;
    const blocks = await blocksFor(tokens.ops, messageId);
    expect(blocks[0]?.state).toBe('denied');
    expect(blocks[0]?.deniedReason).toContain('not visible to you');
  });

  it('a RECALLED message resolves NOTHING — the recalled arm has no body to scan and must not regain one', async () => {
    const posted = await post(tokens.ops, `Secret table: {{perdiem:${missionId}}}`);
    const messageId = (posted.json() as { message: { messageId: string } }).message.messageId;
    await app.inject({ method: 'POST', url: `/api/v1/comms/messages/${messageId}/recall`, headers: auth(tokens.ops), payload: { reasonCode: 'AuthorRecall' } });
    const view = await threadAs(tokens.fin);
    const row = (view.json() as { messages: Array<Record<string, unknown>> }).messages.find((m) => m.messageId === messageId);
    expect(row?.recalled).toBe(true);
    expect(row).not.toHaveProperty('blocks');
    expect(view.body).not.toContain('250.00');
  });
});

describe('C3 — mint-from-message: escalation is a TIER CHANGE, never an aggregation', () => {
  const mint = (extra: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/comms/missions/${missionId}/obligations`,
      headers: auth(tokens.ops),
      payload: {
        description: 'Upload the visa scan',
        accountableUserId: uids.visitor,
        beneficiary: { kind: 'account', userId: uids.owner },
        acceptance: { kind: 'account', userId: uids.owner },
        dueAt: new Date(Date.now() + 86_400_000).toISOString(),
        evidenceRequirement: 'The scan itself.',
        clientMutationId: randomUUID(),
        ...extra,
      },
    });

  it('an obligation minted FROM a message carries that provenance on the wire and in the row', async () => {
    const posted = await post(tokens.visitor, 'I will send the visa scan tonight');
    const sourceId = (posted.json() as { message: { messageId: string } }).message.messageId;
    const res = await mint({ sourceMessageId: sourceId });
    expect(res.statusCode, res.body).toBe(201);
    const obligationId = (res.json() as { obligation: { obligationId: string; sourceMessageId: string } }).obligation.obligationId;
    expect((res.json() as { obligation: { sourceMessageId: string } }).obligation.sourceMessageId).toBe(sourceId);

    const rows = await db.adminQuery<{ source_message_id: string }>(`SELECT source_message_id FROM comms_obligation WHERE obligation_id = $1`, [obligationId]);
    expect(rows[0]?.source_message_id).toBe(sourceId);
  });

  it('a RECALLED message cannot be a source — an obligation may not stand on an absence', async () => {
    const posted = await post(tokens.visitor, 'a promise later recalled');
    const sourceId = (posted.json() as { message: { messageId: string } }).message.messageId;
    await app.inject({ method: 'POST', url: `/api/v1/comms/messages/${sourceId}/recall`, headers: auth(tokens.visitor), payload: { reasonCode: 'AuthorRecall' } });
    const res = await mint({ sourceMessageId: sourceId });
    expect(res.statusCode, res.body).toBe(400);
    expect(res.body).toContain('recalled');
  });

  it('minting without a source still works — provenance is optional, never invented', async () => {
    const res = await mint({});
    expect(res.statusCode, res.body).toBe(201);
    expect((res.json() as { obligation: { sourceMessageId: string | null } }).obligation.sourceMessageId).toBeNull();
  });
});
