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

describe('R5-N01: the upload-lease boot invariant', () => {
  it('REFUSES to start when requestTimeout is 0 (Fastify default = unlimited)', () => {
    expect(() => buildApp({ ...deps, requestTimeoutMs: 0, leaseTtlMs: 6_000 })).toThrow(/requestTimeout.*> 0|upload-lease invariant/i);
  });
  it('REFUSES to start when requestTimeout × 2 exceeds the lease TTL', () => {
    // 2000 × 2 = 4000 > 3000 → the request could outlive the lease.
    expect(() => buildApp({ ...deps, requestTimeoutMs: 2_000, leaseTtlMs: 3_000 })).toThrow(/upload-lease invariant|≤ the intake/i);
  });
  it('starts when requestTimeout > 0 and requestTimeout × 2 ≤ leaseTtl', async () => {
    const app = buildApp({ ...deps, requestTimeoutMs: 2_000, leaseTtlMs: 6_000 });
    await app.ready();
    await app.close();
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
    // Short config: requestTimeout 2s, lease TTL 6s (2×2000 ≤ 6000, so it boots). The small
    // connectionsCheckingInterval makes the 2s timeout DETECTED promptly (Node's default is 30s).
    app = buildApp({ ...deps, requestTimeoutMs: 2_000, leaseTtlMs: 6_000, connectionsCheckingIntervalMs: 200 });
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
