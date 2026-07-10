/**
 * documents.test.ts (api) — S4 over HTTP with the fs storage driver. Covers the
 * full evidence lifecycle: multipart upload → metadata + server-side SHA-256 →
 * list → byte-identical download with honest headers → soft remove (list empty,
 * content unreachable) — plus the type allowlist (415), the empty-file 400, the
 * OWNING record's read gate (agreement docs: legal may read, visitor may not),
 * the owner/ops write gate, upload-to-missing-owner compensation (no orphan
 * blob), and tenant isolation.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
let blobDir: string;

const tokens = {} as { ops: string; owner: string; legal: string; visitor: string; ownerB: string };

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

/** Multipart upload via light-my-request's FormData support (undici types). */
async function uploadDoc(token: string, ownerType: string, ownerId: string, fileName: string, contentType: string, bytes: Buffer) {
  const form = new FormData();
  form.append('ownerType', ownerType);
  form.append('ownerId', ownerId);
  form.append('file', new Blob([bytes], { type: contentType }), fileName);
  return app.inject({ method: 'POST', url: '/api/v1/documents', headers: auth(token), body: form as never });
}

/** Count blobs on disk (compensation evidence). */
function blobCount(): number {
  const walk = (dir: string): number => {
    let n = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) n += walk(join(dir, entry.name));
      else n += 1;
    }
    return n;
  };
  try {
    return walk(blobDir);
  } catch {
    return 0;
  }
}

beforeAll(async () => {
  db = await startTestDatabase();
  blobDir = mkdtempSync(join(tmpdir(), 'c3-docs-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'documents-test-secret-0123456789',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: blobDir,
  } as NodeJS.ProcessEnv);
  expect(env.documents.driver).toBe('fs');
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
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

describe('documents over HTTP (S4)', () => {
  it('upload → list → byte-identical download → soft remove; gates and compensation hold', async () => {
    // An agreement to hang the paper on (governed create).
    const personSub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName: 'Doc Owner' } } });
    const personId = (await governedExecute(personSub.json().approval.approvalId, personSub.json().approval.version)).person.personId as string;
    const agrSub = await app.inject({
      method: 'POST',
      url: '/api/v1/agreements/requests',
      headers: auth(tokens.ops),
      payload: { input: { personId, agreementType: 'Player Contract', startsOn: '2026-08-01', endsOn: '2027-07-31' } },
    });
    await governedExecute(agrSub.json().approval.approvalId, agrSub.json().approval.version);

    // Upload a small "PDF" (bytes are bytes; the type gate is the content-type).
    const bytes = Buffer.from('%PDF-1.4\n%c3 evidence\n%%EOF\n');
    const up = await uploadDoc(tokens.ops, 'Agreement', 'AGR-0001', 'contract.pdf', 'application/pdf', bytes);
    expect(up.statusCode, up.body).toBe(201);
    const doc = up.json().document;
    expect(doc).toMatchObject({
      documentId: 'DOC-0001',
      ownerType: 'Agreement',
      ownerId: 'AGR-0001',
      fileName: 'contract.pdf',
      contentType: 'application/pdf',
      sizeBytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      uploadedBy: 'ops@alpha.com',
    });
    expect(JSON.stringify(doc)).not.toContain('storageKey'); // the key never leaves the server

    // The audit landed on the OWNER record's trail.
    const audit = await app.inject({ method: 'GET', url: '/api/v1/agreements/AGR-0001/audit', headers: auth(tokens.owner) });
    expect(audit.json().events.some((e: { action: string }) => e.action === 'DocumentAttached')).toBe(true);

    // List + download (byte-identical, honest headers).
    const list = await app.inject({ method: 'GET', url: '/api/v1/documents?ownerType=Agreement&ownerId=AGR-0001', headers: auth(tokens.owner) });
    expect(list.json().documents).toHaveLength(1);
    const dl = await app.inject({ method: 'GET', url: '/api/v1/documents/DOC-0001/content', headers: auth(tokens.owner) });
    expect(dl.statusCode).toBe(200);
    expect(dl.headers['content-type']).toBe('application/pdf');
    expect(dl.headers['content-disposition']).toContain('contract.pdf');
    expect(Buffer.compare(dl.rawPayload, bytes)).toBe(0);

    // The OWNING record's read gate: legal reads agreement paper; visitor does not.
    const legalList = await app.inject({ method: 'GET', url: '/api/v1/documents?ownerType=Agreement&ownerId=AGR-0001', headers: auth(tokens.legal) });
    expect(legalList.statusCode).toBe(200);
    const legalDl = await app.inject({ method: 'GET', url: '/api/v1/documents/DOC-0001/content', headers: auth(tokens.legal) });
    expect(legalDl.statusCode).toBe(200);
    for (const denied of [
      await app.inject({ method: 'GET', url: '/api/v1/documents?ownerType=Agreement&ownerId=AGR-0001', headers: auth(tokens.visitor) }),
      await app.inject({ method: 'GET', url: '/api/v1/documents/DOC-0001/content', headers: auth(tokens.visitor) }),
    ]) {
      expect(denied.statusCode).toBe(403);
    }
    // Write gate: legal/visitor cannot attach.
    expect((await uploadDoc(tokens.legal, 'Agreement', 'AGR-0001', 'x.pdf', 'application/pdf', bytes)).statusCode).toBe(403);
    expect((await uploadDoc(tokens.visitor, 'Agreement', 'AGR-0001', 'x.pdf', 'application/pdf', bytes)).statusCode).toBe(403);

    // Tenant isolation: bravo reaches nothing.
    expect((await app.inject({ method: 'GET', url: '/api/v1/documents/DOC-0001/content', headers: auth(tokens.ownerB) })).statusCode).toBe(404);

    // Type allowlist and the empty-file refusal.
    expect((await uploadDoc(tokens.ops, 'Agreement', 'AGR-0001', 'x.exe', 'application/x-msdownload', bytes)).statusCode).toBe(415);
    expect((await uploadDoc(tokens.ops, 'Agreement', 'AGR-0001', 'empty.pdf', 'application/pdf', Buffer.alloc(0))).statusCode).toBe(400);

    // Upload to a missing owner: refused AND the blob is compensated away.
    const before = blobCount();
    const orphan = await uploadDoc(tokens.ops, 'Mission', 'MSN-9999', 'x.pdf', 'application/pdf', bytes);
    expect(orphan.statusCode).toBe(404);
    expect(blobCount()).toBe(before); // no orphan bytes left behind

    // Soft remove: list empties, content 404s, audit records the removal.
    const rm = await app.inject({ method: 'POST', url: '/api/v1/documents/DOC-0001/remove', headers: auth(tokens.ops), payload: { expectedVersion: 0 } });
    expect(rm.statusCode, rm.body).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/api/v1/documents?ownerType=Agreement&ownerId=AGR-0001', headers: auth(tokens.owner) });
    expect(after.json().documents).toHaveLength(0);
    expect((await app.inject({ method: 'GET', url: '/api/v1/documents/DOC-0001/content', headers: auth(tokens.owner) })).statusCode).toBe(404);
    const audit2 = await app.inject({ method: 'GET', url: '/api/v1/agreements/AGR-0001/audit', headers: auth(tokens.owner) });
    expect(audit2.json().events.some((e: { action: string }) => e.action === 'DocumentRemoved')).toBe(true);
  });
});
