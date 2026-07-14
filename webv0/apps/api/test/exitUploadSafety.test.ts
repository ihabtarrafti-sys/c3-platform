/**
 * HARDEN-3.6 composed exit/upload killers.
 *
 * T2 models the storage contract's worst legal outcome: the local PUT rejects on deadline
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
const objects = new Map<string, Buffer>();

let delayRemoteCommit = false;
let latePublication: Promise<void> = Promise.resolve();
let resolveLatePublication: () => void = () => {};
let latePublishedAt = 0;
let finalizeObserved: Promise<void> = Promise.resolve();
let markFinalizeObserved: () => void = () => {};

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
  async delete(key) {
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
}, 180_000);

afterAll(async () => {
  markFinalizeObserved();
  await latePublication.catch(() => {});
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
