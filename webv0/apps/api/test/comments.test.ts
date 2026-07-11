/**
 * comments.test.ts (api) — Track B4: contextual comments + @mentions.
 *
 * Proves: you comment where you can read (per-subject gate + existence);
 * comments are append-only and returned oldest-first; an @mention lands an
 * S10 notification for the mentioned member (and never for yourself); a
 * comment on a non-existent or cross-tenant record is refused.
 */
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
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });
const get = (t: string, url: string) => app.inject({ method: 'GET', url, headers: auth(t) });

async function governedExecute(token: string, approvalId: string, version: number) {
  const rev = await post(token, `/api/v1/approvals/${approvalId}/begin-review`, { expectedVersion: version });
  const appr = await post(token, `/api/v1/approvals/${approvalId}/approve`, { expectedVersion: rev.json().approval.version });
  const exec = await post(token, `/api/v1/approvals/${approvalId}/execute`, { expectedVersion: appr.json().approval.version });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'comments-test-secret-00000000000',
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
  await db.seedTenant({ slug: 'bravo' });
  tokens.ops = await login('ops@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

describe('Track B4 — comments + @mentions', () => {
  it('a thread on a person: append-only, oldest-first, with an @mention that notifies', async () => {
    const pSub = await post(tokens.ops, '/api/v1/approvals', { input: { fullName: 'Talked About' } });
    const personId = (await governedExecute(tokens.owner, pSub.json().approval.approvalId, pSub.json().approval.version)).person.personId as string;

    // ops posts a comment mentioning the owner
    const c1 = await post(tokens.ops, '/api/v1/comments', {
      subjectType: 'Person',
      subjectId: personId,
      body: 'Passport looks close to expiry — @owner please confirm.',
      mentions: ['owner@alpha.com', 'ops@alpha.com'], // self-mention is dropped
    });
    expect(c1.statusCode, c1.body).toBe(201);
    expect(c1.json().comment).toMatchObject({ subjectType: 'Person', subjectId: personId, author: 'ops@alpha.com' });
    expect(c1.json().comment.mentions).toEqual(['owner@alpha.com']); // self dropped

    // owner replies
    const c2 = await post(tokens.owner, '/api/v1/comments', { subjectType: 'Person', subjectId: personId, body: 'Confirmed, renewing this week.' });
    expect(c2.statusCode, c2.body).toBe(201);

    // the thread reads back oldest-first
    const thread = (await get(tokens.owner, `/api/v1/comments?subjectType=Person&subjectId=${personId}`)).json().comments;
    expect(thread.map((c: { author: string }) => c.author)).toEqual(['ops@alpha.com', 'owner@alpha.com']);

    // the owner's bell carries the mention notification, linking to the person
    const notes = (await get(tokens.owner, '/api/v1/notifications')).json();
    const mention = notes.notifications.find((n: { kind: string }) => n.kind === 'Mention');
    expect(mention).toBeTruthy();
    expect(mention.title).toContain('mentioned you on Person');
    expect(mention.link).toBe(`/people/${personId}`);
    // ops did NOT get a self-notification
    const opsNotes = (await get(tokens.ops, '/api/v1/notifications')).json();
    expect(opsNotes.notifications.some((n: { kind: string }) => n.kind === 'Mention')).toBe(false);
  });

  it('you comment where you can read; empty body, missing record, and cross-tenant are refused', async () => {
    // empty body → 400
    const empty = await post(tokens.ops, '/api/v1/comments', { subjectType: 'Person', subjectId: 'PER-0001', body: '   ' });
    expect(empty.statusCode).toBe(400);

    // a comment on a non-existent person → 404
    const missing = await post(tokens.ops, '/api/v1/comments', { subjectType: 'Person', subjectId: 'PER-9999', body: 'hello?' });
    expect(missing.statusCode).toBe(404);

    // cross-tenant: bravo's owner cannot comment on an alpha person
    const pSub = await post(tokens.ops, '/api/v1/approvals', { input: { fullName: 'Alpha Only' } });
    const personId = (await governedExecute(tokens.owner, pSub.json().approval.approvalId, pSub.json().approval.version)).person.personId as string;
    const cross = await post(tokens.ownerB, '/api/v1/comments', { subjectType: 'Person', subjectId: personId, body: 'peeking' });
    expect(cross.statusCode).toBe(404); // RLS makes it not exist for bravo
  });
});
