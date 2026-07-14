/**
 * invoices.test.ts (api) — S6 over HTTP with the fs document driver: issue
 * against an income line (per-entity yearly series, VAT half-up, PDF stored
 * as an Invoice-owned document), the line flips Expected → Invoiced, void
 * with a reason flips it back and NEVER reuses the number, one live invoice
 * per line, independent series per entity, void refused once the money is
 * Received, the finance gates hold, and the settlement signals reach the
 * Situation Room (the signals-ship-with-features law, hosted end to end).
 */
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
import { attachInvoicePdfDocument } from '@c3web/application';
import type { Actor } from '@c3web/domain';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;

const tokens = {} as { ops: string; owner: string; visitor: string };
const YEAR = new Date().toISOString().slice(0, 4);

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
  return res;
}

/** The mission's P&L line by id (via the pnl read — the UI's own view). */
async function lineState(missionId: string, lineId: string) {
  const res = await get(tokens.owner, `/api/v1/missions/${missionId}/pnl`);
  return res.json().lines.find((l: { lineId: string }) => l.lineId === lineId);
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'invoices-test-secret-0123456789xy',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'c3-inv-')),
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

describe('invoices over HTTP (S6)', () => {
  it('issue → series number + VAT + PDF + line flip; void keeps the number; gates and signals hold', async () => {
    // ── the stage: two entities (independent series), one ended mission, income lines ──
    const gka = (await post(tokens.ops, '/api/v1/entities', { name: 'Geekay KSA', code: 'GKA', jurisdiction: 'KSA', registrationId: 'VAT-311', localCurrency: 'SAR' })).entity;
    const gkec = (await post(tokens.ops, '/api/v1/entities', { name: 'Geekay UAE', code: 'GKEC', jurisdiction: 'UAE', localCurrency: 'AED' })).entity;
    const noCode = (await post(tokens.ops, '/api/v1/entities', { name: 'Codeless Org', jurisdiction: 'UAE', localCurrency: 'USD' })).entity;

    const ended = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    const mission = (
      await post(tokens.ops, '/api/v1/missions', { name: 'Summer Cup', code: `SATR/${YEAR}/0001`, organizer: 'VSPN', startsOn: ended(20), endsOn: ended(3) })
    ).mission;
    const msn = mission.missionId as string;

    const line1 = (await post(tokens.ops, `/api/v1/missions/${msn}/lines`, { direction: 'Income', category: 'PrizeMoney', label: 'Prize - 2nd place', amountMinor: 800000, currency: 'USD' })).line;
    const line2 = (await post(tokens.ops, `/api/v1/missions/${msn}/lines`, { direction: 'Income', category: 'AppearanceFee', label: 'Appearance', amountMinor: 100000, currency: 'AED' })).line;
    const expense = (await post(tokens.ops, `/api/v1/missions/${msn}/lines`, { direction: 'Expense', category: 'Travel', label: 'Flights', amountMinor: 50000, currency: 'USD' })).line;

    // ── issue #1: GKA series, 5% VAT half-up, PDF stored, line flipped ────────
    const issued = await post(tokens.ops, '/api/v1/invoices', {
      missionId: msn,
      lineId: line1.lineId,
      entityId: gka.entityId,
      billedToName: 'VSPN',
      billedToDetails: 'Riyadh, KSA',
      vatRateBps: 500,
      description: 'Prize money - 2nd place',
    });
    const inv1 = issued.invoice;
    expect(issued.pdfError).toBeUndefined();
    expect(inv1.invoiceNumber).toBe(`GKA-INV-${YEAR}-001`);
    expect(inv1).toMatchObject({ subtotalMinor: 800000, vatMinor: 40000, totalMinor: 840000, currency: 'USD', status: 'Issued', incomeCategory: 'PrizeMoney' });
    expect(inv1.documentId).toMatch(/^DOC-\d{4,}$/);
    expect((await lineState(msn, line1.lineId)).paymentStatus).toBe('Invoiced');

    // The audit: InvoiceIssued on the invoice trail; the flip on the mission trail names the paper.
    const invAudit = await get(tokens.owner, `/api/v1/invoices/${inv1.invoiceId}/audit`);
    expect(invAudit.json().events.some((e: { action: string }) => e.action === 'InvoiceIssued')).toBe(true);
    const msnAudit = await get(tokens.owner, `/api/v1/missions/${msn}/audit`);
    expect(JSON.stringify(msnAudit.json())).toContain(inv1.invoiceNumber);

    // The PDF artifact: %PDF magic, honest headers, Invoice-owner read gate.
    const pdf = await get(tokens.owner, `/api/v1/documents/${inv1.documentId}/content`);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain(`GKA-INV-${YEAR}-001.pdf`);
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await app.inject({ method: 'GET', url: `/api/v1/documents/${inv1.documentId}/content`, headers: auth(tokens.visitor) })).statusCode).toBe(403);

    // ── refusals: double-issue (409), expense line (409), codeless entity (400) ──
    await post(tokens.ops, '/api/v1/invoices', { missionId: msn, lineId: line1.lineId, entityId: gka.entityId, billedToName: 'VSPN', vatRateBps: 0 }, 409);
    await post(tokens.ops, '/api/v1/invoices', { missionId: msn, lineId: expense.lineId, entityId: gka.entityId, billedToName: 'VSPN', vatRateBps: 0 }, 409);
    await post(tokens.ops, '/api/v1/invoices', { missionId: msn, lineId: line2.lineId, entityId: noCode.entityId, billedToName: 'VSPN', vatRateBps: 0 }, 400);

    // ── independent series: GKEC's first number is its own -001 ───────────────
    const inv2 = (await post(tokens.ops, '/api/v1/invoices', { missionId: msn, lineId: line2.lineId, entityId: gkec.entityId, billedToName: 'EFG', vatRateBps: 0 })).invoice;
    expect(inv2.invoiceNumber).toBe(`GKEC-INV-${YEAR}-001`);
    expect(inv2).toMatchObject({ vatMinor: 0, totalMinor: 100000, currency: 'AED' });

    // ── the settlement signals reach the cockpit (signals-ship-with-features) ─
    await post(tokens.ops, `/api/v1/missions/${msn}/finance-stage`, { expectedVersion: mission.version, stage: 'FinancePending' }, 200);
    let v = (await get(tokens.owner, `/api/v1/missions/${msn}`)).json().mission.version;
    await post(tokens.ops, `/api/v1/missions/${msn}/finance-stage`, { expectedVersion: v, stage: 'Confirmed' }, 200);
    v = (await get(tokens.owner, `/api/v1/missions/${msn}`)).json().mission.version;
    await post(tokens.ops, `/api/v1/missions/${msn}/finance-stage`, { expectedVersion: v, stage: 'Active' }, 200);
    v = (await get(tokens.owner, `/api/v1/missions/${msn}`)).json().mission.version;
    await post(tokens.ops, `/api/v1/missions/${msn}/finance-stage`, { expectedVersion: v, stage: 'PostMission' }, 200);

    const situation = (await get(tokens.owner, '/api/v1/situation')).json();
    const outstanding = situation.signals.find((sg: { kind: string }) => sg.kind === 'PaymentOutstanding');
    expect(outstanding, JSON.stringify(situation.signals.map((sg: { key: string }) => sg.key))).toBeTruthy();
    expect(JSON.stringify(outstanding.reasons)).toContain(inv1.invoiceNumber); // the paper is named
    expect(situation.signals.some((sg: { kind: string }) => sg.kind === 'IncomeNotInvoiced')).toBe(false); // everything income is invoiced

    // ── void: reason mandatory, number kept, line back to Expected, re-issue = -002 ──
    const voided = (await post(tokens.ops, `/api/v1/invoices/${inv1.invoiceId}/void`, { reason: 'Wrong VAT rate', expectedVersion: inv1.version }, 200)).invoice; // the issue response is post-PDF-link — current version
    expect(voided.status).toBe('Voided');
    expect(voided.voidedReason).toBe('Wrong VAT rate');
    expect((await lineState(msn, line1.lineId)).paymentStatus).toBe('Expected');
    // Now the cockpit says NOT INVOICED for that line instead.
    const after = (await get(tokens.owner, '/api/v1/situation')).json();
    expect(after.signals.some((sg: { kind: string }) => sg.kind === 'IncomeNotInvoiced')).toBe(true);

    const inv3 = (await post(tokens.ops, '/api/v1/invoices', { missionId: msn, lineId: line1.lineId, entityId: gka.entityId, billedToName: 'VSPN', vatRateBps: 1500 })).invoice;
    expect(inv3.invoiceNumber).toBe(`GKA-INV-${YEAR}-002`); // the gap IS the audit trail
    expect(inv3).toMatchObject({ vatMinor: 120000, totalMinor: 920000 }); // 15% of 8,000.00 half-up

    // ── void refused once the money is Received — correct the line first ──────
    const l1 = await lineState(msn, line1.lineId);
    await post(tokens.ops, `/api/v1/missions/${msn}/lines/${line1.lineId}/payment`, { expectedVersion: l1.version, paymentStatus: 'Received', receivedAmountMinor: 920000, paymentSourceLabel: 'ESA', refNo: 'FT2601475Z6Z' }, 200);
    const inv3Now = (await get(tokens.owner, `/api/v1/invoices/${inv3.invoiceId}`)).json().invoice;
    await post(tokens.ops, `/api/v1/invoices/${inv3.invoiceId}/void`, { reason: 'too late', expectedVersion: inv3Now.version }, 409);

    // ── gates: the register and the paper are finance-only ────────────────────
    expect((await app.inject({ method: 'GET', url: '/api/v1/invoices', headers: auth(tokens.visitor) })).statusCode).toBe(403);
    const register = (await get(tokens.owner, '/api/v1/invoices')).json();
    expect(register.invoices).toHaveLength(3);
    expect(register.invoices.map((x: { status: string }) => x.status).sort()).toEqual(['Issued', 'Issued', 'Voided']);
  });

  it('HARDEN-3.5 B site 6 (R6-N08): a LINK failure rolls back the WHOLE registration — no dangling doc row, intent still prepared, no bytes deleted', async () => {
    // Stage a real issued invoice (its own PDF already attached by the issue flow).
    const gka = (await post(tokens.ops, '/api/v1/entities', { name: 'Geekay KSA', code: 'GKA', jurisdiction: 'KSA', localCurrency: 'SAR' })).entity;
    const ended = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
    const mission = (await post(tokens.ops, '/api/v1/missions', { name: 'Atomic Cup', code: `SATR/${YEAR}/0009`, organizer: 'VSPN', startsOn: ended(20), endsOn: ended(3) })).mission;
    const line = (await post(tokens.ops, `/api/v1/missions/${mission.missionId}/lines`, { direction: 'Income', category: 'PrizeMoney', label: 'Prize', amountMinor: 800000, currency: 'USD' })).line;
    const inv = (await post(tokens.ops, '/api/v1/invoices', { missionId: mission.missionId, lineId: line.lineId, entityId: gka.entityId, billedToName: 'VSPN', billedToDetails: 'Riyadh', vatRateBps: 500, description: 'Prize' })).invoice;

    const [tenant] = await db.adminQuery<{ id: string }>(`SELECT id FROM tenant WHERE slug='alpha'`);
    const actor: Actor = { identity: 'ops@alpha.com', displayName: 'Ops', role: 'operations', tenantId: tenant!.id };
    const storageKey = `${tenant!.id}/r6n08-atomicity-probe`;
    // The write-ahead intent + the (simulated) stored bytes exist; now the composed
    // registration runs with a STALE invoice version so the LINK leg fails.
    await deps.persistence.writes.transaction(actor, (tx) =>
      tx.insertBlobTombstone({ storageKey, blobClass: 'document', reason: 'compensation', state: 'prepared', preparedTtlMs: 600_000 }),
    );
    await expect(
      attachInvoicePdfDocument(deps.persistence, actor, {
        invoiceId: inv.invoiceId,
        expectedVersion: 0, // stale — the issue flow already bumped the version
        invoiceNumber: inv.invoiceNumber,
        contentType: 'application/pdf',
        sizeBytes: 10,
        sha256: 'a'.repeat(64),
        storageKey,
      }),
    ).rejects.toThrow(/concurren|conflict/i);

    // R6-N08's crux: NOTHING half-committed. The old two-tx shape left a COMMITTED document
    // row (registration + resolve in tx-1) while the catch deleted the bytes — registered
    // metadata pointing at nothing. The composed tx leaves NO doc row…
    const docs = await db.adminQuery<{ n: number }>(`SELECT count(*)::int AS n FROM document WHERE storage_key=$1`, [storageKey]);
    expect(docs[0]!.n).toBe(0);
    // …and the intent is STILL PREPARED (the resolve rolled back with everything else), so the
    // failure path can arm it and the drain reclaims the bytes.
    const [intent] = await db.adminQuery<{ state: string }>(`SELECT state FROM blob_tombstone WHERE storage_key=$1`, [storageKey]);
    expect(intent!.state).toBe('prepared');
  });
});
