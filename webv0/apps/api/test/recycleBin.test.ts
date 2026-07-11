/**
 * recycleBin.test.ts (api) — Track B2: the cross-domain recycle bin over HTTP.
 *
 * Proves: the register gathers soft-removed records across domains with
 * provenance (who removed it); restore preserves each domain's governance
 * class (entity/team restore directly, a person restore SUBMITS an approval);
 * record-page kinds are refused a bin restore; the whole surface is
 * owner/operations only.
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
const tokens = {} as { ops: string; owner: string; visitor: string };

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
    DEV_AUTH_SECRET: 'recycle-test-secret-00000000000000',
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
  tokens.ops = await login('ops@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
});

describe('Track B2 — recycle bin', () => {
  it('gathers removed records with provenance; restore honors each domain governance class', async () => {
    // ── an entity, removed (direct-audited deactivate) ───────────────────────
    const ent = await post(tokens.ops, '/api/v1/entities', { name: 'Old Ventures', code: 'OLD', jurisdiction: 'UAE', localCurrency: 'AED' });
    const entityId = ent.json().entity.entityId as string;
    const entDeact = await post(tokens.ops, `/api/v1/entities/${entityId}/deactivate`, { expectedVersion: ent.json().entity.version });
    expect(entDeact.statusCode, entDeact.body).toBe(200);

    // ── a team, removed ──────────────────────────────────────────────────────
    const team = await post(tokens.ops, '/api/v1/teams', { name: 'Disbanded Six', code: 'DB6', kind: 'GameDivision' });
    const teamId = team.json().team.teamId as string;
    await post(tokens.ops, `/api/v1/teams/${teamId}/deactivate`, { expectedVersion: team.json().team.version });

    // ── a person, created then governed-deactivated ──────────────────────────
    const pSub = await post(tokens.ops, '/api/v1/approvals', { input: { fullName: 'Departed Soul' } });
    const personId = (await governedExecute(tokens.owner, pSub.json().approval.approvalId, pSub.json().approval.version)).person.personId as string;
    const dSub = await post(tokens.ops, `/api/v1/people/${personId}/deactivate-request`, { reason: 'left the org' });
    await governedExecute(tokens.owner, dSub.json().approval.approvalId, dSub.json().approval.version);

    // ── the register: all three present, each with the right restore class ───
    type BinItem = { kind: string; id: string; restoreClass: string; removedBy: string | null; version: number };
    const bin = (await get(tokens.owner, '/api/v1/recycle-bin')).json().items as BinItem[];
    const need = (id: string): BinItem => {
      const it = bin.find((i) => i.id === id);
      if (!it) throw new Error(`expected ${id} in the recycle bin`);
      return it;
    };
    const entRow = need(entityId);
    const personRow = need(personId);
    expect(entRow).toMatchObject({ kind: 'entity', restoreClass: 'direct' });
    expect(need(teamId)).toMatchObject({ kind: 'team', restoreClass: 'direct' });
    expect(personRow).toMatchObject({ kind: 'person', restoreClass: 'governed' });
    // provenance: the entity was removed by ops
    expect(entRow.removedBy).toBe('ops@alpha.com');

    // ── restore an entity: DIRECT, back immediately, and it leaves the bin ────
    const entRestore = await post(tokens.ops, '/api/v1/recycle-bin/restore', { kind: 'entity', id: entityId, expectedVersion: entRow.version });
    expect(entRestore.statusCode, entRestore.body).toBe(200);
    expect(entRestore.json()).toMatchObject({ outcome: 'restored', kind: 'entity', id: entityId, approvalId: null });
    const afterEnt = (await get(tokens.owner, '/api/v1/recycle-bin')).json().items as Array<{ id: string }>;
    expect(afterEnt.some((i) => i.id === entityId)).toBe(false);

    // ── restore a person: GOVERNED — an approval is submitted, not an instant flip
    const personRestore = await post(tokens.ops, '/api/v1/recycle-bin/restore', { kind: 'person', id: personId, expectedVersion: personRow.version, reason: 'rehired' });
    expect(personRestore.statusCode, personRestore.body).toBe(200);
    expect(personRestore.json()).toMatchObject({ outcome: 'approval-submitted', kind: 'person', id: personId });
    expect(personRestore.json().approvalId).toMatch(/^APR-/);
    // still in the bin until the approval executes
    const afterPerson = (await get(tokens.owner, '/api/v1/recycle-bin')).json().items as Array<{ id: string }>;
    expect(afterPerson.some((i) => i.id === personId)).toBe(true);
    // executing the reactivation approval brings the person back → leaves the bin
    const ra = personRestore.json().approvalId as string;
    const raRow = await get(tokens.owner, `/api/v1/approvals/${ra}`);
    await governedExecute(tokens.owner, ra, raRow.json().approval.version);
    const afterExec = (await get(tokens.owner, '/api/v1/recycle-bin')).json().items as Array<{ id: string }>;
    expect(afterExec.some((i) => i.id === personId)).toBe(false);

    // ── a person restore WITHOUT a reason is refused ─────────────────────────
    // (re-remove the team's not needed; just probe the validation on the still-removed team is wrong kind)
    const noReason = await post(tokens.ops, '/api/v1/recycle-bin/restore', { kind: 'person', id: 'PER-9999', expectedVersion: 0 });
    expect(noReason.statusCode).toBe(400);
  });

  it('record-page kinds cannot be restored from the bin; the surface is owner/ops only', async () => {
    // a record-page kind restore is refused with a helpful 400
    const cred = await post(tokens.ops, '/api/v1/recycle-bin/restore', { kind: 'credential', id: 'CRED-0001', expectedVersion: 0 });
    expect(cred.statusCode).toBe(400);

    // the visitor may neither read nor restore
    expect((await get(tokens.visitor, '/api/v1/recycle-bin')).statusCode).toBe(403);
    expect((await post(tokens.visitor, '/api/v1/recycle-bin/restore', { kind: 'entity', id: 'ENT-0001', expectedVersion: 0 })).statusCode).toBe(403);
  });
});
