/**
 * HARDEN-3.6 composed exit/upload killers.
 *
 * T1 composes a real staff-document request with exit sweep/finalize. T2 models the storage
 * contract's worst legal outcome: the local PUT rejects on deadline
 * abort, its immediate cleanup sees no object, and the remote store publishes later. The same
 * test runs the real lease drain, erasure sweep, and finalize ceremony.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';
import type { DocumentStorage } from '../src/storage';
import { exitTenant, finalizeTenantExit } from '../../../packages/persistence/src/exitTenant';
import { sweepTenantBlobErasure, type BlobReader } from '../../../packages/persistence/src/blobBundle';

const PDF = Buffer.from('%PDF-1.4\n%c3 delayed remote commit\n%%EOF\n');

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;
let t1App: FastifyInstance;
const objects = new Map<string, Buffer>();

let delayRemoteCommit = false;
let latePublication: Promise<void> = Promise.resolve();
let resolveLatePublication: () => void = () => {};
let latePublishedAt = 0;
let finalizeObserved: Promise<void> = Promise.resolve();
let markFinalizeObserved: () => void = () => {};
let stallStaffPut = false;
let staffPutStarted: Promise<string> = Promise.resolve('');
let markStaffPutStarted: (key: string) => void = () => {};
let resumeStaffPut: () => void = () => {};

function armStaffStall(): void {
  stallStaffPut = true;
  staffPutStarted = new Promise<string>((resolve) => { markStaffPutStarted = resolve; });
}

function armIndeterminateCommit(): void {
  delayRemoteCommit = true;
  latePublishedAt = 0;
  latePublication = new Promise<void>((resolveLate) => {
    resolveLatePublication = resolveLate;
    finalizeObserved = new Promise<void>((resolveFinalize) => {
      markFinalizeObserved = resolveFinalize;
    });
  });
}

const storage: DocumentStorage = {
  driver: 'fs',
  async put(key, body, _contentType, opts) {
    if (stallStaffPut) {
      stallStaffPut = false;
      markStaffPutStarted(key);
      await new Promise<void>((resolve) => { resumeStaffPut = resolve; });
      objects.set(key, Buffer.from(body));
      return;
    }
    if (!delayRemoteCommit) {
      objects.set(key, Buffer.from(body));
      return;
    }
    delayRemoteCommit = false; // exactly one indeterminate PUT in the composed schedule
    await new Promise<void>((_resolve, reject) => {
      const abort = () => {
        const reason = opts?.signal?.reason;
        reject(reason instanceof Error ? reason : new Error('deadline aborted the local PUT'));

        // Adversarial remote scheduler: normally publish after a real delay. If an unsafe
        // implementation finalizes first, publish immediately afterwards so the RED run
        // deterministically observes the stranded-byte outcome instead of relying on CPU speed.
        void Promise.race([
          new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
          finalizeObserved,
        ]).then(() => {
          objects.set(key, Buffer.from(body));
          latePublishedAt = Date.now();
          resolveLatePublication();
        });
      };
      if (opts?.signal?.aborted) abort();
      else opts?.signal?.addEventListener('abort', abort, { once: true });
    });
  },
  async get(key) {
    const value = objects.get(key);
    return value ? Buffer.from(value) : null;
  },
  async delete(key, opts) {
    if (!opts?.signal || opts.signal.aborted) {
      throw opts?.signal?.reason instanceof Error ? opts.signal.reason : new Error('cleanup requires a live signal');
    }
    objects.delete(key);
  },
};

const reader: BlobReader = {
  driver: 'fs',
  async get(key) {
    const value = objects.get(key);
    return value ? Buffer.from(value) : null;
  },
  async listKeys(prefix) {
    return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
  },
  async deleteKey(key) {
    objects.delete(key);
  },
  close() {},
};

async function withAdmin<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: db.adminUrl });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function stageGuest(slug: string): Promise<{ tenantId: string; token: string }> {
  const seeded = await db.seedTenant({
    slug,
    users: [{ key: 'ops', email: `ops@${slug}.test`, displayName: 'Ops', role: 'operations' }],
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/dev/login',
    payload: { email: `ops@${slug}.test`, displayName: 'Ops', role: 'operations', tenantSlug: slug },
  });
  expect(login.statusCode, login.body).toBe(200);
  const link = await app.inject({
    method: 'POST',
    url: '/api/v1/intake/links',
    headers: { authorization: `Bearer ${login.json().token as string}` },
    payload: { kind: 'Onboarding', label: 'T2 delayed commit' },
  });
  expect(link.statusCode, link.body).toBe(201);
  return { tenantId: seeded.tenantId, token: link.json().token as string };
}

async function stageStaff(slug: string): Promise<{ tenantId: string; opsToken: string; personId: string }> {
  const seeded = await db.seedTenant({
    slug,
    users: [
      { key: 'ops', email: `ops@${slug}.test`, displayName: 'Ops', role: 'operations' },
      { key: 'owner', email: `owner@${slug}.test`, displayName: 'Owner', role: 'owner' },
    ],
  });
  const login = async (email: string, role: string) => {
    const response = await t1App.inject({
      method: 'POST', url: '/api/v1/dev/login',
      payload: { email, displayName: role, role, tenantSlug: slug },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().token as string;
  };
  const opsToken = await login(`ops@${slug}.test`, 'operations');
  const ownerToken = await login(`owner@${slug}.test`, 'owner');
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const submitted = await t1App.inject({
    method: 'POST', url: '/api/v1/approvals', headers: auth(opsToken),
    payload: { input: { fullName: 'T1 Live Producer' } },
  });
  expect(submitted.statusCode, submitted.body).toBe(201);
  const approval = submitted.json().approval;
  const reviewed = await t1App.inject({
    method: 'POST', url: `/api/v1/approvals/${approval.approvalId}/begin-review`, headers: auth(ownerToken),
    payload: { expectedVersion: approval.version },
  });
  expect(reviewed.statusCode, reviewed.body).toBe(200);
  const approved = await t1App.inject({
    method: 'POST', url: `/api/v1/approvals/${approval.approvalId}/approve`, headers: auth(ownerToken),
    payload: { expectedVersion: reviewed.json().approval.version },
  });
  expect(approved.statusCode, approved.body).toBe(200);
  const executed = await t1App.inject({
    method: 'POST', url: `/api/v1/approvals/${approval.approvalId}/execute`, headers: auth(ownerToken),
    payload: { expectedVersion: approved.json().approval.version },
  });
  expect(executed.statusCode, executed.body).toBe(200);
  return { tenantId: seeded.tenantId, opsToken, personId: executed.json().person.personId as string };
}

function staffDocumentForm(personId: string): FormData {
  const form = new FormData();
  form.append('ownerType', 'Person');
  form.append('ownerId', personId);
  form.append('file', new Blob([PDF], { type: 'application/pdf' }), 't1.pdf');
  return form;
}

function guestForm(withFile: boolean): FormData {
  const form = new FormData();
  form.append('payload', JSON.stringify({ fullName: 'Delayed Commit', email: 'delayed@example.test' }));
  if (withFile) form.append('file', new Blob([PDF], { type: 'application/pdf' }), 'delayed.pdf');
  return form;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'exit-upload-safety-test-secret-0000',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'c3-exit-upload-')),
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  // Short deadline, deliberately longer lease: the fake remote commit lands after local abort
  // but before the 6s publication fence expires.
  app = buildApp({
    ...deps,
    documentStorage: storage,
    requestTimeoutMs: 250,
    deadlineMs: 500,
    leaseTtlMs: 6_000,
  });
  await app.ready();
  t1App = buildApp({
    ...deps,
    documentStorage: storage,
    requestTimeoutMs: 1_000,
    deadlineMs: 3_000,
    leaseTtlMs: 6_000,
  });
  await t1App.ready();
}, 180_000);

afterAll(async () => {
  markFinalizeObserved();
  await latePublication.catch(() => {});
  resumeStaffPut();
  await t1App?.close();
  await app?.close();
  await deps?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  objects.clear();
  delayRemoteCommit = false;
  latePublication = Promise.resolve();
  resolveLatePublication = () => {};
  latePublishedAt = 0;
  finalizeObserved = Promise.resolve();
  markFinalizeObserved = () => {};
  stallStaffPut = false;
  staffPutStarted = Promise.resolve('');
  markStaffPutStarted = () => {};
  resumeStaffPut = () => {};
});

describe('HARDEN-3.6 T1 — exit never consumes an unexpired staff producer', () => {
  it('parks sweep while live; post-expiry sweep/finalize wins and the resumed real route is refused with no byte or row', async () => {
    const { tenantId, opsToken, personId } = await stageStaff('t1staff');
    armStaffStall();
    const routePromise = t1App.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { authorization: `Bearer ${opsToken}` },
      body: staffDocumentForm(personId) as never,
    });
    const storageKey = await staffPutStarted;
    const [intent] = await db.adminQuery<{ state: string; prepared_expires_at: Date }>(
      `SELECT state, prepared_expires_at FROM blob_tombstone
        WHERE tenant_ref=$1 AND storage_key=$2 AND reason='compensation'`,
      [tenantId, storageKey],
    );
    expect(intent?.state).toBe('prepared');

    await db.adminQuery(
      `UPDATE app_user SET is_active=false
        WHERE id IN (SELECT user_id FROM tenant_membership WHERE tenant_id=$1)`,
      [tenantId],
    );
    await withAdmin((client) => exitTenant(client, {
      tenantSlug: 't1staff', execute: true, confirmSlug: 't1staff', secondConfirm: 't1staff',
      leaseDrainTimeoutMs: 1_000, leaseDrainPollMs: 25,
    }));

    await withAdmin(async (client) => {
      await expect(sweepTenantBlobErasure(client, reader, tenantId)).rejects.toThrow(/parked.*prepared upload intent/i);
    });
    expect((await db.adminQuery<{ state: string }>(
      `SELECT state FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`, [tenantId, storageKey],
    ))[0]?.state).toBe('prepared');

    const remainingMs = Math.max(0, new Date(intent!.prepared_expires_at).getTime() - Date.now());
    await new Promise((resolve) => setTimeout(resolve, remainingMs + 100));
    const ceremony = await withAdmin(async (client) => {
      const swept = await sweepTenantBlobErasure(client, reader, tenantId);
      const finalized = await finalizeTenantExit(client, tenantId, reader);
      return { swept, finalized };
    });
    expect(ceremony.finalized.removed).toBe(true);

    resumeStaffPut();
    const response = await routePromise;
    expect(response.statusCode, response.body).toBe(404);
    expect(response.json().error.code).toBe('NOT_FOUND'); // first real defense: document owner missing

    const remainingKeys = [
      ...(await reader.listKeys(`${tenantId}/`)),
      ...(await reader.listKeys(`intake/${tenantId}/`)),
    ];
    const [terminal] = await db.adminQuery<{ state: string; deleted_at: Date | null }>(
      `SELECT state, deleted_at FROM blob_tombstone WHERE tenant_ref=$1 AND storage_key=$2`,
      [tenantId, storageKey],
    );
    expect({
      registeredDocuments: Number((await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM document WHERE tenant_id=$1`, [tenantId]))[0]!.n),
      tenantRows: Number((await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM tenant WHERE id=$1`, [tenantId]))[0]!.n),
      remainingKeys,
      tombstoneState: terminal?.state,
      tombstoneStamped: terminal?.deleted_at !== null,
    }).toEqual({ registeredDocuments: 0, tenantRows: 0, remainingKeys: [], tombstoneState: 'swept', tombstoneStamped: true });
  }, 30_000);
});

describe('HARDEN-3.6 T2 — the lease outlives indeterminate remote completion', () => {
  it('retains the failed-upload lease; delayed publication lands before exit sweep and is erased before finalize', async () => {
    const { tenantId, token } = await stageGuest('t2delay');
    armIndeterminateCommit();

    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/intake/public/${token}`,
      body: guestForm(true) as never,
    });
    expect(response.statusCode, response.body).toBe(408);
    expect(response.json().error.code).toBe('REQUEST_DEADLINE_EXCEEDED');

    // Record rather than asserting early: the RED run must continue through sweep+finalize so
    // its delayed publication visibly strands a byte after identity removal.
    const failedLeaseCount = Number((await db.adminQuery<{ n: string }>(
      `SELECT count(*) AS n FROM intake_upload_lease WHERE tenant_id=$1 AND expires_at > now()`,
      [tenantId],
    ))[0]!.n);

    // Phase E1 for this disposable tenant: the already-authenticated request has finished, and
    // the only member is deactivated so the real exit data phase may begin.
    await db.adminQuery(
      `UPDATE app_user SET is_active=false
        WHERE id IN (SELECT user_id FROM tenant_membership WHERE tenant_id=$1)`,
      [tenantId],
    );

    const exitStartedAt = Date.now();
    const ceremony = await withAdmin(async (client) => {
      const data = await exitTenant(client, {
        tenantSlug: 't2delay',
        execute: true,
        confirmSlug: 't2delay',
        secondConfirm: 't2delay',
        leaseDrainTimeoutMs: 8_000,
        leaseDrainPollMs: 25,
      });
      const exitCompletedAt = Date.now();
      const swept = await sweepTenantBlobErasure(client, reader, tenantId);
      const finalized = await finalizeTenantExit(client, tenantId, reader);
      markFinalizeObserved();
      return { data, exitCompletedAt, swept, finalized };
    });

    await latePublication;
    const remainingKeys = [
      ...(await reader.listKeys(`${tenantId}/`)),
      ...(await reader.listKeys(`intake/${tenantId}/`)),
    ];
    const [tombstone] = await db.adminQuery<{ state: string; deleted_at: Date | null }>(
      `SELECT state, deleted_at FROM blob_tombstone WHERE tenant_ref=$1 AND reason='compensation'`,
      [tenantId],
    );
    const tenantRows = Number((await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM tenant WHERE id=$1`, [tenantId]))[0]!.n);

    expect({
      failedLeaseCount,
      exitWaitedForFence: ceremony.exitCompletedAt - exitStartedAt >= 4_500,
      publicationPrecededExitCompletion: latePublishedAt > 0 && latePublishedAt <= ceremony.exitCompletedAt,
      deletedDelayedObject: ceremony.swept.deletedObjects.length,
      prefixesEmpty: ceremony.swept.prefixesEmpty,
      tombstoneState: tombstone?.state,
      tombstoneStamped: tombstone?.deleted_at !== null,
      finalized: ceremony.finalized.removed,
      tenantRows,
      remainingKeys,
    }).toEqual({
      failedLeaseCount: 1,
      exitWaitedForFence: true,
      publicationPrecededExitCompletion: true,
      deletedDelayedObject: 1,
      prefixesEmpty: true,
      tombstoneState: 'swept',
      tombstoneStamped: true,
      finalized: true,
      tenantRows: 0,
      remainingKeys: [],
    });
  }, 20_000);

  it('releases the lease immediately after a successful committed claim', async () => {
    const { tenantId, token } = await stageGuest('t2success');
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/intake/public/${token}`,
      body: guestForm(false) as never,
    });
    expect(response.statusCode, response.body).toBe(201);
    const leases = Number((await db.adminQuery<{ n: string }>(
      `SELECT count(*) AS n FROM intake_upload_lease WHERE tenant_id=$1`,
      [tenantId],
    ))[0]!.n);
    expect(leases).toBe(0);
  });
});
