/**
 * search.test.ts (api) — S3 global search over HTTP. The role boundary IS the
 * feature: a domain the actor may not read is simply ABSENT from results (the
 * registers' truthful-absence rule applied to search). Identity fields only —
 * financial values are never searchable or returned.
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

const tokens = {} as { ops: string; owner: string; legal: string; hr: string; visitor: string; ownerB: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function governedExecute(approvalId: string, version: number) {
  const rev = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: version } });
  expect(rev.statusCode, rev.body).toBe(200);
  const appr = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: rev.json().approval.version } });
  expect(appr.statusCode, appr.body).toBe(200);
  const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: appr.json().approval.version } });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

async function search(token: string, q: string) {
  const res = await app.inject({ method: 'GET', url: `/api/v1/search?q=${encodeURIComponent(q)}`, headers: auth(token) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().results as Array<{ kind: string; id: string; title: string; subtitle: string | null }>;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'search-test-secret-0123456789xyz',
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
  tokens.legal = await login('legal@alpha.com', 'legal', 'alpha');
  tokens.hr = await login('hr@alpha.com', 'hr', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

describe('global search over HTTP (S3)', () => {
  it('finds by id and by name across domains; the role boundary shapes the results; tenants are isolated', async () => {
    // Seed: a person (governed), a coded mission, an entity, an agreement (governed).
    const personSub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName: 'Jordan Reyes', ign: 'JREY' } } });
    const personId = (await governedExecute(personSub.json().approval.approvalId, personSub.json().approval.version)).person.personId as string;

    const mission = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      headers: auth(tokens.ops),
      payload: { name: 'Saudi Throwdown', code: 'SATR/2026/0001', organizer: 'Saudi Esports Federation', city: 'Riyadh', startsOn: '2026-08-01' },
    });
    expect(mission.statusCode, mission.body).toBe(201);

    const entity = await app.inject({
      method: 'POST',
      url: '/api/v1/entities',
      headers: auth(tokens.ops),
      payload: { name: 'Geekay UAE', code: 'GKA', jurisdiction: 'UAE', localCurrency: 'AED' },
    });
    expect(entity.statusCode, entity.body).toBe(201);

    const agrSub = await app.inject({
      method: 'POST',
      url: '/api/v1/agreements/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, agreementType: 'Player Contract', agreementCode: 'GKE-PL-2026-001', startsOn: '2026-08-01', endsOn: '2027-07-31', valueUsdCents: 25_000_000 } },
    });
    expect(agrSub.statusCode, agrSub.body).toBe(201);
    await governedExecute(agrSub.json().approval.approvalId, agrSub.json().approval.version);

    // By NAME — the owner sees everything.
    let hits = await search(tokens.owner, 'Jordan');
    expect(hits.some((h) => h.kind === 'person' && h.id === personId)).toBe(true);
    // By IGN.
    hits = await search(tokens.owner, 'jrey');
    expect(hits.some((h) => h.kind === 'person')).toBe(true);
    // By tournament CODE and by mission id.
    hits = await search(tokens.owner, 'SATR');
    expect(hits.some((h) => h.kind === 'mission' && h.id === 'MSN-0001')).toBe(true);
    hits = await search(tokens.owner, 'msn-0001');
    expect(hits.some((h) => h.kind === 'mission')).toBe(true);
    // Entity by code.
    hits = await search(tokens.owner, 'GKA');
    expect(hits.some((h) => h.kind === 'entity' && h.id === 'ENT-0001')).toBe(true);
    // Agreement by its code — and the hit carries NO financial data anywhere.
    hits = await search(tokens.owner, 'GKE-PL');
    const agrHit = hits.find((h) => h.kind === 'agreement')!;
    expect(agrHit).toBeTruthy();
    expect(JSON.stringify(hits)).not.toContain('25000000'); // value never leaks through search
    // Approvals are searchable for owner/ops.
    hits = await search(tokens.owner, 'APR-000');
    expect(hits.some((h) => h.kind === 'approval')).toBe(true);

    // The VISITOR's world: person + mission visible; agreements/approvals ABSENT.
    hits = await search(tokens.visitor, 'GKE-PL');
    expect(hits.some((h) => h.kind === 'agreement')).toBe(false);
    hits = await search(tokens.visitor, 'APR-000');
    expect(hits.some((h) => h.kind === 'approval')).toBe(false);
    hits = await search(tokens.visitor, 'Jordan');
    expect(hits.some((h) => h.kind === 'person')).toBe(true);

    // LEGAL reads agreements (identity fields) but not the approvals queue.
    hits = await search(tokens.legal, 'GKE-PL');
    expect(hits.some((h) => h.kind === 'agreement')).toBe(true);
    hits = await search(tokens.legal, 'APR-000');
    expect(hits.some((h) => h.kind === 'approval')).toBe(false);

    // Another tenant sees NOTHING of alpha.
    hits = await search(tokens.ownerB, 'Jordan');
    expect(hits).toHaveLength(0);

    // Sub-minimum queries return empty (never a full-table dump).
    expect(await search(tokens.owner, 'J')).toHaveLength(0);
    expect(await search(tokens.owner, '  ')).toHaveLength(0);
  });

  it('S3.1: invoices, teams, claims, distributions, documents, terms, P&L lines and beneficiaries are searchable — each behind its own gate', async () => {
    // ── the graph: person → agreement (+term, +document) · mission → line
    //    (Received, bank ref) → invoice + distribution · team · claims · beneficiary ──
    const personSub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName: 'Sasha Petrova' } } });
    const personId = (await governedExecute(personSub.json().approval.approvalId, personSub.json().approval.version)).person.personId as string;

    const agrSub = await app.inject({
      method: 'POST',
      url: '/api/v1/agreements/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, agreementType: 'Player Contract', startsOn: '2026-08-01', endsOn: '2027-07-31' } },
    });
    await governedExecute(agrSub.json().approval.approvalId, agrSub.json().approval.version);
    const termSub = await app.inject({
      method: 'POST',
      url: '/api/v1/agreements/terms/requests',
      headers: auth(tokens.ops),
      payload: { input: { agreementId: 'AGR-0001', kind: 'Salary', amountMinor: 500_000, currency: 'AED', label: 'Base monthly retainer' } },
    });
    expect(termSub.statusCode, termSub.body).toBe(201);
    await governedExecute(termSub.json().approval.approvalId, termSub.json().approval.version);

    // a PDF on the agreement (real magic bytes — M-07)
    const form = new FormData();
    form.append('ownerType', 'Agreement');
    form.append('ownerId', 'AGR-0001');
    form.append('file', new Blob([Buffer.from('%PDF-1.4 sponsorship paper')], { type: 'application/pdf' }), 'sponsorship-contract.pdf');
    const up = await app.inject({ method: 'POST', url: '/api/v1/documents', headers: auth(tokens.ops), body: form as never });
    expect(up.statusCode, up.body).toBe(201);

    const mission = await app.inject({
      method: 'POST',
      url: '/api/v1/missions',
      headers: auth(tokens.ops),
      payload: { name: 'Riyadh Major', startsOn: '2026-08-01', endsOn: '2026-08-05' },
    });
    expect(mission.statusCode, mission.body).toBe(201);
    const msn = mission.json().mission.missionId as string;
    const line = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${msn}/lines`,
      headers: auth(tokens.ops),
      payload: { direction: 'Income', category: 'PrizeMoney', label: 'Prize — champions', amountMinor: 1_000_000, currency: 'USD' },
    });
    expect(line.statusCode, line.body).toBe(201);
    const lineId = line.json().line.lineId as string;

    // invoice FIRST (issuing needs an Expected line: Expected → Invoiced)…
    const entity = await app.inject({ method: 'POST', url: '/api/v1/entities', headers: auth(tokens.ops), payload: { name: 'Geekay UAE', code: 'GKA', jurisdiction: 'UAE', localCurrency: 'AED' } });
    expect(entity.statusCode, entity.body).toBe(201);
    const invoice = await app.inject({
      method: 'POST',
      url: '/api/v1/invoices',
      headers: auth(tokens.ops),
      payload: { missionId: msn, lineId, entityId: entity.json().entity.entityId, billedToName: 'VSPN Organizers', vatRateBps: 0 },
    });
    expect(invoice.statusCode, invoice.body).toBe(201);
    const invoiceNumber = invoice.json().invoice.invoiceNumber as string; // GKA-INV-2026-001

    // …then the money lands (Invoiced → Received, with the bank reference),
    // which is what makes the line distributable.
    const pay = await app.inject({
      method: 'POST',
      url: `/api/v1/missions/${msn}/lines/${lineId}/payment`,
      headers: auth(tokens.ops),
      payload: { expectedVersion: 1, paymentStatus: 'Received', receivedAmountMinor: 1_000_000, receivedUsdPerUnit: null, paymentSourceLabel: 'ESA', refNo: 'FT2501475Z6Z' },
    });
    expect(pay.statusCode, pay.body).toBe(200);

    const dist = await app.inject({
      method: 'POST',
      url: '/api/v1/distributions',
      headers: auth(tokens.ops),
      payload: { missionId: msn, lineId, orgShareBps: 10000, shares: [] },
    });
    expect(dist.statusCode, dist.body).toBe(201);

    const team = await app.inject({ method: 'POST', url: '/api/v1/teams', headers: auth(tokens.ops), payload: { name: 'Rainbow Six', code: 'R6', kind: 'GameDivision' } });
    expect(team.statusCode, team.body).toBe(201);

    // claims: HR's own + an ops one (HR has no financial visibility)
    const hrClaim = await app.inject({ method: 'POST', url: '/api/v1/claims', headers: auth(tokens.hr), payload: { category: 'Travel', description: 'Taxi to venue airport', amountMinor: 4500, currency: 'SAR', expenseOn: '2026-08-02' } });
    expect(hrClaim.statusCode, hrClaim.body).toBe(201);
    const opsClaim = await app.inject({ method: 'POST', url: '/api/v1/claims', headers: auth(tokens.ops), payload: { category: 'Accommodation', description: 'Hotel booking deposit', amountMinor: 90_000, currency: 'SAR', expenseOn: '2026-08-02' } });
    expect(opsClaim.statusCode, opsClaim.body).toBe(201);

    const benSub = await app.inject({
      method: 'POST',
      url: '/api/v1/beneficiaries/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, label: 'ESA main', bankName: 'Emirates Islamic', bankCountry: 'UAE', currency: 'AED', paymentType: 'local' } },
    });
    expect(benSub.statusCode, benSub.body).toBe(201);
    await governedExecute(benSub.json().approval.approvalId, benSub.json().approval.version);

    // ── the OWNER finds each new domain, with parentId routing children home ──
    const invHits = await search(tokens.owner, invoiceNumber.slice(0, 7)); // "GKA-INV"
    const invHit = invHits.find((h) => h.kind === 'invoice')!;
    expect(invHit).toMatchObject({ id: 'INV-0001', title: invoiceNumber, parentId: msn });

    const refHits = await search(tokens.owner, 'FT2501475Z6Z');
    expect(refHits.find((h) => h.kind === 'line')).toMatchObject({ id: lineId, parentId: msn });

    expect((await search(tokens.owner, 'Rainbow')).find((h) => h.kind === 'team')).toMatchObject({ id: 'TEAM-0001' });
    expect((await search(tokens.owner, 'DIST-0001')).find((h) => h.kind === 'distribution')).toMatchObject({ id: 'DIST-0001', parentId: msn });
    expect((await search(tokens.owner, 'Base monthly')).find((h) => h.kind === 'term')).toMatchObject({ parentId: 'AGR-0001' });
    expect((await search(tokens.owner, 'sponsorship-con')).find((h) => h.kind === 'document')).toMatchObject({ parentId: 'Agreement:AGR-0001' });
    expect((await search(tokens.owner, 'ESA main')).find((h) => h.kind === 'beneficiary')).toMatchObject({ parentId: personId });

    // claims: the owner (financial visibility) sees BOTH; HR sees ONLY its own.
    expect((await search(tokens.owner, 'Taxi to venue')).some((h) => h.kind === 'claim')).toBe(true);
    expect((await search(tokens.owner, 'Hotel booking')).some((h) => h.kind === 'claim')).toBe(true);
    expect((await search(tokens.hr, 'Taxi to venue')).some((h) => h.kind === 'claim')).toBe(true);
    expect((await search(tokens.hr, 'Hotel booking')).some((h) => h.kind === 'claim')).toBe(false);

    // ── gates: finance domains ABSENT for non-finance roles ──────────────────
    for (const [token, name] of [[tokens.visitor, 'visitor'], [tokens.legal, 'legal'], [tokens.hr, 'hr']] as const) {
      const inv = await search(token, 'GKA-INV');
      expect(inv.some((h) => h.kind === 'invoice'), `${name} must not see invoices`).toBe(false);
      const ln = await search(token, 'FT2501475Z6Z');
      expect(ln.some((h) => h.kind === 'line'), `${name} must not see P&L lines`).toBe(false);
      const ben = await search(token, 'ESA main');
      expect(ben.some((h) => h.kind === 'beneficiary'), `${name} must not see beneficiaries`).toBe(false);
    }
    // documents follow their OWNER's gate: legal reads agreement paper, visitor/hr do not.
    expect((await search(tokens.legal, 'sponsorship-con')).some((h) => h.kind === 'document')).toBe(true);
    expect((await search(tokens.visitor, 'sponsorship-con')).some((h) => h.kind === 'document')).toBe(false);
    expect((await search(tokens.hr, 'sponsorship-con')).some((h) => h.kind === 'document')).toBe(false);
    // teams are org structure — visible at the baseline.
    expect((await search(tokens.visitor, 'Rainbow')).some((h) => h.kind === 'team')).toBe(true);

    // ── ranking: an exact business-id match is the FIRST hit ─────────────────
    const ranked = await search(tokens.owner, msn.toLowerCase());
    expect(ranked[0]).toMatchObject({ kind: 'mission', id: msn });
  });
});
