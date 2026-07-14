/**
 * uploadLease.test.ts (api) — R5-N01: an HTTP request must never outlive its in-flight upload
 * lease. Two proofs:
 *   1. the BOOT invariant — buildApp refuses to start unless requestTimeout > 0 and
 *      requestTimeout × 2 ≤ leaseTtl (Fastify's requestTimeout defaults to 0 = unlimited);
 *   2. the REAL edge — with a short config (requestTimeout 2s / lease TTL 6s), a multipart
 *      upload that stalls mid-stream is ABORTED by the server before the lease could expire,
 *      and no bytes are retained.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Socket } from 'node:net';
import { readdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
let deps: Deps;
let blobDir: string;

beforeAll(async () => {
  db = await startTestDatabase();
  blobDir = mkdtempSync(join(tmpdir(), 'c3-lease-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'lease-test-secret-0000000000000000',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: blobDir,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
}, 180_000);

afterAll(async () => {
  await deps?.close();
  await db?.stop();
});

function blobCount(dir: string): number {
  const walk = (d: string): number => {
    let n = 0;
    for (const e of readdirSync(d, { withFileTypes: true })) n += e.isDirectory() ? walk(join(d, e.name)) : 1;
    return n;
  };
  try { return walk(dir); } catch { return 0; }
}

describe('R5-N01 + HARDEN-3.5 A: the upload-timing boot algebra (receive ≤ deadline; deadline×2 ≤ lease ≤ 2h)', () => {
  it('REFUSES to start when the receive timeout is 0 (Fastify default = unlimited)', () => {
    expect(() => buildApp({ ...deps, requestTimeoutMs: 0, deadlineMs: 1_500, leaseTtlMs: 6_000 })).toThrow(/must be > 0/i);
  });
  it('REFUSES to start when the receive timeout exceeds the deadline (receipt is part of the lifetime)', () => {
    expect(() => buildApp({ ...deps, requestTimeoutMs: 2_000, deadlineMs: 1_000, leaseTtlMs: 6_000 })).toThrow(/receive timeout .* ≤ the request deadline|part of the request lifetime/i);
  });
  it('REFUSES to start when deadline × 2 exceeds the lease TTL', () => {
    // 2000 × 2 = 4000 > 3000 → the request could outlive the lease.
    expect(() => buildApp({ ...deps, requestTimeoutMs: 1_000, deadlineMs: 2_000, leaseTtlMs: 3_000 })).toThrow(/upload-lease invariant|≤ the intake/i);
  });
  it('REFUSES to start when the lease TTL exceeds the 0075 DB cap (2h)', () => {
    expect(() => buildApp({ ...deps, requestTimeoutMs: 60_000, deadlineMs: 120_000, leaseTtlMs: 7_200_001 })).toThrow(/DB-supported maximum|0075/i);
  });
  it('starts when the full algebra holds (receive ≤ deadline; deadline×2 ≤ lease ≤ cap)', async () => {
    const app = buildApp({ ...deps, requestTimeoutMs: 1_000, deadlineMs: 2_000, leaseTtlMs: 6_000 });
    await app.ready();
    await app.close();
  });
  it('R6-N05: the three knobs flow from the ENVIRONMENT (production is finally configurable)', () => {
    const env = loadEnv({
      NODE_ENV: 'test',
      AUTH_PROVIDER: 'dev',
      DEV_AUTH_SECRET: 'lease-test-secret-0000000000000000',
      DATABASE_URL: db.appUrl,
      DATABASE_ADMIN_URL: db.adminUrl,
      DOCUMENTS_DIR: blobDir,
      REQUEST_RECEIVE_TIMEOUT_MS: '60000',
      REQUEST_DEADLINE_MS: '120000',
      INTAKE_LEASE_TTL_MS: '240000',
    } as NodeJS.ProcessEnv);
    expect(env.requestReceiveTimeoutMs).toBe(60_000);
    expect(env.requestDeadlineMs).toBe(120_000);
    expect(env.intakeLeaseTtlMs).toBe(240_000);
    const envDeps = buildDeps(env, createLogger(env));
    try {
      expect(envDeps.requestTimeoutMs).toBe(60_000);
      expect(envDeps.deadlineMs).toBe(120_000);
      expect(envDeps.leaseTtlMs).toBe(240_000);
      // …and an env-inconsistent triple refuses at boot (the algebra guards config too).
      expect(() => buildApp({ ...envDeps, requestTimeoutMs: 130_000 })).toThrow(/receive timeout .* ≤ the request deadline|part of the request lifetime/i);
    } finally {
      void envDeps.close();
    }
  });
});

describe('R5-N01: a stalled multipart upload is aborted before the lease can expire', () => {
  let app: FastifyInstance;
  let port: number;
  let token: string;

  beforeAll(async () => {
    await db.truncateAll();
    const seeded = await db.seedTenant({ slug: 'leasealpha', users: [{ key: 'ops', email: 'ops@l.com', displayName: 'Ops', role: 'operations' }] });
    void seeded;
    // Short config: receive 2s / deadline 3s / lease 6s (2000 ≤ 3000; 3000×2 ≤ 6000, so it
    // boots). The small connectionsCheckingInterval makes the 2s receive timeout DETECTED
    // promptly (Node's default is 30s).
    app = buildApp({ ...deps, requestTimeoutMs: 2_000, deadlineMs: 3_000, leaseTtlMs: 6_000, connectionsCheckingIntervalMs: 200 });
    await app.ready();
    await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as { port: number }).port;
    // Mint a link as ops (the public route claims by token).
    const opsLogin = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email: 'ops@l.com', displayName: 'Ops', role: 'operations', tenantSlug: 'leasealpha' } });
    const opsToken = opsLogin.json().token as string;
    const link = await app.inject({ method: 'POST', url: '/api/v1/intake/links', headers: { authorization: `Bearer ${opsToken}` }, payload: { kind: 'Onboarding', label: null } });
    expect(link.statusCode, link.body).toBe(201);
    token = link.json().token as string; // the raw token is top-level in the mint response
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('the server destroys the socket at requestTimeout (~2s), well before the 6s lease TTL, with no bytes retained', async () => {
    const before = blobCount(blobDir);
    const socket: Socket = createConnection({ port, host: '127.0.0.1' });
    const boundary = '----c3leaseboundary';
    // Send headers + the START of a file part, then STALL (never send the rest or the closing
    // boundary). The request stays incomplete, so Fastify's requestTimeout must fire.
    const partialBody =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="files"; filename="stall.pdf"\r\n' +
      'Content-Type: application/pdf\r\n\r\n' +
      '%PDF-1.4\n'; // a few bytes, then nothing more
    const head =
      `POST /api/v1/intake/public/${token} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${port}\r\n` +
      `Content-Type: multipart/form-data; boundary=${boundary}\r\n` +
      'Content-Length: 100000\r\n' + // promise more than we send → the request never completes
      'Connection: close\r\n\r\n';

    const start = Date.now();
    // The server ABORTS the stalled request at requestTimeout: it either sends a 408 (data) and
    // then closes with Connection: close, or destroys the socket. Any of those, within a bound
    // decisively below the 6s lease, proves the request cannot outlive its lease.
    const abortedAt = new Promise<number>((resolve, reject) => {
      const done = () => resolve(Date.now() - start);
      socket.on('data', done);
      socket.on('close', done);
      socket.on('end', done);
      socket.on('error', done);
      setTimeout(() => reject(new Error('the server did NOT abort the stalled upload within 5s (requestTimeout not enforced?)')), 5_000);
    });
    socket.setNoDelay(true);
    socket.write(head);
    socket.write(partialBody);
    // ...and stall (write nothing more).

    const elapsed = await abortedAt;
    socket.destroy();
    // The abort is CAUSED BY requestTimeout: it lands in the ~2s window — decisively later than
    // an early parse response (< ~1.5s) and decisively BEFORE the 6s lease TTL. With
    // requestTimeout:0 (unlimited) the request instead hangs past the 5s guard → RED.
    expect(elapsed, `abort elapsed ${elapsed}ms should be ~requestTimeout (2000ms)`).toBeGreaterThan(1_500);
    expect(elapsed).toBeLessThan(4_000);
    // No bytes were retained — the stalled part never completed a storage PUT.
    expect(blobCount(blobDir)).toBe(before);
  }, 15_000);
});

// HARDEN-3.5 A — round-6 §4.1, THE open schedule: the body arrives COMPLETE inside the receive
// window, then the STORAGE PUT stalls. Before this wave nothing bounded post-receipt work — the
// handler could resume after lease expiry + sweep + finalize and publish. Now the request-scoped
// deadline's AbortSignal rides every byte-producing operation: the stalled PUT is ABORTED at the
// deadline, the route answers an honest 408, nothing is retained, the claim never runs, the lease
// is released, and a subsequent exit executes clean.
describe('HARDEN-3.5 A (§4.1): a fully-received request whose storage PUT stalls is aborted by the deadline', () => {
  let app: FastifyInstance;
  let token: string;
  let stallArmed = false;

  beforeAll(async () => {
    await db.truncateAll();
    await db.seedTenant({ slug: 'stallco', users: [{ key: 'ops', email: 'ops@s.com', displayName: 'Ops', role: 'operations' }] });
    // The storage seam: identical to the real fs driver EXCEPT that an armed put NEVER resolves —
    // it only rejects when the request deadline's signal aborts (exactly how a hung R2 socket
    // behaves under the SDK's abortSignal). Detaching the signal (the RED neuter) makes it hang.
    const stallingStorage: typeof deps.documentStorage = {
      ...deps.documentStorage,
      put: (key, body, contentType, opts) => {
        if (!stallArmed) return deps.documentStorage.put(key, body, contentType, opts);
        return new Promise<void>((_resolve, reject) => {
          const abort = () => reject((opts?.signal?.reason as Error) ?? new Error('aborted'));
          if (opts?.signal?.aborted) return abort();
          opts?.signal?.addEventListener('abort', abort);
        });
      },
    };
    // receive 1s / deadline 1.5s / lease 3s (1000 ≤ 1500; 1500×2 ≤ 3000).
    app = buildApp({ ...deps, documentStorage: stallingStorage, requestTimeoutMs: 1_000, deadlineMs: 1_500, leaseTtlMs: 3_000 });
    await app.ready();
    const opsLogin = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email: 'ops@s.com', displayName: 'Ops', role: 'operations', tenantSlug: 'stallco' } });
    const link = await app.inject({ method: 'POST', url: '/api/v1/intake/links', headers: { authorization: `Bearer ${opsLogin.json().token}` }, payload: { kind: 'Onboarding', label: null } });
    expect(link.statusCode, link.body).toBe(201);
    token = link.json().token as string;
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  it('the PUT is ABORTED by the deadline signal: honest 408, nothing retained, no claim, lease released, exit clean', async () => {
    const before = blobCount(blobDir);
    stallArmed = true;
    const form = new FormData();
    form.append('payload', JSON.stringify({ fullName: 'Stall Case', email: 'stall@x.com' }));
    form.append('file', new Blob([Buffer.from('%PDF-1.4 tiny')], { type: 'application/pdf' }), 'stall.pdf');
    const started = Date.now();
    // The body is COMPLETE (inject delivers it whole — the receive window is satisfied); only
    // the handler's PUT stalls. Without the signal this hangs forever (the RED case, bounded
    // here by the 4s race guard).
    const res = await Promise.race([
      app.inject({ method: 'POST', url: `/api/v1/intake/public/${token}`, body: form as never }),
      new Promise<'hung'>((r) => setTimeout(() => r('hung'), 4_000)),
    ]);
    stallArmed = false;
    expect(res, 'the stalled PUT was not aborted by the deadline (signal detached?)').not.toBe('hung');
    const reply = res as Exclude<typeof res, 'hung'>;
    const elapsed = Date.now() - started;
    // Aborted at ~deadline (1.5s): decisively after arming, decisively before the 3s lease TTL.
    expect(reply.statusCode, reply.body).toBe(408);
    expect(reply.json().error.code).toBe('REQUEST_DEADLINE_EXCEEDED');
    expect(elapsed).toBeGreaterThan(1_200);
    expect(elapsed).toBeLessThan(3_000);
    // Nothing was retained (the aborted PUT published nothing) and NO submission was claimed.
    expect(blobCount(blobDir)).toBe(before);
    const subs = await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM intake_submission`);
    expect(Number(subs[0]!.n)).toBe(0);
    // HARDEN-3.6 T2: local PUT rejection is remotely ambiguous, so failure retains the live
    // lease as a publication fence until TTL expiry. Only a committed claim releases early.
    const leases = await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM intake_upload_lease WHERE expires_at > now()`);
    expect(Number(leases[0]!.n)).toBe(1);
  }, 20_000);
});
