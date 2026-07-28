/**
 * commsRecall.test.ts — BLOCK 6 (R2-02 + R2-02-C9): one RED-proven pair per
 * enumerated consumer, no sampling (C3-BLOCK6-CONSUMER-ENUMERATION.md is the
 * list; the searches that bounded it are stated there).
 *
 * RED was earned by stash: with every Block-6 source change stashed (the tree
 * at 660a8de), C1 served the recalled body verbatim, C4 served the attachment
 * bytes to a known id — instance 7 live, both directions. Green with the
 * changes: the body is STRUCTURALLY absent (the discriminated wire arm has no
 * key to carry it) and the bytes conceal as the document's own 404
 * (NEO-DOC-01's ruling, landed not re-decided).
 */
import { randomUUID } from 'node:crypto';
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
const tokens = {} as { ops: string; owner: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function entitle(slug: string): Promise<void> {
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant WHERE slug = $1
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
    [slug],
  );
}

async function createMission(name = 'Recall Cup'): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name, startsOn: '2026-08-01' } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().mission.missionId as string;
}

async function post(token: string, missionId: string, body: string, links: unknown[] = []) {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/comms/missions/${missionId}/messages`,
    headers: auth(token),
    payload: { body, links, clientMutationId: randomUUID() },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().message;
}

const pdf = Buffer.from('%PDF-1.4 recall bytes probe %%EOF');
async function uploadAttachment(token: string, missionId: string) {
  const form = new FormData();
  form.append('clientMutationId', randomUUID());
  form.append('caption', 'the recalled brief');
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'recalled-brief.pdf');
  const res = await app.inject({ method: 'POST', url: `/api/v1/comms/missions/${missionId}/attachments`, headers: auth(token), body: form as never });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().message;
}

const recall = (token: string, messageId: string, payload: Record<string, unknown> = { reasonCode: 'AuthorRecall' }) =>
  app.inject({ method: 'POST', url: `/api/v1/comms/messages/${messageId}/recall`, headers: auth(token), payload });

const thread = (token: string, missionId: string) =>
  app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(token) });

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'comms-recall-secret-0123456789',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'c3-recall-')),
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
  tokens.ops = await login('ops@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  await entitle('alpha');
});

const SECRET = 'the-body-that-must-not-survive-recall';

describe('Block 6 — the recall pairs, one per enumerated consumer', () => {
  it('C1 thread fetch: the recalled body is STRUCTURALLY absent; the tombstone renders truthfully', async () => {
    const missionId = await createMission();
    const msg = await post(tokens.ops, missionId, SECRET);
    expect((await thread(tokens.owner, missionId)).body).toContain(SECRET); // pre-recall: the body flows

    const rec = await recall(tokens.ops, msg.messageId);
    expect(rec.statusCode, rec.body).toBe(200);
    expect(rec.json().recall.reasonCode).toBe('AuthorRecall');

    const after = await thread(tokens.owner, missionId);
    expect(after.statusCode, after.body).toBe(200);
    // THE PAIR: reachable pre / unreachable post — and not as an empty string,
    // as an ABSENT KEY (the discriminated arm cannot carry a body at all).
    expect(after.body, 'the recalled body must not survive on the wire').not.toContain(SECRET);
    const row = after.json().messages.find((m: { messageId: string }) => m.messageId === msg.messageId);
    expect(row.recalled).toBe(true);
    expect(row).not.toHaveProperty('body');
    expect(row).not.toHaveProperty('links');
    expect(row).not.toHaveProperty('attachments');
    // ...while the OCCURRENCE renders (a recall that hides itself is the
    // same lie in the other direction).
    expect(row.recall.reasonCode).toBe('AuthorRecall');
    expect(row.recall.at).toBeTruthy();
  });

  it('C2 reply/quote: a link to a recalled message resurfaces NOTHING; chips stay id-only', async () => {
    const missionId = await createMission();
    const msg = await post(tokens.ops, missionId, SECRET);
    await recall(tokens.ops, msg.messageId);
    // quote the recalled message from the composer's link path
    await post(tokens.owner, missionId, 'see the earlier note', [{ targetType: 'Message', targetId: msg.messageId }]);
    const t = await thread(tokens.owner, missionId);
    expect(t.body).not.toContain(SECRET);
    const quoting = t.json().messages.find((m: { body?: string }) => m.body === 'see the earlier note');
    // the chip follows the EXISTING ObjectLink projection: id-only, re-gated per render
    expect(quoting.links).toEqual([{ targetType: 'Message', targetId: msg.messageId }]);
  });

  it('C3 obligations: recall never cascades — the derived fact remains, and the recall SAYS so', async () => {
    const missionId = await createMission();
    const withAtt = await uploadAttachment(tokens.ops, missionId); // a message with a derived fact
    const rec = await recall(tokens.ops, withAtt.messageId);
    expect(rec.statusCode, rec.body).toBe(200);
    // item 6: downstream facts remain, stated plainly — silence there is the
    // same lie in a smaller font.
    expect(rec.json().downstreamFactsRemain).toBe(true);
    // and a message with NO derived facts reports false (the control)
    const bare = await post(tokens.ops, missionId, 'nothing derives from me');
    const rec2 = await recall(tokens.ops, bare.messageId);
    expect(rec2.json().downstreamFactsRemain).toBe(false);
  });

  it('C4+C5 the attachment byte route + doc guard (R2-02-C9): bytes conceal as the document own 404', async () => {
    const missionId = await createMission();
    const withAtt = await uploadAttachment(tokens.ops, missionId);
    const docId = withAtt.attachments[0].documentId as string;

    // PRE-RECALL: any mission reader gets the bytes (the positive control).
    const before = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/content`, headers: auth(tokens.owner) });
    expect(before.statusCode, before.body).toBe(200);
    expect(before.rawPayload.subarray(0, 4).toString()).toBe('%PDF');

    await recall(tokens.ops, withAtt.messageId);

    // THE PAIR: a KNOWN document id serves nothing after recall — concealed
    // as this document's own 404 (NEO-DOC-01's shape), for EVERY reader
    // including the author who recalled it.
    for (const t of [tokens.owner, tokens.ops, tokens.visitor]) {
      const after = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/content`, headers: auth(t) });
      expect(after.statusCode, `bytes must not outlive the message (${after.body})`).toBe(404);
    }
  });

  it('C6 audit: the recall event is META only — names, never the recalled body (N-2 in force)', async () => {
    const missionId = await createMission();
    const msg = await post(tokens.ops, missionId, SECRET);
    await recall(tokens.ops, msg.messageId);
    const csv = await app.inject({ method: 'GET', url: '/api/v1/exports/audit', headers: auth(tokens.owner) });
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toContain('CommsMessageRecalled');
    expect(csv.body, 'the audit channel must never carry the recalled body').not.toContain(SECRET);
  });

  it('the paths and their boundaries: window, moderator note, idempotency, standing', async () => {
    const missionId = await createMission();
    // author recall inside the window — reason-free ✓ (C1 proved it)
    // ANOTHER member cannot author-recall someone else's message
    const msg = await post(tokens.ops, missionId, 'not yours to recall');
    const notAuthor = await recall(tokens.visitor, msg.messageId);
    expect(notAuthor.statusCode, notAuthor.body).toBe(403);
    // a moderator removal REQUIRES its note (reasoned, never silent)
    const silent = await recall(tokens.owner, msg.messageId, { reasonCode: 'ModeratorRemoval' });
    expect(silent.statusCode, silent.body).toBe(400);
    const reasoned = await recall(tokens.owner, msg.messageId, { reasonCode: 'ModeratorRemoval', moderationNote: 'contains a phone number' });
    expect(reasoned.statusCode, reasoned.body).toBe(200);
    expect(reasoned.json().recall.reasonCode).toBe('ModeratorRemoval');
    // the note itself is NOT on the wire — the class is the disclosure
    expect(reasoned.body).not.toContain('phone number');
    // idempotent: a second recall returns the STANDING tombstone, no error
    const again = await recall(tokens.ops, msg.messageId);
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().recall.reasonCode).toBe('ModeratorRemoval'); // the first tombstone stands
    // the visitor placeholder distinguishes moderator removal on the wire
    const t = await thread(tokens.visitor, missionId);
    const row = t.json().messages.find((m: { messageId: string }) => m.messageId === msg.messageId);
    expect(row.recall.reasonCode).toBe('ModeratorRemoval');
  });
});
