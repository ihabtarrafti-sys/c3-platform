import { createHash, randomUUID } from 'node:crypto';
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
import type { DocumentStorage } from '../src/storage';
import { createPersistence } from '../../../packages/persistence/src/stores';

const PDF = Buffer.from('%PDF-1.4\n%c3 U1 staff abort\n%%EOF\n');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=',
  'base64',
);

let db: TestDatabase;
let deps: Deps;
let normalApp: FastifyInstance;
let abortApp: FastifyInstance;
let tenantId: string;
let ownerToken: string;
let opsToken: string;
const personId = 'PER-9001';

let rejectNextPut = false;
let rejectedKey: string | null = null;

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function login(app: FastifyInstance, email: string, role: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/dev/login',
    payload: { email, displayName: email, role, tenantSlug: 'u1-staff' },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}

function armSignalAbortPut(): void {
  expect(rejectNextPut, 'previous rejection seam was not consumed').toBe(false);
  rejectNextPut = true;
  rejectedKey = null;
}

async function assertedRejectedKey(): Promise<string> {
  expect(rejectNextPut, 'target route never reached its storage PUT').toBe(false);
  expect(rejectedKey).toBeTruthy();
  return rejectedKey!;
}

async function assertArmedThenDrain(key: string): Promise<void> {
  const before = await db.adminQuery<{ state: string; deleted_at: Date | null }>(
    `SELECT state, deleted_at FROM blob_tombstone
      WHERE tenant_ref=$1 AND storage_key=$2 AND reason='compensation'`,
    [tenantId, key],
  );
  // RED at every old site: a PUT rejection outside the catch leaves this row `prepared`.
  expect(before).toEqual([{ state: 'armed', deleted_at: null }]);

  const drain = await normalApp.inject({
    method: 'POST',
    url: '/api/v1/intake/drain-wipes',
    headers: auth(ownerToken),
    payload: {},
  });
  expect(drain.statusCode, drain.body).toBe(200);
  expect(drain.json().attempted).toBeGreaterThanOrEqual(1);

  const after = await db.adminQuery<{ state: string; deleted_at: Date | null }>(
    `SELECT state, deleted_at FROM blob_tombstone
      WHERE tenant_ref=$1 AND storage_key=$2 AND reason='compensation'`,
    [tenantId, key],
  );
  expect(after[0]?.state).toBe('swept');
  expect(after[0]?.deleted_at).not.toBeNull();
  expect(await deps.documentStorage.get(key)).toBeNull();
}

async function postJson(app: FastifyInstance, token: string, url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, headers: auth(token), payload: payload as never });
  expect(res.statusCode, res.body).toBeGreaterThanOrEqual(200);
  expect(res.statusCode, res.body).toBeLessThan(300);
  return res.json();
}

async function stageInvoicePrerequisites(label: 'U1' | 'U4') {
  const year = new Date().getUTCFullYear();
  const entity = (await postJson(normalApp, opsToken, '/api/v1/entities', {
    name: `${label} Entity`, code: `${label}E`, jurisdiction: 'MA', registrationId: null, localCurrency: 'USD',
  })).entity;
  const ended = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const mission = (await postJson(normalApp, opsToken, '/api/v1/missions', {
    name: `${label} Closed Mission`, code: `${label}/${year}/0001`, organizer: label, startsOn: ended(10), endsOn: ended(2),
  })).mission;
  const line = (await postJson(normalApp, opsToken, `/api/v1/missions/${mission.missionId}/lines`, {
    direction: 'Income', category: 'PrizeMoney', label: `${label} income`, amountMinor: 1_000, currency: 'USD',
  })).line;
  return { entity, mission, line };
}

beforeAll(async () => {
  db = await startTestDatabase();
  const dir = mkdtempSync(join(tmpdir(), 'c3-u1-staff-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'u1-staff-test-secret-0123456789',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: dir,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  const baseStorage = deps.documentStorage;
  const abortingStorage: DocumentStorage = {
    ...baseStorage,
    put: async (key, body, contentType, opts) => {
      if (!rejectNextPut) return baseStorage.put(key, body, contentType, opts);
      rejectNextPut = false;
      rejectedKey = key;
      // The real edge: the storage operation is already active, waits for the request's actual
      // deadline signal, and rejects with that exact causal reason. Moving PUT outside its catch
      // therefore strands PREPARED; the fixed catch arms it.
      await new Promise<void>((_resolve, reject) => {
        const abort = () => reject(opts?.signal?.reason ?? new Error('request aborted'));
        if (opts?.signal?.aborted) return abort();
        opts?.signal?.addEventListener('abort', abort, { once: true });
      });
    },
  };

  normalApp = buildApp(deps);
  abortApp = buildApp({
    ...deps,
    documentStorage: abortingStorage,
    requestTimeoutMs: 200,
    deadlineMs: 300,
    leaseTtlMs: 1_000,
  });
  await normalApp.ready();
  await abortApp.ready();

  const seeded = await db.seedTenant({
    slug: 'u1-staff',
    users: [
      { key: 'owner', email: 'owner@u1.test', displayName: 'Owner', role: 'owner' },
      { key: 'ops', email: 'ops@u1.test', displayName: 'Ops', role: 'operations' },
    ],
  });
  tenantId = seeded.tenantId;
  await db.adminQuery(
    `INSERT INTO person (tenant_id, person_id, full_name) VALUES ($1, $2, 'U1 Target')`,
    [tenantId, personId],
  );
  ownerToken = await login(normalApp, 'owner@u1.test', 'owner');
  opsToken = await login(normalApp, 'ops@u1.test', 'operations');
}, 180_000);

afterAll(async () => {
  await abortApp?.close();
  await normalApp?.close();
  await deps?.close();
  await db?.stop();
});

beforeEach(() => {
  rejectNextPut = false;
  rejectedKey = null;
});

describe('HARDEN-3.7 U1 — every staff PUT rejects inside its compensation catch', () => {
  it('photo PUT: signal rejection arms the exact intent and the real drain sweeps it', async () => {
    armSignalAbortPut();
    const form = new FormData();
    form.append('file', new Blob([PNG], { type: 'image/png' }), 'u1.png');
    const res = await abortApp.inject({
      method: 'POST',
      url: `/api/v1/people/${personId}/photo`,
      headers: auth(opsToken),
      body: form as never,
    });
    expect(res.statusCode, res.body).toBe(408);
    await assertArmedThenDrain(await assertedRejectedKey());
  });

  it('general-document PUT: signal rejection arms the exact intent and the real drain sweeps it', async () => {
    armSignalAbortPut();
    const form = new FormData();
    form.append('ownerType', 'Person');
    form.append('ownerId', personId);
    form.append('file', new Blob([PDF], { type: 'application/pdf' }), 'u1.pdf');
    const res = await abortApp.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(opsToken),
      body: form as never,
    });
    expect(res.statusCode, res.body).toBe(408);
    await assertArmedThenDrain(await assertedRejectedKey());
  });

  it('promoted-intake live-copy PUT: signal rejection arms the exact intent and the real drain sweeps it', async () => {
    const linkId = randomUUID();
    const submissionId = randomUUID();
    const uploadId = randomUUID();
    const quarantineKey = `intake/${tenantId}/${submissionId}/${uploadId}`;
    await deps.documentStorage.put(quarantineKey, PDF, 'application/pdf');
    await db.adminQuery(
      `INSERT INTO intake_link
         (id, tenant_id, token_hash, kind, label, created_by, expires_at, max_uses, used_count, status, consumed_at)
       VALUES ($1, $2, $3, 'Onboarding', 'U1', 'ops@u1.test', now()+interval '1 day', 1, 1, 'Consumed', now())`,
      [linkId, tenantId, `u1-${randomUUID()}`],
    );
    await db.adminQuery(
      `INSERT INTO intake_submission
         (id, tenant_id, link_id, kind, payload, uploads, status, reviewed_by, reviewed_at,
          promoted_approval_id, promoted_person_id, decision_note)
       VALUES ($1, $2, $3, 'Onboarding', $4::jsonb, $5::jsonb, 'Promoted', 'ops@u1.test', now(),
               'APR-U1', $6, 'U1 fixture')`,
      [
        submissionId,
        tenantId,
        linkId,
        JSON.stringify({ fullName: 'U1 Target' }),
        JSON.stringify([{ uploadId, fileName: 'promoted.pdf', contentType: 'application/pdf', sizeBytes: PDF.length, sha256: createHash('sha256').update(PDF).digest('hex'), storageKey: quarantineKey }]),
        personId,
      ],
    );

    armSignalAbortPut();
    const res = await abortApp.inject({
      method: 'POST',
      url: `/api/v1/intake/submissions/${submissionId}/attach`,
      headers: auth(opsToken),
      payload: { uploadIds: [uploadId] },
    });
    expect(res.statusCode, res.body).toBe(408);
    await assertArmedThenDrain(await assertedRejectedKey());
  });

  it('invoice-PDF PUT: signal rejection arms the exact intent and the real drain sweeps it', async () => {
    const { entity, mission, line } = await stageInvoicePrerequisites('U1');

    armSignalAbortPut();
    const res = await abortApp.inject({
      method: 'POST',
      url: '/api/v1/invoices',
      headers: auth(opsToken),
      payload: {
        missionId: mission.missionId,
        lineId: line.lineId,
        entityId: entity.entityId,
        billedToName: 'U1 Customer',
        vatRateBps: 0,
      },
    });
    // Invoice issuance commits first; the artifact failure is represented honestly in-band.
    expect(res.statusCode, res.body).toBe(201);
    expect(res.json().pdfError).toMatch(/could not be stored/i);
    expect(res.json().invoice.documentId).toBeNull();
    await assertArmedThenDrain(await assertedRejectedKey());
  });
});

describe('HARDEN-3.7 U4 — a staff pre-registration queued past deadline stays byte-free', () => {
  it('re-checks the fired request signal after checkout and refuses before intent insert/PUT', async () => {
    const boundedPersistence = createPersistence({
      appConnectionString: db.appUrl,
      max: 1,
      poolCheckoutTimeoutMs: 2_000,
    });
    const holder = await boundedPersistence.pool.connect();
    let holderReleased = false;
    let putCalls = 0;
    const countingStorage: DocumentStorage = {
      ...deps.documentStorage,
      put: async (...args) => {
        putCalls += 1;
        await deps.documentStorage.put(...args);
      },
    };
    const deadlineApp = buildApp({
      ...deps,
      persistence: boundedPersistence,
      documentStorage: countingStorage,
      requestTimeoutMs: 100,
      deadlineMs: 150,
      leaseTtlMs: 1_000,
    });
    const before = Number((await db.adminQuery<{ n: string }>(
      `SELECT count(*) AS n FROM blob_tombstone WHERE tenant_ref=$1`, [tenantId],
    ))[0]!.n);
    try {
      await deadlineApp.ready();
      const form = new FormData();
      form.append('ownerType', 'Person');
      form.append('ownerId', personId);
      form.append('file', new Blob([PDF], { type: 'application/pdf' }), 'u4.pdf');
      const request = deadlineApp.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(opsToken),
        body: form as never,
      });
      await expect.poll(() => boundedPersistence.pool.waitingCount, { timeout: 1_000, interval: 10 }).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 220)); // request deadline fires while queued
      holder.release();
      holderReleased = true;

      const res = await request;
      expect(res.statusCode, res.body).toBe(500);
      expect(res.json().error.code).toBe('STORAGE_UNAVAILABLE');
      expect(putCalls).toBe(0);
      const after = Number((await db.adminQuery<{ n: string }>(
        `SELECT count(*) AS n FROM blob_tombstone WHERE tenant_ref=$1`, [tenantId],
      ))[0]!.n);
      // RED: removing the post-checkout signal gate commits a PREPARED intent and reaches PUT.
      expect(after).toBe(before);
    } finally {
      if (!holderReleased) holder.release();
      await deadlineApp.close();
      await boundedPersistence.close();
    }
  }, 15_000);

  it('passes the fired signal into the separately wired invoice PDF pre-registration', async () => {
    const { entity, mission, line } = await stageInvoicePrerequisites('U4');
    const boundedPersistence = createPersistence({
      appConnectionString: db.appUrl,
      max: 1,
      poolCheckoutTimeoutMs: 2_000,
    });
    const holder = await boundedPersistence.pool.connect();
    let holderReleased = false;
    let putCalls = 0;
    const countingStorage: DocumentStorage = {
      ...deps.documentStorage,
      put: async (...args) => {
        putCalls += 1;
        await deps.documentStorage.put(...args);
      },
    };
    const deadlineApp = buildApp({
      ...deps,
      persistence: boundedPersistence,
      documentStorage: countingStorage,
      requestTimeoutMs: 100,
      deadlineMs: 150,
      leaseTtlMs: 1_000,
    });
    const before = Number((await db.adminQuery<{ n: string }>(
      `SELECT count(*) AS n FROM blob_tombstone WHERE tenant_ref=$1`, [tenantId],
    ))[0]!.n);
    try {
      await deadlineApp.ready();
      const request = deadlineApp.inject({
        method: 'POST',
        url: '/api/v1/invoices',
        headers: auth(opsToken),
        payload: {
          missionId: mission.missionId,
          lineId: line.lineId,
          entityId: entity.entityId,
          billedToName: 'U4 Customer',
          vatRateBps: 0,
        },
      });
      await expect.poll(() => boundedPersistence.pool.waitingCount, { timeout: 1_000, interval: 10 }).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 220));
      holder.release();
      holderReleased = true;

      const res = await request;
      expect(res.statusCode, res.body).toBe(201);
      expect(res.json().pdfError).toMatch(/could not be stored/i);
      expect(res.json().invoice.documentId).toBeNull();
      // RED: omit `{ signal }` at the invoice-only transaction site and this reaches PUT and
      // resolves its newly inserted intent even though the request deadline fired in the queue.
      expect(putCalls).toBe(0);
      const after = Number((await db.adminQuery<{ n: string }>(
        `SELECT count(*) AS n FROM blob_tombstone WHERE tenant_ref=$1`, [tenantId],
      ))[0]!.n);
      expect(after).toBe(before);
    } finally {
      if (!holderReleased) holder.release();
      await deadlineApp.close();
      await boundedPersistence.close();
    }
  }, 15_000);
});
