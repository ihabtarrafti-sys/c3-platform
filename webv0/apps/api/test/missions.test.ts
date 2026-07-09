/**
 * missions.test.ts (api) — Sprint 39 M3 evidence over HTTP. Covers: the mission
 * shell CRUD with versioned bodies + date-coherence 400s + stale 409, the
 * governed participant chain end-to-end (submit → review → approve → execute →
 * roster read), BOTH duplicate refusals over the wire (pending at submit 409,
 * active at execute = truthful ExecutionFailed), authz splits, and tenant
 * scoping (404-invisible).
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

const tokens = {} as { ops: string; owner: string; finance: string; legal: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/dev/login',
    payload: { email, displayName: email, role, tenantSlug },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Walk an approval through review → approve → execute as the owner. */
async function governedExecute(approvalId: string, version: number) {
  const rev = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: version } });
  expect(rev.statusCode, rev.body).toBe(200);
  const appr = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: rev.json().approval.version } });
  expect(appr.statusCode, appr.body).toBe(200);
  return app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: appr.json().approval.version } });
}

async function addPerson(fullName: string): Promise<string> {
  const sub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName } } });
  expect(sub.statusCode, sub.body).toBe(201);
  const exec = await governedExecute(sub.json().approval.approvalId, sub.json().approval.version);
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json().person.personId as string;
}

async function createMission(name: string, startsOn = '2026-08-01'): Promise<{ missionId: string; version: number }> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name, startsOn } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().mission;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'missions-test-secret-0123456789x',
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
  tokens.finance = await login('finance@alpha.com', 'finance', 'alpha');
  tokens.legal = await login('legal@alpha.com', 'legal', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

describe('mission shell over HTTP', () => {
  it('create → update (versioned, dates byte-for-byte) → deactivate; stale 409; incoherent dates 400', async () => {
    const m = await createMission('Spring Invitational');
    expect(m).toMatchObject({ missionId: 'MSN-0001', version: 0 });

    const bad = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${m.missionId}`,
      headers: auth(tokens.ops),
      payload: { expectedVersion: 0, endsOn: '2026-07-01' }, // before the stored start
    });
    expect(bad.statusCode).toBe(400);

    const upd = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${m.missionId}`,
      headers: auth(tokens.ops),
      payload: { expectedVersion: 0, endsOn: '2026-08-01', gameTitle: 'VALORANT' },
    });
    expect(upd.statusCode, upd.body).toBe(200);
    expect(upd.json().mission).toMatchObject({ endsOn: '2026-08-01', startsOn: '2026-08-01', version: 1 });

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${m.missionId}`,
      headers: auth(tokens.ops),
      payload: { expectedVersion: 0, name: 'Stale write' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe('CONCURRENCY');

    const off = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${m.missionId}/deactivate`,
      headers: auth(tokens.owner),
      payload: { expectedVersion: 1 },
    });
    expect(off.statusCode, off.body).toBe(200);
    expect(off.json().mission.isActive).toBe(false);

    // Reads are people-adjacent: the visitor sees the register and detail.
    const list = await app.inject({ method: 'GET', url: '/api/v1/missions', headers: auth(tokens.visitor) });
    expect(list.json().missions).toHaveLength(1);
    const detail = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}`, headers: auth(tokens.visitor) });
    expect(detail.json().mission.name).toBe('Spring Invitational');
  });

  it('only owner/operations manage the shell (visitor writes 403)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.visitor), payload: { name: 'X', startsOn: '2026-08-01' } });
    expect(res.statusCode).toBe(403);
  });
});

describe('governed participants over HTTP (the Set-D guards at the wire)', () => {
  it('full chain lands an audited roster entry; duplicate-PENDING then duplicate-ACTIVE are 409 PARTICIPANT_CONFLICT', async () => {
    const personId = await addPerson('Star Player');
    const m = await createMission('Roster Mission');

    const sub = await app.inject({
      method: 'POST',
      url: '/api/v1/missions/participants/requests',
      headers: auth(tokens.ops),
      payload: { input: { missionId: m.missionId, personId, role: 'Player' } },
    });
    expect(sub.statusCode, sub.body).toBe(201);
    expect(sub.json().approval).toMatchObject({ operationType: 'AddMissionParticipant', targetId: m.missionId, targetPersonId: personId });

    // Duplicate-PENDING refused while the first approval is open.
    const dupPending = await app.inject({
      method: 'POST',
      url: '/api/v1/missions/participants/requests',
      headers: auth(tokens.ops),
      payload: { input: { missionId: m.missionId, personId, role: 'Coach' } },
    });
    expect(dupPending.statusCode).toBe(409);
    expect(dupPending.json().error.code).toBe('PARTICIPANT_CONFLICT');

    const exec = await governedExecute(sub.json().approval.approvalId, sub.json().approval.version);
    expect(exec.statusCode, exec.body).toBe(200);
    expect(exec.json().participant).toMatchObject({ missionId: m.missionId, personId, personName: 'Star Player', role: 'Player', isActive: true });

    const roster = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/participants`, headers: auth(tokens.visitor) });
    expect(roster.statusCode).toBe(200);
    expect(roster.json().participants).toHaveLength(1);

    // Duplicate-ACTIVE refused at submit once the pair is live.
    const dupActive = await app.inject({
      method: 'POST',
      url: '/api/v1/missions/participants/requests',
      headers: auth(tokens.ops),
      payload: { input: { missionId: m.missionId, personId, role: 'Player' } },
    });
    expect(dupActive.statusCode).toBe(409);
    expect(dupActive.json().error.code).toBe('PARTICIPANT_CONFLICT');
  });

  it('the execute-time guard is authoritative: approval lands as truthful ExecutionFailed, roster untouched', async () => {
    const personId = await addPerson('Raced Player');
    const m = await createMission('Race Mission');

    // Approve an add, retire the SHELL before execution — the exec-time
    // re-check refuses what submit could not foresee.
    const sub = await app.inject({
      method: 'POST',
      url: '/api/v1/missions/participants/requests',
      headers: auth(tokens.ops),
      payload: { input: { missionId: m.missionId, personId, role: 'Player' } },
    });
    const rev = await app.inject({ method: 'POST', url: `/api/v1/approvals/${sub.json().approval.approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: 0 } });
    const appr = await app.inject({ method: 'POST', url: `/api/v1/approvals/${sub.json().approval.approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: rev.json().approval.version } });
    await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/deactivate`, headers: auth(tokens.owner), payload: { expectedVersion: 0 } });

    const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${sub.json().approval.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: appr.json().approval.version } });
    expect(exec.statusCode).toBe(409);

    const after = await app.inject({ method: 'GET', url: `/api/v1/approvals/${sub.json().approval.approvalId}`, headers: auth(tokens.owner) });
    expect(after.json().approval.status).toBe('ExecutionFailed');
    const roster = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/participants`, headers: auth(tokens.owner) });
    expect(roster.json().participants).toHaveLength(0);
  });

  it('remove → re-add reactivates the SAME membership over the wire; removal guards refuse junk', async () => {
    const personId = await addPerson('Returning Player');
    const m = await createMission('Cycle Mission');
    const add = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/requests', headers: auth(tokens.ops), payload: { input: { missionId: m.missionId, personId, role: 'Player' } } });
    await governedExecute(add.json().approval.approvalId, add.json().approval.version);

    const rem = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/removals', headers: auth(tokens.ops), payload: { input: { missionId: m.missionId, personId } } });
    expect(rem.statusCode, rem.body).toBe(201);
    const remExec = await governedExecute(rem.json().approval.approvalId, rem.json().approval.version);
    expect(remExec.json().participant.isActive).toBe(false);

    // Removing a non-participant is a 404 at submit.
    const nope = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/removals', headers: auth(tokens.ops), payload: { input: { missionId: m.missionId, personId: 'PER-9999' } } });
    expect(nope.statusCode).toBe(404);

    const back = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/requests', headers: auth(tokens.ops), payload: { input: { missionId: m.missionId, personId, role: 'Coach' } } });
    const backExec = await governedExecute(back.json().approval.approvalId, back.json().approval.version);
    expect(backExec.json().participant).toMatchObject({ isActive: true, role: 'Coach' });

    const roster = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/participants`, headers: auth(tokens.owner) });
    expect(roster.json().participants).toHaveLength(1); // still ONE row for the pair
  });

  it('visitor may read the roster but not submit; unknown mission is 404', async () => {
    const personId = await addPerson('Someone');
    const m = await createMission('Gate Mission');
    const res = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/requests', headers: auth(tokens.visitor), payload: { input: { missionId: m.missionId, personId, role: 'Player' } } });
    expect(res.statusCode).toBe(403);
    const missing = await app.inject({ method: 'GET', url: '/api/v1/missions/MSN-9999/participants', headers: auth(tokens.owner) });
    expect(missing.statusCode).toBe(404);
  });
});

describe('mission P&L over HTTP (Finance S4)', () => {
  it('lines CRUD + per-diem roll-in + FX blend; the whole surface gated to canViewFinancials', async () => {
    // A bounded mission (15 inclusive days) with a per-diem'd participant.
    const m = await createMission('Money Mission');
    const upd = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}`, headers: auth(tokens.ops), payload: { expectedVersion: 0, endsOn: '2026-08-15' } });
    expect(upd.statusCode, upd.body).toBe(200);
    const personId = await addPerson('Per Diem Player');
    const sub = await app.inject({ method: 'POST', url: '/api/v1/missions/participants/requests', headers: auth(tokens.ops), payload: { input: { missionId: m.missionId, personId, role: 'Player' } } });
    expect((await governedExecute(sub.json().approval.approvalId, sub.json().approval.version)).statusCode).toBe(200);
    const pd = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/participants/${personId}/per-diem`, headers: auth(tokens.ops), payload: { perDiemAmountMinor: 25_000, perDiemCurrency: 'SAR' } });
    expect(pd.statusCode, pd.body).toBe(200);

    // Lines: income + expense; a bad line (zero amount) is a 400.
    const income = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/lines`, headers: auth(tokens.ops), payload: { direction: 'Income', category: 'PrizeMoney', label: 'Prize — 2nd place', amountMinor: 1_000_000, currency: 'USD' } });
    expect(income.statusCode, income.body).toBe(201);
    expect(income.json().line).toMatchObject({ lineId: 'PNL-0001', direction: 'Income' });
    const expense = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/lines`, headers: auth(tokens.ops), payload: { direction: 'Expense', category: 'Travel', label: 'Flights', amountMinor: 200_000, currency: 'USD' } });
    expect(expense.statusCode, expense.body).toBe(201);
    const bad = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/lines`, headers: auth(tokens.ops), payload: { direction: 'Income', category: 'Other', label: 'X', amountMinor: 0, currency: 'USD' } });
    expect(bad.statusCode).toBe(400);

    // Without a SAR rate the blend is honestly null; set the rate → profit appears.
    let pnl = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/pnl`, headers: auth(tokens.owner) });
    expect(pnl.statusCode, pnl.body).toBe(200);
    expect(pnl.json().pnl.blended).toBeNull();
    expect(pnl.json().pnl.missingRates).toEqual(['SAR']);

    const rate = await app.inject({ method: 'POST', url: '/api/v1/fx-rates', headers: auth(tokens.ops), payload: { currency: 'SAR', usdPerUnit: 0.2666 } });
    expect(rate.statusCode, rate.body).toBe(200);
    pnl = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/pnl`, headers: auth(tokens.owner) });
    const sarUsd = Math.round(375_000 * 0.2666);
    expect(pnl.json().pnl.perDiem.entries[0]).toMatchObject({ personId, days: 15, totalMinor: 375_000 });
    expect(pnl.json().pnl.blended).toEqual({ incomeUsdMinor: 1_000_000, expenseUsdMinor: 200_000 + sarUsd, profitUsdMinor: 800_000 - sarUsd });

    // Patch a line (versioned) and soft-remove the other.
    const patched = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/lines/PNL-0001`, headers: auth(tokens.owner), payload: { expectedVersion: 0, amountMinor: 1_200_000 } });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().line).toMatchObject({ amountMinor: 1_200_000, version: 1 });
    const removed = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/lines/PNL-0002/remove`, headers: auth(tokens.ops), payload: { expectedVersion: 0 } });
    expect(removed.statusCode, removed.body).toBe(200);
    pnl = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/pnl`, headers: auth(tokens.owner) });
    expect(pnl.json().lines).toHaveLength(1);

    // Gating: finance reads the P&L but cannot write; legal and visitor get 403 on the read.
    const financeRead = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/pnl`, headers: auth(tokens.finance) });
    expect(financeRead.statusCode).toBe(200);
    const financeWrite = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/lines`, headers: auth(tokens.finance), payload: { direction: 'Income', category: 'Other', label: 'X', amountMinor: 1, currency: 'USD' } });
    expect(financeWrite.statusCode).toBe(403);
    for (const t of [tokens.legal, tokens.visitor]) {
      const denied = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/pnl`, headers: auth(t) });
      expect(denied.statusCode).toBe(403);
    }
  });
});

describe('tenant scoping', () => {
  it('bravo sees nothing of alpha and cannot mutate it (404-invisible)', async () => {
    const m = await createMission('Alpha-only');
    const list = await app.inject({ method: 'GET', url: '/api/v1/missions', headers: auth(tokens.ownerB) });
    expect(list.json().missions).toHaveLength(0);
    const touch = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${m.missionId}`,
      headers: auth(tokens.ownerB),
      payload: { expectedVersion: 0, name: 'Cross-tenant write' },
    });
    expect(touch.statusCode).toBe(404);
    const roster = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/participants`, headers: auth(tokens.ownerB) });
    expect(roster.statusCode).toBe(404);
  });
});

describe('S2 mission finance over HTTP (payments, budgets, lifecycle, dashboard)', () => {
  it('code/organizer/city land on the shell; payment walk; budget variance; stage walk with the settle guard; summary gated', async () => {
    // Shell with the tournament identity.
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      headers: auth(tokens.ops),
      payload: { name: 'Saudi Throwdown', code: 'SATR/2024/0001', organizer: 'Saudi Esports Federation', city: 'Riyadh', startsOn: '2026-08-01', endsOn: '2026-08-15' },
    });
    expect(create.statusCode, create.body).toBe(201);
    const m = create.json().mission;
    expect(m).toMatchObject({ code: 'SATR/2024/0001', organizer: 'Saudi Esports Federation', city: 'Riyadh', financeStage: 'Planning' });

    // A duplicate code in the same tenant is a friendly 409; bravo may reuse it.
    const dup = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Dup', code: 'SATR/2024/0001', startsOn: '2026-08-01' } });
    expect(dup.statusCode).toBe(409);
    const bravoReuse = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ownerB), payload: { name: 'Bravo', code: 'SATR/2024/0001', startsOn: '2026-08-01' } });
    expect(bravoReuse.statusCode, bravoReuse.body).toBe(201);

    // An income line is born Expected; walk it to Received with the mastersheet detail.
    const income = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${m.missionId}/lines`,
      headers: auth(tokens.ops),
      payload: { direction: 'Income', category: 'PrizeMoney', label: 'Prize — 2nd place', amountMinor: 1_000_000, currency: 'SAR' },
    });
    expect(income.statusCode, income.body).toBe(201);
    expect(income.json().line).toMatchObject({ category: 'PrizeMoney', paymentStatus: 'Expected' });
    // a category from the wrong direction is a 400 at the wire
    const badCat = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${m.missionId}/lines`,
      headers: auth(tokens.ops),
      payload: { direction: 'Income', category: 'Travel', label: 'X', amountMinor: 1, currency: 'USD' },
    });
    expect(badCat.statusCode).toBe(400);

    const pay = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${m.missionId}/lines/${income.json().line.lineId}/payment`,
      headers: auth(tokens.ops),
      payload: { expectedVersion: 0, paymentStatus: 'Received', receivedAmountMinor: 950_000, receivedUsdPerUnit: 0.265, paymentSourceLabel: 'ESA', refNo: 'FT2501475Z6Z' },
    });
    expect(pay.statusCode, pay.body).toBe(200);
    expect(pay.json().line).toMatchObject({ paymentStatus: 'Received', receivedAmountMinor: 950_000, refNo: 'FT2501475Z6Z' });

    // Budget a cell and read the derived variance: received 950,000 at the
    // snapshot 0.265 vs a 1,200,000-SAR budget (blended off... no SAR rate
    // stored -> the BUDGET is unblendable, variance honestly null).
    const setB = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${m.missionId}/budgets`,
      headers: auth(tokens.owner),
      payload: { direction: 'Income', category: 'PrizeMoney', currency: 'SAR', amountMinor: 1_200_000 },
    });
    expect(setB.statusCode, setB.body).toBe(200);
    let pnl = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/pnl`, headers: auth(tokens.owner) });
    expect(pnl.statusCode, pnl.body).toBe(200);
    expect(pnl.json().budgets).toHaveLength(1);
    let cat = pnl.json().pnl.perCategory.find((c: { category: string }) => c.category === 'PrizeMoney');
    expect(cat.actualUsdMinor).toBe(Math.round(950_000 * 0.265)); // the snapshot carries the actual
    expect(cat.budgetUsdMinor).toBeNull(); // no SAR rate for the budget — honest null
    expect(pnl.json().pnl.blended).toBeNull();
    expect(pnl.json().pnl.missingRates).toEqual(['SAR']);

    // Set the SAR rate -> variance appears.
    const rate = await app.inject({ method: 'POST', url: '/api/v1/fx-rates', headers: auth(tokens.ops), payload: { currency: 'SAR', usdPerUnit: 0.2666 } });
    expect(rate.statusCode, rate.body).toBe(200);
    pnl = await app.inject({ method: 'GET', url: `/api/v1/missions/${m.missionId}/pnl`, headers: auth(tokens.owner) });
    cat = pnl.json().pnl.perCategory.find((c: { category: string }) => c.category === 'PrizeMoney');
    expect(cat.budgetUsdMinor).toBe(Math.round(1_200_000 * 0.2666));
    expect(cat.varianceUsdMinor).toBe(cat.actualUsdMinor - cat.budgetUsdMinor);
    expect(pnl.json().pnl.settlement).toMatchObject({ outstandingIncomeCount: 0, incomeComplete: true });

    // Finance stage: skipping is 409; the legal walk reaches Settled (income all Received).
    const skip = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/finance-stage`, headers: auth(tokens.ops), payload: { expectedVersion: m.version, stage: 'Active' } });
    expect(skip.statusCode).toBe(409);
    let version = m.version;
    for (const stage of ['FinancePending', 'Confirmed', 'Active', 'PostMission', 'Settled']) {
      const step = await app.inject({ method: 'POST', url: `/api/v1/missions/${m.missionId}/finance-stage`, headers: auth(tokens.ops), payload: { expectedVersion: version, stage } });
      expect(step.statusCode, step.body).toBe(200);
      version = step.json().mission.version;
    }

    // The all-missions dashboard: gated to canViewFinancials; carries the row.
    const summary = await app.inject({ method: 'GET', url: '/api/v1/missions/finance-summary', headers: auth(tokens.finance) });
    expect(summary.statusCode, summary.body).toBe(200);
    const row = summary.json().missions.find((x: { missionId: string }) => x.missionId === m.missionId);
    expect(row).toMatchObject({ code: 'SATR/2024/0001', financeStage: 'Settled', outstandingIncomeCount: 0 });
    for (const t of [tokens.legal, tokens.visitor]) {
      const denied = await app.inject({ method: 'GET', url: '/api/v1/missions/finance-summary', headers: auth(t) });
      expect(denied.statusCode).toBe(403);
    }
  });
});
