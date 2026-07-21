/**
 * comms.test.ts (api) — the Mission Comms slice over HTTP, wired to the
 * Neural-verified read-guard verdict:
 *  - never-entitled = 404 on BOTH read and write (module state never leaks);
 *  - lapsed = reads flow, writes 403 MODULE_READ_ONLY, and a lapsed upload's
 *    bytes are ARMED for compensation (the full write-ahead protocol);
 *  - mission-visible readership (all roles read AND post — D2 write ⊇ read);
 *  - send-idempotency (one message per clientMutationId);
 *  - the record-scoped doc guard: content downloads for any mission reader,
 *    cross-tenant concealed as the IDENTICAL document 404;
 *  - generic surface posture: list record-scoped, attach + remove refuse;
 *  - search stays closed-by-allowlist (a comms file never surfaces).
 */
import { randomUUID, createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

const tokens = {} as { ops: string; owner: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function entitle(slug: string): Promise<void> {
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant WHERE slug = $1
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
    [slug],
  );
}

async function createMission(name = 'Comms Cup'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name, startsOn: '2026-08-01' } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().mission.missionId as string;
}

async function postMessage(token: string, missionId: string, body: string, mutation = randomUUID()) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/comms/missions/${missionId}/messages`,
    headers: auth(token),
    payload: { body, links: [], clientMutationId: mutation },
  });
}

const pdf = Buffer.from('%PDF-1.4 comms attachment probe %%EOF');

async function uploadAttachment(token: string, missionId: string, mutation = randomUUID(), fileName = 'brief.pdf') {
  const form = new FormData();
  form.append('clientMutationId', mutation);
  form.append('caption', 'the brief');
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), fileName);
  return app.inject({ method: 'POST', url: `/api/v1/comms/missions/${missionId}/attachments`, headers: auth(token), body: form as never });
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'comms-test-secret-0123456789ab',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'c3-comms-')),
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
  await db.seedTenant({ slug: 'bravo' });
  tokens.ops = await login('ops@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
  await entitle('alpha');
  await entitle('bravo');
});

describe('Mission Comms — the slice', () => {
  it('never-entitled: 404 on BOTH read and write (module state never leaks)', async () => {
    const missionId = await createMission();
    await db.adminQuery(`DELETE FROM tenant_module_entitlement`);
    const read = await app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(tokens.owner) });
    expect(read.statusCode, read.body).toBe(404);
    const write = await postMessage(tokens.owner, missionId, 'hello?');
    expect(write.statusCode, write.body).toBe(404);
  });

  it('thread auto-creates on first open; every mission role reads AND posts; links project', async () => {
    const missionId = await createMission();
    const opened = await app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(tokens.ops) });
    expect(opened.statusCode, opened.body).toBe(200);
    const threadId = opened.json().thread.threadId as string;
    expect(threadId).toMatch(/^THR-\d{4,}$/);

    const post = await app.inject({
      method: 'POST',
      url: `/api/v1/comms/missions/${missionId}/messages`,
      headers: auth(tokens.ops),
      payload: { body: 'kickoff — see the mission', links: [{ targetType: 'Mission', targetId: missionId }], clientMutationId: randomUUID() },
    });
    expect(post.statusCode, post.body).toBe(201);
    expect(post.json().message.seq).toBe(1);
    expect(post.json().message.links).toEqual([{ targetType: 'Mission', targetId: missionId }]);

    // The mission-visible posture (owner-accepted): a visitor reads AND posts.
    const visitorRead = await app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(tokens.visitor) });
    expect(visitorRead.statusCode).toBe(200);
    expect(visitorRead.json().messages).toHaveLength(1);
    const visitorPost = await postMessage(tokens.visitor, missionId, 'noted!');
    expect(visitorPost.statusCode, visitorPost.body).toBe(201);
    expect(visitorPost.json().message.seq).toBe(2);
  });

  it('send-idempotency: the same clientMutationId returns the SAME message, one row', async () => {
    const missionId = await createMission();
    const mutation = randomUUID();
    const first = await postMessage(tokens.ops, missionId, 'once', mutation);
    expect(first.statusCode, first.body).toBe(201);
    const second = await postMessage(tokens.ops, missionId, 'once', mutation);
    expect(second.statusCode, second.body).toBe(201);
    expect(second.json().message.messageId).toBe(first.json().message.messageId);
    const rows = await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM comms_message`);
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it('attachment: record_kind=Attachment; any mission reader downloads; cross-tenant = the IDENTICAL doc 404', async () => {
    const missionId = await createMission();
    const up = await uploadAttachment(tokens.ops, missionId);
    expect(up.statusCode, up.body).toBe(201);
    const message = up.json().message;
    expect(message.attachments).toHaveLength(1);
    const documentId = message.attachments[0].documentId as string;

    // The 0089 forward-flag: an ordinary Comms file is an Attachment, not register evidence.
    const doc = await db.adminQuery<{ record_kind: string; owner_type: string; owner_id: string }>(
      `SELECT record_kind, owner_type, owner_id FROM document WHERE document_id = $1`,
      [documentId],
    );
    expect(doc[0]).toMatchObject({ record_kind: 'Attachment', owner_type: 'CommsMessage', owner_id: message.messageId });

    // Any mission reader (visitor) downloads byte-identical content.
    const dl = await app.inject({ method: 'GET', url: `/api/v1/documents/${documentId}/content`, headers: auth(tokens.visitor) });
    expect(dl.statusCode, dl.body).toBe(200);
    expect(createHash('sha256').update(dl.rawPayload).digest('hex')).toBe(createHash('sha256').update(pdf).digest('hex'));

    // Cross-tenant: concealed as the SAME shape a nonexistent document yields.
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/documents/${documentId}/content`, headers: auth(tokens.ownerB) });
    expect(foreign.statusCode).toBe(404);
    const ghost = await app.inject({ method: 'GET', url: `/api/v1/documents/DOC-9999/content`, headers: auth(tokens.ownerB) });
    expect(ghost.statusCode).toBe(404);
    const strip = (b: string) => {
      const j = JSON.parse(b) as { error: { code: string; message: string } };
      return { code: j.error.code, message: j.error.message.replace(/DOC-\d+/g, 'DOC-X') };
    };
    expect(strip(foreign.body)).toEqual(strip(ghost.body)); // uniform concealment

    // Generic-surface posture: list is record-scoped (200 for a reader) …
    const list = await app.inject({ method: 'GET', url: `/api/v1/documents?ownerType=CommsMessage&ownerId=${message.messageId}`, headers: auth(tokens.visitor) });
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().documents).toHaveLength(1);
    // … attach refuses (server-owned creation) …
    const form = new FormData();
    form.append('ownerType', 'CommsMessage');
    form.append('ownerId', message.messageId);
    form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'x.pdf');
    const attach = await app.inject({ method: 'POST', url: '/api/v1/documents', headers: auth(tokens.ops), body: form as never });
    expect(attach.statusCode, attach.body).toBe(400);
    // … and remove refuses (server-owned retirement, keyed on the RESOLVED type).
    const remove = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${documentId}/remove`,
      headers: auth(tokens.owner),
      payload: { expectedVersion: 0 },
    });
    expect(remove.statusCode, remove.body).toBe(400);
    expect(remove.body).toMatch(/Comms module/i);

    // Search stays closed-by-allowlist: the comms file never surfaces.
    const search = await app.inject({ method: 'GET', url: `/api/v1/search?q=brief`, headers: auth(tokens.owner) });
    expect(search.statusCode).toBe(200);
    expect(JSON.stringify(search.json())).not.toContain(documentId);
  });

  it('lapsed: reads flow, writes 403 MODULE_READ_ONLY, and a lapsed upload ARMS its bytes', async () => {
    const missionId = await createMission();
    const before = await postMessage(tokens.ops, missionId, 'while active');
    expect(before.statusCode).toBe(201);
    await db.adminQuery(`UPDATE tenant_module_entitlement SET state = 'lapsed'`);

    const read = await app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(tokens.owner) });
    expect(read.statusCode, read.body).toBe(200); // the record survives lapse
    expect(read.json().messages).toHaveLength(1);

    const write = await postMessage(tokens.owner, missionId, 'read-only now');
    expect(write.statusCode, write.body).toBe(403);
    expect(JSON.parse(write.body).error.code).toBe('MODULE_READ_ONLY');

    // The compensation protocol under the in-use-case refusal AFTER the PUT:
    // the fresh bytes' intent is durably ARMED (no orphan blob).
    const armedBefore = await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM blob_tombstone WHERE state = 'armed'`);
    const up = await uploadAttachment(tokens.owner, missionId);
    expect(up.statusCode, up.body).toBe(403);
    const armedAfter = await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM blob_tombstone WHERE state = 'armed'`);
    expect(Number(armedAfter[0]!.n)).toBe(Number(armedBefore[0]!.n) + 1);
  });
});
