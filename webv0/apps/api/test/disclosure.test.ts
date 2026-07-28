/**
 * disclosure.test.ts (api) — the DISCLOSURE CHAPTER's wire-level proofs
 * (C3-DISCLOSURE-CHAPTER-SCOPE.md, Block 1). Each fix lands with its RED-proven
 * assertion here: the test states what the WIRE must not say, and was run
 * against the pre-fix tree to prove it failed there.
 *
 * F12 — the withdraw denial must not name the submitter. A 403 is an answer
 * to the DENIED caller; forwarding `submittedBy` in its details told any
 * authenticated actor who submitted any approval they could name — an
 * identity disclosure through an error envelope.
 */
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
const tokens = {} as { ops: string; ops2: string; owner: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (t: string, url: string, payload?: unknown) => app.inject({ method: 'POST', url, headers: auth(t), payload: payload ?? {} });

async function submitPerson(token: string, fullName: string): Promise<{ approvalId: string; version: number }> {
  const res = await post(token, '/api/v1/approvals', { input: { fullName } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().approval;
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'disclosure-test-secret-00000000',
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
  tokens.ops2 = await login('ops2@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
});

describe('F12 — the withdraw denial does not name the submitter', () => {
  it("a non-submitter's withdraw is refused WITHOUT disclosing who submitted", async () => {
    const a = await submitPerson(tokens.ops, 'Withdraw Disclosure Probe');

    // ops2 (authenticated, same tenant, NOT the submitter) probes the withdraw.
    const res = await post(tokens.ops2, `/api/v1/approvals/${a.approvalId}/withdraw`, { expectedVersion: a.version });
    expect(res.statusCode, res.body).toBe(403);

    // The denial itself is correct; the BODY must not carry the submitter.
    const body = res.body;
    expect(body, 'the 403 body must not contain the submitter identity').not.toContain('ops@alpha.com');
    const details = res.json().error?.details ?? {};
    expect(details, 'the 403 details must not carry submittedBy').not.toHaveProperty('submittedBy');

    // POSITIVE CONTROL on the same instruments: the submitter's own e-mail IS
    // on the wire where it belongs — the approval DTO for an entitled reader —
    // so a clean body above is a real absence, not a blind assertion.
    const dto = await app.inject({ method: 'GET', url: `/api/v1/approvals/${a.approvalId}`, headers: auth(tokens.owner) });
    expect(dto.statusCode).toBe(200);
    expect(dto.body).toContain('ops@alpha.com');
  });
});
