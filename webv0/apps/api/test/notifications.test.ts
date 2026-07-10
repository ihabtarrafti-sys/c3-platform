/**
 * notifications.test.ts (api) — S10 over HTTP: the pipeline fan-out (Submitted
 * → owners except the actor; every later transition → the submitter except
 * self), the derived-signal crossing sweep on the situation read with
 * dedupe-on-first-crossing (UNIQUE means observing twice never notifies
 * twice), acknowledgement (read / read-all), and the identity scope (your
 * inbox is yours; nothing here is ever deleted).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;

const tokens = {} as { ops: string; owner: string; hr: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function post(token: string, url: string, payload: Record<string, unknown>, expected = 200) {
  const res = await app.inject({ method: 'POST', url, headers: auth(token), payload });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(expected);
  return res.json();
}

async function inbox(token: string) {
  const res = await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: auth(token) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { notifications: Array<{ signalKey: string; kind: string; title: string; link: string; readAt: string | null }>; unreadCount: number };
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'notifications-test-secret-01234567',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'c3-ntf-')),
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
  tokens.hr = await login('hr@alpha.com', 'hr', 'alpha');
});

describe('notifications over HTTP (S10)', () => {
  it('pipeline fan-out: submit → owners (not actor); transitions → submitter (not self)', async () => {
    // ops submits — the OWNER hears about it; ops (the actor) does not.
    const a = (await post(tokens.ops, '/api/v1/approvals', { input: { fullName: 'Nadia Petrova' } }, 201)).approval;
    const ownerRows = (await inbox(tokens.owner)).notifications;
    expect(ownerRows.map((n) => n.signalKey)).toEqual([`${a.approvalId}:Submitted`]);
    expect(ownerRows[0]).toMatchObject({ kind: 'pipeline', link: `/approvals/${a.approvalId}` });
    expect((await inbox(tokens.ops)).notifications).toHaveLength(0);
    expect((await inbox(tokens.hr)).notifications).toHaveLength(0); // owners only

    // owner reviews/approves/executes — each transition lands ONE row in the
    // submitter's inbox; the owner (acting on it) hears nothing about own acts.
    const r1 = (await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/begin-review`, { expectedVersion: a.version })).approval;
    const r2 = (await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/approve`, { expectedVersion: r1.version })).approval;
    await post(tokens.owner, `/api/v1/approvals/${a.approvalId}/execute`, { expectedVersion: r2.version });

    const opsRows = (await inbox(tokens.ops)).notifications.map((n) => n.signalKey).sort();
    expect(opsRows).toEqual([`${a.approvalId}:Approved`, `${a.approvalId}:Executed`, `${a.approvalId}:InReview`]);
    // the owner's inbox still has only the Submitted row — self-suppression held
    expect((await inbox(tokens.owner)).notifications.map((n) => n.signalKey)).toEqual([`${a.approvalId}:Submitted`]);
  });

  it('owner submitting their own request notifies no one (sole owner = actor)', async () => {
    await post(tokens.owner, '/api/v1/approvals', { input: { fullName: 'Self Service' } }, 201);
    expect((await inbox(tokens.owner)).notifications).toHaveLength(0);
    expect((await inbox(tokens.ops)).notifications).toHaveLength(0);
  });

  it('crossing sweep: situation read fans signals to owner+ops once — dedupe holds across re-reads', async () => {
    // an active game division with an empty roster = a TeamUnstaffed watch signal
    const team = (await post(tokens.ops, '/api/v1/teams', { name: 'Valorant', code: 'VAL', kind: 'GameDivision' }, 201)).team;
    const key = `TeamUnstaffed:${team.teamId}`;

    await app.inject({ method: 'GET', url: '/api/v1/situation', headers: auth(tokens.owner) });
    const ownerAfterFirst = (await inbox(tokens.owner)).notifications.filter((n) => n.signalKey === key);
    const opsAfterFirst = (await inbox(tokens.ops)).notifications.filter((n) => n.signalKey === key);
    expect(ownerAfterFirst).toHaveLength(1);
    expect(opsAfterFirst).toHaveLength(1);
    expect(ownerAfterFirst[0]).toMatchObject({ kind: 'TeamUnstaffed', readAt: null });
    // hr is not an operational recipient — the sweep never reaches their inbox
    expect((await inbox(tokens.hr)).notifications.filter((n) => n.signalKey === key)).toHaveLength(0);

    // observing the same condition again is FREE — no second row, ever
    await app.inject({ method: 'GET', url: '/api/v1/situation', headers: auth(tokens.owner) });
    await app.inject({ method: 'GET', url: '/api/v1/situation', headers: auth(tokens.ops) });
    expect((await inbox(tokens.owner)).notifications.filter((n) => n.signalKey === key)).toHaveLength(1);
    expect((await inbox(tokens.ops)).notifications.filter((n) => n.signalKey === key)).toHaveLength(1);
  });

  it('acknowledgement: read one, read all — identity-scoped, never deleted', async () => {
    // two rows for the owner: a pipeline row + a swept signal row
    const a = (await post(tokens.ops, '/api/v1/approvals', { input: { fullName: 'Ack Test' } }, 201)).approval;
    await post(tokens.ops, '/api/v1/teams', { name: 'Dota', code: 'DOTA', kind: 'GameDivision' }, 201);
    await app.inject({ method: 'GET', url: '/api/v1/situation', headers: auth(tokens.owner) });

    let box = await inbox(tokens.owner);
    expect(box.unreadCount).toBe(2);

    // mark the pipeline row read — the row STAYS, readAt is set, count drops
    await post(tokens.owner, '/api/v1/notifications/read', { signalKey: `${a.approvalId}:Submitted` });
    box = await inbox(tokens.owner);
    expect(box.unreadCount).toBe(1);
    expect(box.notifications).toHaveLength(2);
    expect(box.notifications.find((n) => n.signalKey === `${a.approvalId}:Submitted`)?.readAt).not.toBeNull();

    // ops' copy of the swept signal is untouched by the owner's acks
    await app.inject({ method: 'GET', url: '/api/v1/situation', headers: auth(tokens.ops) });
    const opsBefore = (await inbox(tokens.ops)).unreadCount;
    expect(opsBefore).toBeGreaterThan(0);

    await post(tokens.owner, '/api/v1/notifications/read-all', {});
    box = await inbox(tokens.owner);
    expect(box.unreadCount).toBe(0);
    expect(box.notifications).toHaveLength(2);
    expect((await inbox(tokens.ops)).unreadCount).toBe(opsBefore);
  });

  it('requires authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/notifications' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/v1/notifications/read-all' })).statusCode).toBe(401);
  });
});
