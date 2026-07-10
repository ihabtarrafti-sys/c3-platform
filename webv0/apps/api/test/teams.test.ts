/**
 * teams.test.ts (api) — S7 over HTTP: division/department CRUD with the
 * unique code, the roster's reactivation pattern, the mission team tag, the
 * per-team P&L with ROI% (honest-null one level up), the TeamUnstaffed
 * signal, and the gates.
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

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function post(token: string, url: string, payload: Record<string, unknown>, expected = 201) {
  const res = await app.inject({ method: 'POST', url, headers: auth(token), payload });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(expected);
  return res.json();
}

async function get(token: string, url: string, expected = 200) {
  const res = await app.inject({ method: 'GET', url, headers: auth(token) });
  expect(res.statusCode, `${url}: ${res.body}`).toBe(expected);
  return res.json();
}

async function governedExecute(approvalId: string, version: number) {
  const rev = await post(tokens.owner, `/api/v1/approvals/${approvalId}/begin-review`, { expectedVersion: version }, 200);
  const appr = await post(tokens.owner, `/api/v1/approvals/${approvalId}/approve`, { expectedVersion: rev.approval.version }, 200);
  return post(tokens.owner, `/api/v1/approvals/${approvalId}/execute`, { expectedVersion: appr.approval.version }, 200);
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'teams-test-secret-0123456789xyza',
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

describe('teams over HTTP (S7)', () => {
  it('CRUD + roster + mission tag + per-team P&L/ROI + unstaffed signal + gates', async () => {
    // ── create: a division and a department; duplicate code refused ──────────
    const r6 = (await post(tokens.ops, '/api/v1/teams', { name: 'Rainbow Six', code: 'r6', kind: 'GameDivision', gameTitle: 'Rainbow Six Siege' })).team;
    expect(r6.teamId).toBe('TEAM-0001');
    expect(r6.code).toBe('R6'); // uppercased at the boundary
    const opsTeam = (await post(tokens.ops, '/api/v1/teams', { name: 'Operations', code: 'OPS', kind: 'Department' })).team;
    await post(tokens.ops, '/api/v1/teams', { name: 'Rainbow Clone', code: 'R6', kind: 'GameDivision' }, 409);

    // ── the unstaffed division fires a WATCH signal; the department never ────
    let situation = await get(tokens.owner, '/api/v1/situation');
    const unstaffed = situation.signals.filter((sg: { kind: string }) => sg.kind === 'TeamUnstaffed');
    expect(unstaffed).toHaveLength(1);
    expect(unstaffed[0].headline).toBe('R6 "Rainbow Six" has no active members');
    expect(unstaffed[0].band).toBe('watch');

    // ── roster: governed person, then add / duplicate / remove / re-add ──────
    const sub = await post(tokens.ops, '/api/v1/approvals', { input: { fullName: 'Jordan Reyes' } });
    const personId = (await governedExecute(sub.approval.approvalId, sub.approval.version)).person.personId as string;

    const added = (await post(tokens.ops, `/api/v1/teams/${r6.teamId}/members`, { personId, role: 'Player' })).member;
    expect(added).toMatchObject({ personId, personName: 'Jordan Reyes', role: 'Player', isActive: true });
    await post(tokens.ops, `/api/v1/teams/${r6.teamId}/members`, { personId, role: 'Coach' }, 409); // already active

    // Staffed now — the signal clears.
    situation = await get(tokens.owner, '/api/v1/situation');
    expect(situation.signals.filter((sg: { kind: string }) => sg.kind === 'TeamUnstaffed')).toHaveLength(0);

    const removed = (await post(tokens.ops, `/api/v1/teams/${r6.teamId}/members/${personId}/remove`, {}, 200)).member;
    expect(removed.isActive).toBe(false);
    const readded = (await post(tokens.ops, `/api/v1/teams/${r6.teamId}/members`, { personId, role: 'Coach' })).member;
    expect(readded).toMatchObject({ role: 'Coach', isActive: true }); // reactivation, same row
    const members = await get(tokens.owner, `/api/v1/teams/${r6.teamId}/members`);
    expect(members.members).toHaveLength(1);

    // The person hub sees the membership.
    const personTeams = await get(tokens.owner, `/api/v1/people/${personId}/teams`);
    expect(personTeams.members[0]).toMatchObject({ teamId: r6.teamId, role: 'Coach', isActive: true });

    // ── the mission tag: must be a real, ACTIVE division ─────────────────────
    await post(tokens.ops, '/api/v1/missions', { name: 'Bad Tag', startsOn: '2026-07-01', teamId: 'TEAM-9999' }, 404);
    const m1 = (await post(tokens.ops, '/api/v1/missions', { name: 'Spring Cup', startsOn: '2026-06-01', endsOn: '2026-06-05', teamId: r6.teamId })).mission;
    const m2 = (await post(tokens.ops, '/api/v1/missions', { name: 'Summer Cup', startsOn: '2026-07-01', endsOn: '2026-07-05', teamId: r6.teamId })).mission;
    expect(m1.teamId).toBe(r6.teamId);

    // ── per-team P&L: blended totals + ROI; honest-null on a missing rate ────
    await post(tokens.ops, `/api/v1/missions/${m1.missionId}/lines`, { direction: 'Income', category: 'PrizeMoney', label: 'Prize', amountMinor: 1_000_000, currency: 'USD' });
    await post(tokens.ops, `/api/v1/missions/${m1.missionId}/lines`, { direction: 'Expense', category: 'Travel', label: 'Flights', amountMinor: 400_000, currency: 'USD' });
    await post(tokens.ops, `/api/v1/missions/${m2.missionId}/lines`, { direction: 'Expense', category: 'Accommodation', label: 'Hotel', amountMinor: 400_000, currency: 'USD' });

    let fin = (await get(tokens.owner, `/api/v1/teams/${r6.teamId}/finance`)).finance;
    expect(fin.missions).toHaveLength(2);
    expect(fin.totals).toEqual({ incomeUsdMinor: 1_000_000, expenseUsdMinor: 800_000, profitUsdMinor: 200_000 });
    expect(fin.roiBps).toBe(2500); // +25.00%

    // A SAR line with no rate: the TEAM total goes null, the culprit is named.
    await post(tokens.ops, `/api/v1/missions/${m2.missionId}/lines`, { direction: 'Expense', category: 'Logistics', label: 'Local', amountMinor: 50_000, currency: 'SAR' });
    fin = (await get(tokens.owner, `/api/v1/teams/${r6.teamId}/finance`)).finance;
    expect(fin.totals).toBeNull();
    expect(fin.roiBps).toBeNull();
    expect(fin.unblendableMissions).toEqual([m2.missionId]);

    // Set the rate → whole again.
    await app.inject({ method: 'POST', url: '/api/v1/fx-rates', headers: auth(tokens.ops), payload: { currency: 'SAR', usdPerUnit: 0.5 } });
    fin = (await get(tokens.owner, `/api/v1/teams/${r6.teamId}/finance`)).finance;
    expect(fin.totals).toEqual({ incomeUsdMinor: 1_000_000, expenseUsdMinor: 825_000, profitUsdMinor: 175_000 });

    // ── update / deactivate / reactivate (version-guarded, audited) ──────────
    const updated = (await post(tokens.ops, `/api/v1/teams/${r6.teamId}`, { expectedVersion: r6.version, name: 'Rainbow Six', code: 'R6S' }, 200)).team;
    expect(updated.code).toBe('R6S');
    const off = (await post(tokens.ops, `/api/v1/teams/${opsTeam.teamId}/deactivate`, { expectedVersion: opsTeam.version }, 200)).team;
    expect(off.isActive).toBe(false);
    await post(tokens.ops, '/api/v1/missions', { name: 'Tag Inactive', startsOn: '2026-07-01', teamId: opsTeam.teamId }, 409);
    const on = (await post(tokens.ops, `/api/v1/teams/${opsTeam.teamId}/reactivate`, { expectedVersion: off.version }, 200)).team;
    expect(on.isActive).toBe(true);

    const audit = await get(tokens.owner, `/api/v1/teams/${r6.teamId}/audit`);
    const actions = audit.events.map((e: { action: string }) => e.action);
    for (const a of ['TeamCreated', 'TeamMemberAdded', 'TeamMemberRemoved', 'TeamUpdated']) expect(actions).toContain(a);

    // ── gates: reads are baseline; writes are org-structure; finance is money ─
    expect((await app.inject({ method: 'GET', url: '/api/v1/teams', headers: auth(tokens.visitor) })).statusCode).toBe(200);
    await post(tokens.visitor, '/api/v1/teams', { name: 'X', code: 'XX', kind: 'Department' }, 403);
    expect((await app.inject({ method: 'GET', url: `/api/v1/teams/${r6.teamId}/finance`, headers: auth(tokens.visitor) })).statusCode).toBe(403);
  });
});
