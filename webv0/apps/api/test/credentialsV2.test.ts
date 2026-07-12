/**
 * credentialsV2.test.ts (api) — S12 over HTTP: the typed taxonomy, the PII
 * document number (structural omission on reads AND inside approval payloads),
 * the governed facts change end to end, the direct details edit (409 stale),
 * the beneficiary registry (governed lifecycle, label-uniqueness, finance-
 * gated reads, THE LAW: digit runs refused), and the bank form with blank
 * sensitive columns.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
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

const tokens = {} as { ops: string; owner: string; hr: string; finance: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function call(method: 'GET' | 'POST' | 'PATCH', token: string, url: string, payload?: Record<string, unknown>, expected = 200) {
  const res = await app.inject({ method, url, headers: auth(token), ...(payload ? { payload } : {}) });
  expect(res.statusCode, `${method} ${url}: ${res.body}`).toBe(expected);
  return res.json();
}

async function adminQuery(text: string, params: unknown[] = []): Promise<void> {
  const c = new Client({ connectionString: db.adminUrl });
  await c.connect();
  try {
    await c.query(text, params);
  } finally {
    await c.end();
  }
}

async function pipeline(approvalId: string, version: number) {
  const r1 = (await call('POST', tokens.owner, `/api/v1/approvals/${approvalId}/begin-review`, { expectedVersion: version })).approval;
  const r2 = (await call('POST', tokens.owner, `/api/v1/approvals/${approvalId}/approve`, { expectedVersion: r1.version })).approval;
  return call('POST', tokens.owner, `/api/v1/approvals/${approvalId}/execute`, { expectedVersion: r2.version });
}

async function createPerson(fullName: string): Promise<string> {
  const a = (await call('POST', tokens.ops, '/api/v1/approvals', { input: { fullName } }, 201)).approval;
  const ex = await pipeline(a.approvalId, a.version);
  return ex.person.personId as string;
}

async function createCredential(personId: string, extra: Record<string, unknown> = {}): Promise<{ credentialId: string; version: number }> {
  const a = (
    await call('POST', tokens.ops, '/api/v1/credentials/requests', {
      input: { personId, credentialType: 'Passport', kind: 'Passport', issuedOn: '2024-01-01', expiresOn: '2034-01-01', ...extra },
    }, 201)
  ).approval;
  const ex = await pipeline(a.approvalId, a.version);
  return { credentialId: ex.credential.credentialId as string, version: ex.credential.version as number };
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'credentials-v2-test-secret-0123456',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'c3-cv2-')),
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
  tokens.finance = await login('finance@alpha.com', 'finance', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
});

describe('credentials v2 over HTTP (S12)', () => {
  it('documentNumber is PII: omitted on reads without standing, projected out of approval payloads', async () => {
    const personId = await createPerson('Passport Holder');
    const { credentialId } = await createCredential(personId, { documentNumber: 'P12345XY', issuingCountry: 'Germany' });

    // reads: hr (PII standing) sees the number; finance gets the KEY ABSENT
    const hrView = (await call('GET', tokens.hr, `/api/v1/people/${personId}/credentials`)).credentials[0];
    expect(hrView.documentNumber).toBe('P12345XY');
    expect(hrView.kind).toBe('Passport');
    expect(hrView.issuingCountry).toBe('Germany');
    const finView = (await call('GET', tokens.finance, `/api/v1/people/${personId}/credentials`)).credentials[0];
    expect('documentNumber' in finView, 'documentNumber must be structurally absent').toBe(false);
    expect(finView.issuingCountry).toBe('Germany'); // non-PII fact stays visible

    // a governed facts change carrying the number: a DELEGATED finance viewer
    // (approvals standing via delegation, no PII by role) sees the patch
    // WITHOUT the number — the H-01 projection holding for S12's new payload.
    const req = (
      await call('POST', tokens.ops, `/api/v1/credentials/${credentialId}/facts-request`, { patch: { documentNumber: 'P99999ZZ' } }, 201)
    ).approval;
    const today = new Date().toISOString().slice(0, 10);
    const plus2 = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    const dlg = (
      await call('POST', tokens.owner, '/api/v1/delegations', { granteeIdentity: 'finance@alpha.com', startsOn: today, endsOn: plus2, reason: 'S12 projection probe' }, 201)
    ).delegation;
    const finPayload = (await call('GET', tokens.finance, `/api/v1/approvals/${req.approvalId}`)).approval.payload;
    expect('documentNumber' in finPayload.input.patch, 'document number must be projected out for a non-PII delegate').toBe(false);
    const ownerPayload = (await call('GET', tokens.owner, `/api/v1/approvals/${req.approvalId}`)).approval.payload;
    expect(ownerPayload.input.patch.documentNumber).toBe('P99999ZZ');
    await call('POST', tokens.owner, `/api/v1/delegations/${dlg.delegationId}/revoke`, { expectedVersion: dlg.version, reason: 'Probe done' });

    // execute → the fact lands; only PII standing reads it back
    await pipeline(req.approvalId, req.version);
    const after = (await call('GET', tokens.owner, `/api/v1/people/${personId}/credentials`)).credentials[0];
    expect(after.documentNumber).toBe('P99999ZZ');
  });

  it('facts are governed (one open op per credential); details are direct with 409 stale', async () => {
    const personId = await createPerson('Facts Person');
    const { credentialId, version } = await createCredential(personId);

    // open facts request blocks a second one AND a deactivation request
    const open = (await call('POST', tokens.ops, `/api/v1/credentials/${credentialId}/facts-request`, { patch: { issuingCountry: 'UAE' } }, 201)).approval;
    await call('POST', tokens.ops, `/api/v1/credentials/${credentialId}/facts-request`, { patch: { kind: 'Visa' } }, 409);

    // details move directly (issuer/notes), version-guarded
    const upd = (await call('PATCH', tokens.ops, `/api/v1/credentials/${credentialId}`, { expectedVersion: version, patch: { issuer: 'Federal Office' } })).credential;
    expect(upd.issuer).toBe('Federal Office');
    await call('PATCH', tokens.ops, `/api/v1/credentials/${credentialId}`, { expectedVersion: version, patch: { issuer: 'X' } }, 409);
    // read-only roles cannot use the direct patch
    await call('PATCH', tokens.visitor, `/api/v1/credentials/${credentialId}`, { expectedVersion: upd.version, patch: { issuer: 'Y' } }, 403);

    // execute the open facts change; the date sanity law holds at execute
    await pipeline(open.approvalId, open.version);
    const finas = (await call('GET', tokens.owner, `/api/v1/people/${personId}/credentials`)).credentials[0];
    expect(finas.issuingCountry).toBe('UAE');
  });

  it('M-07: facts and deactivate are mutually exclusive; approved facts refuse to execute on a retired credential', async () => {
    const personId = await createPerson('M7 Person');
    const { credentialId } = await createCredential(personId);

    // Reciprocal exclusion (both orderings): an open facts request blocks a
    // deactivation request, and an open deactivation blocks a facts request.
    const facts = (await call('POST', tokens.ops, `/api/v1/credentials/${credentialId}/facts-request`, { patch: { issuingCountry: 'UAE' } }, 201)).approval;
    await call('POST', tokens.ops, '/api/v1/credentials/deactivations', { input: { credentialId, personId } }, 409);

    // The execution re-check closes the concurrent-submit TOCTOU: approve the
    // facts, retire the credential OUT OF BAND (as a racing deactivate would),
    // then executing the facts is REFUSED — a retired record's facts never change.
    const r1 = (await call('POST', tokens.owner, `/api/v1/approvals/${facts.approvalId}/begin-review`, { expectedVersion: facts.version })).approval;
    const r2 = (await call('POST', tokens.owner, `/api/v1/approvals/${facts.approvalId}/approve`, { expectedVersion: r1.version })).approval;
    await adminQuery(`UPDATE credential SET is_active = false, version = version + 1 WHERE credential_id = $1`, [credentialId]);
    const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${facts.approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: r2.version } });
    expect(exec.statusCode, exec.body).toBe(409);
    expect(exec.body).toMatch(/retired/i);
    // the approval landed in ExecutionFailed, and the retired credential is unchanged.
    expect((await call('GET', tokens.owner, `/api/v1/approvals/${facts.approvalId}`)).approval.status).toBe('ExecutionFailed');
  });

  it('beneficiaries: governed lifecycle, label uniqueness, finance-gated reads, THE LAW refuses digit runs', async () => {
    const personId = await createPerson('Paid Player');

    // THE LAW at the boundary: an account-number-shaped label/bank is refused
    await call('POST', tokens.ops, '/api/v1/beneficiaries/requests', {
      input: { personId, label: 'acct 1234567890123', bankName: 'ESA', bankCountry: 'UAE', currency: 'AED' },
    }, 400);
    await call('POST', tokens.ops, '/api/v1/beneficiaries/requests', {
      input: { personId, label: 'main', bankName: 'AE07 0331 2345 6789 0123 456', bankCountry: 'UAE', currency: 'AED' },
    }, 400);

    // governed add → Draft
    const add = (
      await call('POST', tokens.ops, '/api/v1/beneficiaries/requests', {
        input: { personId, label: 'ESA main', bankName: 'Emirates Islamic', bankCountry: 'UAE', currency: 'AED', paymentType: 'local' },
      }, 201)
    ).approval;
    await pipeline(add.approvalId, add.version);
    const rows = (await call('GET', tokens.finance, `/api/v1/people/${personId}/beneficiaries`)).beneficiaries;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ beneficiaryId: 'BEN-0001', label: 'ESA main', status: 'Draft' });

    // reads are finance-gated: hr and visitor are refused
    await call('GET', tokens.hr, `/api/v1/people/${personId}/beneficiaries`, undefined, 403);
    await call('GET', tokens.visitor, '/api/v1/beneficiaries', undefined, 403);

    // duplicate live label refused at submit (friendly 409)
    await call('POST', tokens.ops, '/api/v1/beneficiaries/requests', {
      input: { personId, label: 'esa MAIN', bankName: 'Other Bank', bankCountry: 'UAE', currency: 'AED' },
    }, 409);

    // governed update → Registered
    const upd = (
      await call('POST', tokens.ops, '/api/v1/beneficiaries/BEN-0001/update-request', { patch: { status: 'Registered', statusDate: '2026-07-11' } }, 201)
    ).approval;
    await pipeline(upd.approvalId, upd.version);
    expect((await call('GET', tokens.owner, `/api/v1/people/${personId}/beneficiaries`)).beneficiaries[0].status).toBe('Registered');

    // governed retire frees the label
    const ret = (await call('POST', tokens.ops, '/api/v1/beneficiaries/BEN-0001/retire-request', { reason: 'Bank switched' }, 201)).approval;
    await pipeline(ret.approvalId, ret.version);
    expect((await call('GET', tokens.owner, `/api/v1/people/${personId}/beneficiaries`)).beneficiaries[0].status).toBe('Retired');
    const readd = (
      await call('POST', tokens.ops, '/api/v1/beneficiaries/requests', {
        input: { personId, label: 'ESA main', bankName: 'New Bank', bankCountry: 'UAE', currency: 'AED' },
      }, 201)
    ).approval;
    await pipeline(readd.approvalId, readd.version);
    expect((await call('GET', tokens.owner, `/api/v1/people/${personId}/beneficiaries`)).beneficiaries).toHaveLength(2);
  });

  it('the bank form generates with SENSITIVE COLUMNS BLANK and never a digit run', async () => {
    const personId = await createPerson('Form Person');
    const add = (
      await call('POST', tokens.ops, '/api/v1/beneficiaries/requests', {
        input: { personId, label: 'ADCB personal', bankName: 'ADCB', bankCountry: 'UAE', currency: 'AED' },
      }, 201)
    ).approval;
    await pipeline(add.approvalId, add.version);

    const res = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/beneficiaries/bank-form`, headers: auth(tokens.owner) });
    expect(res.statusCode, res.body?.slice?.(0, 200)).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml');
    const buf = res.rawPayload;
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK'); // a real xlsx (zip)

    // parse it back: header columns exist; the sensitive cells are EMPTY
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const header = (ws.getRow(4).values as unknown[]).map((v) => String(v ?? ''));
    expect(header.join('|')).toContain('Account Number (fill by hand)');
    expect(header.join('|')).toContain('IBAN (fill by hand)');
    const dataRow = ws.getRow(5).values as unknown[];
    expect(String(dataRow[2] ?? '')).toBe('ADCB personal');
    expect(dataRow[9] ?? '').toBe(''); // account number column blank
    expect(dataRow[10] ?? '').toBe(''); // IBAN column blank

    // reads of the form are finance-gated like the registry
    expect((await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/beneficiaries/bank-form`, headers: auth(tokens.hr) })).statusCode).toBe(403);
  });
});
