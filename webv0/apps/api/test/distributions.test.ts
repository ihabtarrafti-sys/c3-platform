/**
 * distributions.test.ts (api) — S8 over HTTP: seed from PrizeShare terms,
 * the exact-sum allocation, one live per line, payout flips with the label
 * law, revoke rules, the PayoutsOutstanding signal, and the gates.
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

async function createPerson(fullName: string): Promise<string> {
  const sub = await post(tokens.ops, '/api/v1/approvals', { input: { fullName } });
  return (await governedExecute(sub.approval.approvalId, sub.approval.version)).person.personId as string;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'dist-test-secret-0123456789xyzab',
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

describe('distributions over HTTP (S8)', () => {
  it('seed → allocate exactly → payouts with the label law → signal → revoke rules → gates', async () => {
    // ── the stage: team + two players (one with a PrizeShare term), mission, received prize money ──
    const team = (await post(tokens.ops, '/api/v1/teams', { name: 'Rainbow Six', code: 'R6', kind: 'GameDivision' })).team;
    const ace = await createPerson('Ace Player');
    const beta = await createPerson('Beta Player');
    await post(tokens.ops, `/api/v1/teams/${team.teamId}/members`, { personId: ace, role: 'Player' });
    await post(tokens.ops, `/api/v1/teams/${team.teamId}/members`, { personId: beta, role: 'Player' });

    // Ace's agreement carries a PrizeSharePersonal 45% term (the seed source).
    const agrSub = await post(tokens.ops, '/api/v1/agreements/requests', {
      input: { personId: ace, agreementType: 'Player Contract', startsOn: '2026-01-01', endsOn: '2027-01-01' },
    });
    const agreementId = (await governedExecute(agrSub.approval.approvalId, agrSub.approval.version)).agreement.agreementId as string;
    const termSub = await post(tokens.ops, '/api/v1/agreements/terms/requests', {
      input: { agreementId, kind: 'PrizeSharePersonal', percentBps: 4500 },
    });
    await governedExecute(termSub.approval.approvalId, termSub.approval.version);

    const mission = (await post(tokens.ops, '/api/v1/missions', { name: 'Prize Cup', startsOn: '2026-06-01', endsOn: '2026-06-05', teamId: team.teamId })).mission;
    const msn = mission.missionId as string;
    const line = (await post(tokens.ops, `/api/v1/missions/${msn}/lines`, { direction: 'Income', category: 'PrizeMoney', label: 'Prize', amountMinor: 1_000_001, currency: 'USD' })).line;

    // Not Received yet → refused.
    await post(tokens.ops, '/api/v1/distributions', { missionId: msn, lineId: line.lineId, orgShareBps: 2000, shares: [{ personId: ace, shareBps: 10000 }] }, 409);

    // The money lands (short 1 cent — partial receipts are real life).
    await post(tokens.ops, `/api/v1/missions/${msn}/lines/${line.lineId}/payment`, { expectedVersion: line.version, paymentStatus: 'Received', receivedAmountMinor: 1_000_000, paymentSourceLabel: 'ESA' }, 200);

    // ── the seed: roster + the 45% suggestion with its term named ────────────
    const seed = (await get(tokens.owner, `/api/v1/distributions/seed?missionId=${msn}`)).rows;
    expect(seed).toHaveLength(2);
    const aceSeed = seed.find((r0: { personId: string }) => r0.personId === ace);
    expect(aceSeed.suggestedBps).toBe(4500);
    expect(aceSeed.sourceTermId).toMatch(/^TRM-/);
    expect(seed.find((r0: { personId: string }) => r0.personId === beta).suggestedBps).toBeNull();

    // ── allocate: 20% org, 45/55 players, over the RECEIVED pool ─────────────
    const created = await post(tokens.ops, '/api/v1/distributions', {
      missionId: msn,
      lineId: line.lineId,
      orgShareBps: 2000,
      shares: [
        { personId: ace, shareBps: 4500 },
        { personId: beta, shareBps: 5500 },
      ],
    });
    const dist = created.distribution;
    expect(dist.distributionId).toBe('DIST-0001');
    expect(dist.poolMinor).toBe(1_000_000); // the received amount, not the expected one
    expect(dist.orgCutMinor).toBe(200_000);
    const shareSum = created.shares.reduce((n: number, s: { amountMinor: number }) => n + s.amountMinor, 0);
    expect(dist.orgCutMinor + shareSum).toBe(1_000_000); // THE LAW
    expect(created.shares.map((s: { payoutStatus: string }) => s.payoutStatus)).toEqual(['Paid', 'Paid'].map(() => 'Pending'));

    // One LIVE distribution per line.
    await post(tokens.ops, '/api/v1/distributions', { missionId: msn, lineId: line.lineId, orgShareBps: 10000, shares: [] }, 409);
    // Shares that don't sum to 100% are refused whole.
    const badShares = await app.inject({
      method: 'POST',
      url: '/api/v1/distributions',
      headers: auth(tokens.ops),
      payload: { missionId: msn, lineId: line.lineId, orgShareBps: 0, shares: [{ personId: ace, shareBps: 9999 }] },
    });
    expect([409, 422]).toContain(badShares.statusCode);

    // ── the signal: pending payouts reach the cockpit with the amount ────────
    let situation = await get(tokens.owner, '/api/v1/situation');
    const owed = situation.signals.find((sg: { kind: string }) => sg.kind === 'PayoutsOutstanding');
    expect(owed, JSON.stringify(situation.signals.map((sg: { key: string }) => sg.key))).toBeTruthy();
    expect(owed.headline).toContain('DIST-0001');
    expect(owed.headline).toContain('2 payouts pending');

    // ── payouts: label mandatory when paying; Paid→Pending is a legal correction ──
    const aceRow = created.shares.find((s: { personId: string }) => s.personId === ace);
    await post(tokens.ops, `/api/v1/distributions/${dist.distributionId}/payouts/${ace}`, { expectedVersion: aceRow.version, paid: true }, 400); // no label
    const paid = (await post(tokens.ops, `/api/v1/distributions/${dist.distributionId}/payouts/${ace}`, { expectedVersion: aceRow.version, paid: true, paymentSourceLabel: 'ESA', refNo: 'FT2601AA' }, 200)).share;
    expect(paid).toMatchObject({ payoutStatus: 'Paid', paymentSourceLabel: 'ESA', refNo: 'FT2601AA' });
    expect(paid.paidOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Revoke refused once money moved.
    const distNow = (await get(tokens.owner, `/api/v1/distributions/${dist.distributionId}`)).distribution;
    await post(tokens.ops, `/api/v1/distributions/${dist.distributionId}/revoke`, { reason: 'redo', expectedVersion: distNow.version }, 409);

    // Correction: back to Pending (audited), then revoke works with all pending.
    await post(tokens.ops, `/api/v1/distributions/${dist.distributionId}/payouts/${ace}`, { expectedVersion: paid.version, paid: false }, 200);
    const revoked = (await post(tokens.ops, `/api/v1/distributions/${dist.distributionId}/revoke`, { reason: 'Wrong split', expectedVersion: distNow.version }, 200)).distribution;
    expect(revoked.status).toBe('Revoked');
    // The line is free again: a corrected allocation lands as DIST-0002.
    const redo = await post(tokens.ops, '/api/v1/distributions', { missionId: msn, lineId: line.lineId, orgShareBps: 10000, shares: [] });
    expect(redo.distribution.distributionId).toBe('DIST-0002');
    expect(redo.distribution.orgCutMinor).toBe(1_000_000);

    // The audit trail tells the story.
    const audit = await get(tokens.owner, `/api/v1/distributions/${dist.distributionId}/audit`);
    const actions = audit.events.map((e: { action: string }) => e.action);
    for (const a of ['DistributionCreated', 'PayoutMarked', 'DistributionRevoked']) expect(actions).toContain(a);

    // ── gates: money is finance-only ──────────────────────────────────────────
    expect((await app.inject({ method: 'GET', url: `/api/v1/missions/${msn}/distributions`, headers: auth(tokens.visitor) })).statusCode).toBe(403);
    await post(tokens.visitor, '/api/v1/distributions', { missionId: msn, lineId: line.lineId, orgShareBps: 10000, shares: [] }, 403);
  });
});
