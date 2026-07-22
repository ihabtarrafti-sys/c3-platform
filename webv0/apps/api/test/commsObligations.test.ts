/**
 * commsObligations.test.ts (api) — the Obligation lifecycle over HTTP:
 * delivered ≠ accepted ≠ done, the transition gateway's authority checks,
 * the external-authority attestation, CAS staleness, the CommsObligation
 * document-guard arm, and lapse = read-only (with armed compensation).
 */
import { randomUUID, createHash } from 'node:crypto';
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

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;

const tokens = {} as { ops: string; owner: string; visitor: string; ownerB: string };
const uids = {} as { ops: string; owner: string; visitor: string };

async function login(email: string, role: string, tenantSlug: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email, displayName: email, role, tenantSlug } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json().token as string;
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function uidOf(email: string): Promise<string> {
  const rows = await db.adminQuery<{ id: string }>(`SELECT id FROM app_user WHERE email = $1`, [email]);
  return rows[0]!.id;
}

async function createMission(): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/v1/missions', headers: auth(tokens.ops), payload: { name: 'Obligation Cup', startsOn: '2026-09-01' } });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().mission.missionId as string;
}

function obligationInput(over?: Record<string, unknown>) {
  return {
    description: 'Send the signed publisher contracts',
    accountableUserId: uids.visitor,
    beneficiary: { kind: 'external', label: 'The Publisher' },
    acceptance: { kind: 'account', userId: uids.owner },
    dueAt: '2026-09-10T14:00:00.000Z',
    evidenceRequirement: 'The countersigned PDF set',
    clientMutationId: randomUUID(),
    ...over,
  };
}

async function mint(token: string, missionId: string, over?: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/v1/comms/missions/${missionId}/obligations`, headers: auth(token), payload: obligationInput(over) });
}

const pdf = Buffer.from('%PDF-1.4 obligation evidence probe %%EOF');

async function deliver(token: string, obligationId: string) {
  const form = new FormData();
  form.append('clientMutationId', randomUUID());
  form.append('note', 'countersigned set attached');
  form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'contracts.pdf');
  return app.inject({ method: 'POST', url: `/api/v1/comms/obligations/${obligationId}/evidence`, headers: auth(token), body: form as never });
}

async function transition(token: string, obligationId: string, action: string, expectedVersion: number, note?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/comms/obligations/${obligationId}/${action}`,
    headers: auth(token),
    payload: { expectedVersion, clientMutationId: randomUUID(), ...(note ? { note } : {}) },
  });
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'comms-obligations-secret-0123456',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
    DOCUMENTS_DIR: mkdtempSync(join(tmpdir(), 'c3-obl-')),
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
  await db.seedTenant({ slug: 'bravo' });
  tokens.ops = await login('ops@alpha.com', 'operations', 'alpha');
  tokens.owner = await login('owner@alpha.com', 'owner', 'alpha');
  tokens.visitor = await login('visitor@alpha.com', 'visitor', 'alpha');
  tokens.ownerB = await login('owner@bravo.com', 'owner', 'bravo');
  uids.ops = await uidOf('ops@alpha.com');
  uids.owner = await uidOf('owner@alpha.com');
  uids.visitor = await uidOf('visitor@alpha.com');
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
  );
});

describe('the Obligation — delivered ≠ accepted ≠ done', () => {
  it('minting is operational-only (D2); mint is idempotent; the story starts at Open', async () => {
    const missionId = await createMission();
    const denied = await mint(tokens.visitor, missionId);
    expect(denied.statusCode, denied.body).toBe(403);

    const mutation = randomUUID();
    const first = await mint(tokens.ops, missionId, { clientMutationId: mutation });
    expect(first.statusCode, first.body).toBe(201);
    const o = first.json().obligation;
    expect(o.state).toBe('Open');
    expect(o.obligationId).toMatch(/^OBL-\d{4,}$/);
    expect(o.requesterUserId).toBe(uids.ops);
    expect(o.events.map((e: { eventType: string }) => e.eventType)).toEqual(['Created']);

    const replay = await mint(tokens.ops, missionId, { clientMutationId: mutation });
    expect(replay.statusCode).toBe(201);
    expect(replay.json().obligation.obligationId).toBe(o.obligationId);
  });

  it('separation of duties: an internal acceptor may not be the accountable; the external-proxy overlap is legal', async () => {
    const missionId = await createMission();
    // Self-certify (account acceptance == accountable) is STRUCTURALLY refused.
    const selfCert = await mint(tokens.ops, missionId, {
      accountableUserId: uids.visitor,
      acceptance: { kind: 'account', userId: uids.visitor },
    });
    expect(selfCert.statusCode, selfCert.body).toBe(400);
    // The external-proxy overlap: the accountable may TRANSCRIBE an outside
    // authority's word (mandatory attestation carries it) — legal.
    const proxyOverlap = await mint(tokens.ops, missionId, {
      accountableUserId: uids.visitor,
      acceptance: { kind: 'external', label: 'Publisher — R. Chen', proxyUserId: uids.visitor },
    });
    expect(proxyOverlap.statusCode, proxyOverlap.body).toBe(201);
  });

  it('the full internal lifecycle: deliver (accountable) → accept (ONLY the authority) → done → reopen → cancel', async () => {
    const missionId = await createMission();
    const minted = (await mint(tokens.ops, missionId)).json().obligation;

    // The accountable (a read-only role!) delivers evidence — register-visible.
    const delivered = await deliver(tokens.visitor, minted.obligationId);
    expect(delivered.statusCode, delivered.body).toBe(201);
    const afterDeliver = delivered.json().obligation;
    expect(afterDeliver.state).toBe('Delivered');
    expect(afterDeliver.evidence).toHaveLength(1);
    const evidenceDocId = afterDeliver.evidence[0].documentId as string;
    const docRow = await db.adminQuery<{ record_kind: string; owner_type: string }>(
      `SELECT record_kind, owner_type FROM document WHERE document_id = $1`,
      [evidenceDocId],
    );
    expect(docRow[0]).toMatchObject({ record_kind: 'RegisteredEvidence', owner_type: 'CommsObligation' });

    // Only the NAMED acceptance uuid may accept: ops (the requester!) is refused.
    const wrongActor = await transition(tokens.ops, minted.obligationId, 'accept', afterDeliver.version);
    expect(wrongActor.statusCode, wrongActor.body).toBe(403);
    const accepted = await transition(tokens.owner, minted.obligationId, 'accept', afterDeliver.version);
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().obligation.state).toBe('Accepted');

    // Accepted is not Done: the accountable closes the loop.
    const done = await transition(tokens.visitor, minted.obligationId, 'complete', accepted.json().obligation.version);
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().obligation.state).toBe('Done');

    // Reopen (requester, reason REQUIRED) → Open; then cancel (requester, reason).
    const noReason = await transition(tokens.ops, minted.obligationId, 'reopen', done.json().obligation.version);
    expect(noReason.statusCode).toBe(400);
    const reopened = await transition(tokens.ops, minted.obligationId, 'reopen', done.json().obligation.version, 'wrong file set');
    expect(reopened.statusCode, reopened.body).toBe(200);
    expect(reopened.json().obligation.state).toBe('Open');
    const cancelled = await transition(tokens.ops, minted.obligationId, 'cancel', reopened.json().obligation.version, 'no longer needed');
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().obligation.state).toBe('Cancelled');

    // The story is the record: every act landed as an event.
    expect(cancelled.json().obligation.events.map((e: { eventType: string }) => e.eventType)).toEqual([
      'Created',
      'EvidenceDelivered',
      'Accepted',
      'Done',
      'Reopened',
      'Cancelled',
    ]);
  });

  it('an EXTERNAL authority acts only through its proxy WITH an attestation', async () => {
    const missionId = await createMission();
    const minted = (
      await mint(tokens.ops, missionId, { acceptance: { kind: 'external', label: 'Publisher — R. Chen', proxyUserId: uids.owner } })
    ).json().obligation;
    const delivered = (await deliver(tokens.visitor, minted.obligationId)).json().obligation;

    const bare = await transition(tokens.owner, minted.obligationId, 'accept', delivered.version);
    expect(bare.statusCode, bare.body).toBe(400); // attestation REQUIRED
    const attested = await transition(tokens.owner, minted.obligationId, 'accept', delivered.version, 'confirmed by R. Chen (email, 22 Jul)');
    expect(attested.statusCode, attested.body).toBe(200);
    const acceptEvent = attested.json().obligation.events.find((e: { eventType: string }) => e.eventType === 'Accepted');
    expect(acceptEvent.attestation).toBe('confirmed by R. Chen (email, 22 Jul)');
  });

  it('CAS staleness 409s; illegal transitions 409; evidence after Accepted refuses AND arms its bytes', async () => {
    const missionId = await createMission();
    const minted = (await mint(tokens.ops, missionId)).json().obligation;
    const stale = await transition(tokens.owner, minted.obligationId, 'accept', 99);
    expect(stale.statusCode).toBe(409); // and accept from Open is illegal anyway
    const delivered = (await deliver(tokens.visitor, minted.obligationId)).json().obligation;
    const early = await transition(tokens.visitor, minted.obligationId, 'complete', delivered.version);
    expect(early.statusCode, early.body).toBe(409); // Done only from Accepted
    await transition(tokens.owner, minted.obligationId, 'accept', delivered.version);

    // Evidence after Accepted: refused IN-TX after the PUT → the bytes are ARMED.
    const armedBefore = await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM blob_tombstone WHERE state = 'armed'`);
    const late = await deliver(tokens.visitor, minted.obligationId);
    expect(late.statusCode, late.body).toBe(409);
    const armedAfter = await db.adminQuery<{ n: string }>(`SELECT count(*) AS n FROM blob_tombstone WHERE state = 'armed'`);
    expect(Number(armedAfter[0]!.n)).toBe(Number(armedBefore[0]!.n) + 1);
  });

  it('the CommsObligation doc-guard arm: any mission reader downloads evidence; cross-tenant concealed', async () => {
    const missionId = await createMission();
    const minted = (await mint(tokens.ops, missionId)).json().obligation;
    const delivered = (await deliver(tokens.visitor, minted.obligationId)).json().obligation;
    const documentId = delivered.evidence[0].documentId as string;

    const dl = await app.inject({ method: 'GET', url: `/api/v1/documents/${documentId}/content`, headers: auth(tokens.visitor) });
    expect(dl.statusCode, dl.body).toBe(200);
    expect(createHash('sha256').update(dl.rawPayload).digest('hex')).toBe(createHash('sha256').update(pdf).digest('hex'));
    const foreign = await app.inject({ method: 'GET', url: `/api/v1/documents/${documentId}/content`, headers: auth(tokens.ownerB) });
    expect(foreign.statusCode).toBe(404);
  });

  it('lapse: obligations stay readable; every transition refuses MODULE_READ_ONLY', async () => {
    const missionId = await createMission();
    const minted = (await mint(tokens.ops, missionId)).json().obligation;
    await db.adminQuery(`UPDATE tenant_module_entitlement SET state = 'lapsed'`);

    const read = await app.inject({ method: 'GET', url: `/api/v1/comms/obligations/${minted.obligationId}`, headers: auth(tokens.owner) });
    expect(read.statusCode, read.body).toBe(200);
    const mintDenied = await mint(tokens.ops, missionId);
    expect(mintDenied.statusCode).toBe(403);
    const cancelDenied = await transition(tokens.ops, minted.obligationId, 'cancel', minted.version, 'lapsed anyway');
    expect(cancelDenied.statusCode).toBe(403);
    expect(JSON.parse(cancelDenied.body).error.code).toBe('MODULE_READ_ONLY');
  });
});
