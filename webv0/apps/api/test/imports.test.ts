/**
 * imports.test.ts (api) — S5 over HTTP: the locked design end to end.
 * Template download → staged import (ONE ImportBatch approval) → owner
 * executes → rows exist with per-row audit naming the batch. Plus: the
 * ALL-OR-NOTHING 422 with the per-row report (and NOTHING staged), the
 * DB-aware cross-checks (credentials need existing people), the write gates,
 * and the export → template header identity (export IS the template).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { PEOPLE_COLUMNS, toCsv } from '@c3web/domain';
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

async function stage(token: string, domain: string, fileName: string, csv: string) {
  const form = new FormData();
  form.append('domain', domain);
  form.append('file', new Blob([csv], { type: 'text/csv' }), fileName);
  return app.inject({ method: 'POST', url: '/api/v1/imports', headers: auth(token), body: form as never });
}

async function governedExecute(approvalId: string, version: number) {
  const rev = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/begin-review`, headers: auth(tokens.owner), payload: { expectedVersion: version } });
  expect(rev.statusCode, rev.body).toBe(200);
  const appr = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/approve`, headers: auth(tokens.owner), payload: { expectedVersion: rev.json().approval.version } });
  expect(appr.statusCode, appr.body).toBe(200);
  const exec = await app.inject({ method: 'POST', url: `/api/v1/approvals/${approvalId}/execute`, headers: auth(tokens.owner), payload: { expectedVersion: appr.json().approval.version } });
  expect(exec.statusCode, exec.body).toBe(200);
  return exec.json();
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'imports-test-secret-0123456789xy',
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

describe('import/export over HTTP (S5)', () => {
  it('template → staged batch → owner executes → rows + per-row audit; 422 report; gates; export IS the template', async () => {
    // The blank template carries exactly the canonical headers.
    const tpl = await app.inject({ method: 'GET', url: '/api/v1/imports/templates/people', headers: auth(tokens.ops) });
    expect(tpl.statusCode).toBe(200);
    expect(tpl.headers['content-type']).toContain('text/csv');
    expect(tpl.body.trim()).toBe(PEOPLE_COLUMNS.join(','));

    // Stage a clean 2-person file — ONE approval, nothing landed yet.
    const cleanCsv = toCsv(PEOPLE_COLUMNS, [
      ['', 'Jordan Reyes', 'JREY', 'PH', 'Player', 'R6/PL/007', 'R6', 'Rainbow Six', '', '', '', 'true'],
      ['', 'Dana Cole', '', '', 'Manager', '', '', '', 'Operations', '', '', 'false'],
    ]);
    const staged = await stage(tokens.ops, 'people', 'geekay-people.csv', cleanCsv);
    expect(staged.statusCode, staged.body).toBe(201);
    expect(staged.json()).toMatchObject({ domain: 'people', rowCount: 2 });
    expect(staged.json().approval.operationType).toBe('ImportBatch');
    const before = await app.inject({ method: 'GET', url: '/api/v1/people', headers: auth(tokens.owner) });
    expect(before.json().people).toHaveLength(0); // staged ≠ landed

    // The owner executes the batch — both rows land atomically, audit names the batch.
    await governedExecute(staged.json().approval.approvalId, staged.json().approval.version);
    const after = await app.inject({ method: 'GET', url: '/api/v1/people', headers: auth(tokens.owner) });
    expect(after.json().people).toHaveLength(2);
    expect(after.json().people.map((p: { fullName: string }) => p.fullName).sort()).toEqual(['Dana Cole', 'Jordan Reyes']);
    expect(after.json().people.find((p: { fullName: string }) => p.fullName === 'Dana Cole').isActive).toBe(false); // history imports
    const audit = await app.inject({ method: 'GET', url: '/api/v1/people/PER-0001/audit', headers: auth(tokens.owner) });
    expect(JSON.stringify(audit.json())).toContain('importedBy');

    // ALL-OR-NOTHING: a file with one bad row 422s with the per-row report and stages NOTHING.
    const dirtyCsv = toCsv(PEOPLE_COLUMNS, [
      ['PER-9999', 'Filled Id', '', '', '', '', '', '', '', '', '', ''],
      ['', '', '', '', '', '', '', '', '', '', '', 'maybe'],
    ]);
    const dirty = await stage(tokens.ops, 'people', 'bad.csv', dirtyCsv);
    expect(dirty.statusCode).toBe(422);
    expect(dirty.json().error.code).toBe('IMPORT_INVALID');
    const rows = dirty.json().error.details.rows as Array<{ row: number; column: string }>;
    expect(rows.some((r) => r.column === 'personId')).toBe(true);
    expect(rows.some((r) => r.column === 'fullName')).toBe(true);
    const approvals = await app.inject({ method: 'GET', url: '/api/v1/approvals', headers: auth(tokens.owner) });
    expect(approvals.json().approvals.filter((a: { operationType: string }) => a.operationType === 'ImportBatch')).toHaveLength(1); // only the clean one

    // DB-aware cross-check: credentials for a person who doesn't exist.
    const credCsv = ['credentialId,personId,credentialType,issuer,issuedOn,expiresOn,notes,isActive', ',PER-0404,Visa,,2026-01-01,2027-01-01,,true'].join('\n') + '\n';
    const cred = await stage(tokens.ops, 'credentials', 'creds.csv', credCsv);
    expect(cred.statusCode).toBe(422);
    expect(JSON.stringify(cred.json().error.details.rows)).toContain('import people first');

    // …and a valid one against the imported person lands after execution.
    const credOk = await stage(tokens.ops, 'credentials', 'creds.csv', credCsv.replace('PER-0404', 'PER-0001'));
    expect(credOk.statusCode, credOk.body).toBe(201);
    await governedExecute(credOk.json().approval.approvalId, credOk.json().approval.version);
    const creds = await app.inject({ method: 'GET', url: '/api/v1/credentials', headers: auth(tokens.owner) });
    expect(creds.json().credentials).toHaveLength(1);

    // Gates: a visitor may neither stage nor export; export needs owner/ops.
    expect((await stage(tokens.visitor, 'people', 'x.csv', cleanCsv)).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/exports/people', headers: auth(tokens.visitor) })).statusCode).toBe(403);

    // Export IS the template: same header row, and the imported rows are in it.
    const exp = await app.inject({ method: 'GET', url: '/api/v1/exports/people', headers: auth(tokens.ops) });
    expect(exp.statusCode).toBe(200);
    expect(exp.body.split('\n')[0]).toBe(PEOPLE_COLUMNS.join(','));
    expect(exp.body).toContain('Jordan Reyes');
    expect(exp.body).toContain('PER-0001');

    // The audit trail exports alongside.
    const auditExp = await app.inject({ method: 'GET', url: '/api/v1/exports/audit', headers: auth(tokens.owner) });
    expect(auditExp.statusCode).toBe(200);
    expect(auditExp.body.split('\n')[0]).toBe('at,entityType,entityId,action,actor,before,after');
    expect(auditExp.body).toContain('PersonCreated');

    // ── S5 riders: the data-quality report sees what import let through ──────
    // A whitespace/case variant of Jordan sails through import (names are not
    // hard keys — deliberately) and surfaces as a POTENTIAL DUPLICATE here.
    const dupCsv = toCsv(PEOPLE_COLUMNS, [['', '  jordan   REYES ', '', '', '', '', '', '', '', '', '', 'true']]);
    const dupStaged = await stage(tokens.ops, 'people', 'second-jordan.csv', dupCsv);
    expect(dupStaged.statusCode, dupStaged.body).toBe(201);
    await governedExecute(dupStaged.json().approval.approvalId, dupStaged.json().approval.version);

    const dq = await app.inject({ method: 'GET', url: '/api/v1/data-quality', headers: auth(tokens.ops) });
    expect(dq.statusCode, dq.body).toBe(200);
    const report = dq.json().report;
    const nameGroup = report.duplicatePeople.find((g: { reason: string }) => g.reason === 'fullName');
    expect(nameGroup, JSON.stringify(report.duplicatePeople)).toBeTruthy();
    expect(nameGroup.people.map((p: { personId: string }) => p.personId)).toContain('PER-0001');
    expect(nameGroup.people.map((p: { personId: string }) => p.personId)).toContain('PER-0003');
    // The variant row has no nationality/role/code — the review lists name it.
    expect(report.peopleMissingNationality.map((p: { personId: string }) => p.personId)).toContain('PER-0003');
    // Dana Cole is INACTIVE history — the report does not nag about her basics.
    expect(report.peopleMissingNationality.map((p: { personId: string }) => p.personId)).not.toContain('PER-0002');
    // Pure read, gated like the rest of the stewardship tooling.
    expect((await app.inject({ method: 'GET', url: '/api/v1/data-quality', headers: auth(tokens.visitor) })).statusCode).toBe(403);
  });
});
