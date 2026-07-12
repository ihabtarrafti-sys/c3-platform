/**
 * personPhoto.test.ts (api) — the person headshot over HTTP with the fs storage
 * driver (Track B). Covers the lifecycle: no-photo → ops upload (image only,
 * magic-byte checked) → byte-identical serve under the baseline people read
 * (a read-only role sees the face) → replace → remove — plus the write gate
 * (read-only cannot set/clear), the image-only allowlist (415), mislabeled
 * bytes (415), upload-to-missing-person compensation (no orphan blob), tenant
 * isolation, and the served-bytes integrity check (502 on tamper). The audit
 * lands on the person trail (PersonPhotoUpdated / PersonPhotoRemoved).
 */
import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

const tokens = {} as { ops: string; owner: string; visitor: string; ownerB: string };

// Valid magic-byte bodies (documentBytesMatchDeclaredType checks the signature).
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5]);
const WEBP = Buffer.concat([Buffer.from([0x52, 0x49, 0x46, 0x46]), Buffer.from([0, 0, 0, 0]), Buffer.from([0x57, 0x45, 0x42, 0x50]), Buffer.from([9, 9, 9])]);

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

async function addPerson(fullName: string): Promise<string> {
  const sub = await app.inject({ method: 'POST', url: '/api/v1/approvals', headers: auth(tokens.ops), payload: { input: { fullName } } });
  return (await governedExecute(sub.json().approval.approvalId, sub.json().approval.version)).person.personId as string;
}

function uploadPhoto(token: string, personId: string, fileName: string, contentType: string, bytes: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), fileName);
  return app.inject({ method: 'POST', url: `/api/v1/people/${personId}/photo`, headers: auth(token), body: form as never });
}

function blobCount(): number {
  const walk = (dir: string): number => {
    let n = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) n += entry.isDirectory() ? walk(join(dir, entry.name)) : 1;
    return n;
  };
  try {
    return walk(blobDir);
  } catch {
    return 0;
  }
}

function newestBlobPath(): string {
  let newest: { path: string; mtime: number } | null = null;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else {
        const m = statSync(p).mtimeMs;
        if (!newest || m > newest.mtime) newest = { path: p, mtime: m };
      }
    }
  };
  walk(blobDir);
  if (!newest) throw new Error('no blobs on disk');
  return (newest as { path: string }).path;
}

beforeAll(async () => {
  db = await startTestDatabase();
  blobDir = mkdtempSync(join(tmpdir(), 'c3-photo-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'person-photo-test-secret-0123456789',
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
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
});

describe('person photo over HTTP (Track B)', () => {
  it('set → serve (any people-reader) → replace → remove; gates, audit, compensation, tenant isolation', async () => {
    const personId = await addPerson('Photo Subject');

    // No photo yet: the DTO carries a null pointer and the serve route 404s.
    const before = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}`, headers: auth(tokens.owner) });
    expect(before.json().person.photoUpdatedAt).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/photo`, headers: auth(tokens.owner) })).statusCode).toBe(404);

    // Ops upload a real PNG.
    const up = await uploadPhoto(tokens.ops, personId, 'headshot.png', 'image/png', PNG);
    expect(up.statusCode, up.body).toBe(200);
    expect(up.json().person.photoUpdatedAt).not.toBeNull();
    expect(JSON.stringify(up.json().person)).not.toContain('photoStorageKey'); // the key never leaves the server

    // Audit landed on the PERSON trail.
    const audit = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/audit`, headers: auth(tokens.owner) });
    expect(audit.json().events.some((e: { action: string }) => e.action === 'PersonPhotoUpdated')).toBe(true);

    // Serve: byte-identical, image content-type — and a READ-ONLY role (visitor)
    // may view it (a face is the baseline people read, not the PII tier).
    const dl = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/photo`, headers: auth(tokens.visitor) });
    expect(dl.statusCode, dl.body).toBe(200);
    expect(dl.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(dl.rawPayload, PNG)).toBe(0);

    // Write gate: a read-only role cannot set or clear.
    expect((await uploadPhoto(tokens.visitor, personId, 'x.png', 'image/png', PNG)).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: `/api/v1/people/${personId}/photo/remove`, headers: auth(tokens.visitor) })).statusCode).toBe(403);

    // Image-only allowlist (a PDF is a valid document but not a photo) + the
    // mislabeled-bytes refusal (png label, non-png body) + empty file.
    expect((await uploadPhoto(tokens.ops, personId, 'doc.pdf', 'application/pdf', Buffer.from('%PDF-1.4\n%%EOF\n'))).statusCode).toBe(415);
    expect((await uploadPhoto(tokens.ops, personId, 'fake.png', 'image/png', Buffer.from('not a png'))).statusCode).toBe(415);
    expect((await uploadPhoto(tokens.ops, personId, 'empty.png', 'image/png', Buffer.alloc(0))).statusCode).toBe(400);

    // Replace with a WEBP — the pointer swaps, the served bytes change.
    const replace = await uploadPhoto(tokens.ops, personId, 'new.webp', 'image/webp', WEBP);
    expect(replace.statusCode, replace.body).toBe(200);
    const dl2 = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/photo`, headers: auth(tokens.owner) });
    expect(dl2.headers['content-type']).toBe('image/webp');
    expect(Buffer.compare(dl2.rawPayload, WEBP)).toBe(0);

    // Upload to a missing person: refused AND no orphan blob left behind.
    const blobsBefore = blobCount();
    expect((await uploadPhoto(tokens.ops, 'PER-9999', 'x.png', 'image/png', PNG)).statusCode).toBe(404);
    expect(blobCount()).toBe(blobsBefore);

    // Tenant isolation: bravo's owner reaches nothing.
    expect((await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/photo`, headers: auth(tokens.ownerB) })).statusCode).toBe(404);
    expect((await uploadPhoto(tokens.ownerB, personId, 'x.png', 'image/png', PNG)).statusCode).toBe(404);

    // Remove: the pointer clears, the serve route 404s, the audit records it.
    const rm = await app.inject({ method: 'POST', url: `/api/v1/people/${personId}/photo/remove`, headers: auth(tokens.ops) });
    expect(rm.statusCode, rm.body).toBe(200);
    expect(rm.json().person.photoUpdatedAt).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/photo`, headers: auth(tokens.owner) })).statusCode).toBe(404);
    const audit2 = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/audit`, headers: auth(tokens.owner) });
    expect(audit2.json().events.some((e: { action: string }) => e.action === 'PersonPhotoRemoved')).toBe(true);
  });

  it('integrity: altered object-store bytes are never served (502)', async () => {
    const personId = await addPerson('Tamper Target');
    expect((await uploadPhoto(tokens.ops, personId, 'p.png', 'image/png', PNG)).statusCode).toBe(200);
    writeFileSync(newestBlobPath(), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9])); // still a PNG, different bytes
    const tampered = await app.inject({ method: 'GET', url: `/api/v1/people/${personId}/photo`, headers: auth(tokens.owner) });
    expect(tampered.statusCode).toBe(502);
    expect(tampered.json().error.code).toBe('INTEGRITY');
  });
});
