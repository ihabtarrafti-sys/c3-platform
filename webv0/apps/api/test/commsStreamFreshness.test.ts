/**
 * commsStreamFreshness.test.ts — CR-036 (Sweep 06): the stream's capability is
 * re-derived at the moment of use, not carried from connection open.
 *
 * ⛔ THE DEFECT. `actor` was captured ONCE when the SSE connection opened, and
 * the per-event mission-thread gate (`assertReadPeople`) is a pure function of
 * that captured object — the only fresh read on that arm was "does the mission
 * exist". So an off-boarded principal kept receiving live mission-thread pushes
 * (author label + preview) until THEIR OWN CLIENT chose to close; the server
 * had no terminator at all.
 *
 * ⚠️ TWO SCOPE FACTS, measured before writing this test:
 *   - Every current role carries `canReadPeople: true` (READ_ONLY sets it), so a
 *     role DOWNGRADE cannot revoke mission visibility today — the live
 *     revocation event is OFFBOARDING (`is_active = false`), which is what this
 *     test performs. Fresh ROLE derivation rides the same fix and binds any
 *     future role structurally.
 *   - The direct/standing arm reads seating fresh per event and was never stale
 *     — but seating does not notice a deactivated USER, so offboarding leaked
 *     there too. One derivation point covers both arms, which is why the fix
 *     lives in the stream and not in each gate arm.
 *
 * ⚖️ Per Neural's dispatch: a red that only exercised direct/standing rooms
 * would go green against the unfixed defect — so the red here is
 * MISSION-anchored, and the direct/standing safety is a separate control.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { startCommsLiveBus, type CommsLiveBus } from '@c3web/persistence';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;
let bus: CommsLiveBus;

const tokens = {} as { ops: string; fin: string };
const uids = {} as { ops: string; fin: string };
const auth = (t: string) => ({ authorization: `Bearer ${t}` });

async function until(pred: () => boolean, ms = 8_000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 40));
  }
  return pred();
}

beforeAll(async () => {
  db = await startTestDatabase();
  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'stream-freshness-secret-0123456789',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  app = buildApp(deps);
  await app.ready();
  bus = await startCommsLiveBus(db.appUrl);
  deps.attachCommsLiveBus(bus);
}, 180_000);

afterAll(async () => {
  await bus?.stop();
  await app?.close();
  await deps?.close();
  await db?.stop();
});

beforeEach(async () => {
  await db.truncateAll();
  await db.seedTenant({ slug: 'alpha' });
  for (const [key, role] of [
    ['ops', 'operations'],
    ['fin', 'finance'],
  ] as const) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/dev/login',
      payload: { email: `${key}@alpha.test`, name: key.toUpperCase(), role, tenantSlug: 'alpha' },
    });
    tokens[key] = (res.json() as { token: string }).token;
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth(tokens[key]) });
    uids[key] = (me.json() as { userId: string }).userId;
  }
  await db.adminQuery(
    `INSERT INTO tenant_module_entitlement (tenant_id, module_key, state)
     SELECT id, 'comms', 'active' FROM tenant WHERE slug = 'alpha'
     ON CONFLICT (tenant_id, module_key) DO UPDATE SET state = 'active'`,
  );
});

/** Open the SSE stream for a token; collect frames and the end signal. */
function openStream(token: string): Promise<{ frames: string[]; ended: () => boolean; destroy: () => void }> {
  return app
    .inject({ method: 'GET', url: '/api/v1/comms/stream', headers: auth(token), payloadAsStream: true })
    .then((res) => {
      const frames: string[] = [];
      let ended = false;
      const s = res.stream();
      s.on('data', (d: Buffer) => frames.push(d.toString('utf8')));
      s.on('end', () => (ended = true));
      s.on('close', () => (ended = true));
      return { frames, ended: () => ended, destroy: () => s.destroy() };
    });
}

async function createMissionWithThread(): Promise<string> {
  const mission = await app.inject({
    method: 'POST',
    url: '/api/v1/missions',
    headers: auth(tokens.ops),
    payload: { name: 'Freshness Cup', startsOn: '2026-08-10' },
  });
  const missionId = (mission.json() as { mission: { missionId: string } }).mission.missionId;
  await app.inject({ method: 'GET', url: `/api/v1/comms/missions/${missionId}/thread`, headers: auth(tokens.ops) });
  return missionId;
}

function postToMission(missionId: string, body: string) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/comms/missions/${missionId}/messages`,
    headers: auth(tokens.ops),
    payload: { body, links: [], clientMutationId: randomUUID() },
  });
}

describe('⛔ CR-036 — capability is a per-event question, and the server terminates an ended membership', () => {
  it('⛔ THE RED: an off-boarded subscriber receives NOTHING further on a MISSION thread, and the server closes the stream', async () => {
    expect(await until(() => bus.health().alive, 15_000)).toBe(true);
    const missionId = await createMissionWithThread();

    // fin subscribes while a member in good standing…
    const fin = await openStream(tokens.fin);
    const ops = await openStream(tokens.ops);

    // …and the pipe demonstrably works for them (in-test positive control:
    // without this, "nothing arrived" could mean a broken harness).
    await postToMission(missionId, 'before-offboarding-visible');
    expect(await until(() => fin.frames.join('').includes('before-offboarding-visible'))).toBe(true);

    // The membership ENDS — committed at the database, token untouched. (Dev
    // tokens carry the role; only a DB-fresh derivation can notice this at all.)
    await db.adminQuery(`UPDATE app_user SET is_active = false WHERE id = '${uids.fin}'`);

    // The next event is the moment of use. ops (still a member) receiving it is
    // the propagation fence — after this, fin's silence is a verdict, not a race.
    await postToMission(missionId, 'after-offboarding-secret');
    expect(await until(() => ops.frames.join('').includes('after-offboarding-secret'))).toBe(true);

    const finSaw = fin.frames.join('');
    expect(finSaw, 'an ended membership must learn nothing further').not.toContain('after-offboarding-secret');
    // ⛔ And the SERVER ends the stream — the defect's terminator was "until the
    // client closes", which is the one party that must not hold it.
    expect(await until(() => fin.ended(), 8_000), 'the server, not the client, terminates').toBe(true);

    ops.destroy();
    fin.destroy();
  });

  it('⛳ an unrelated deactivation changes nothing for a live member (the overreach control)', async () => {
    // LAW 29's shape: a "fix" that terminated every stream on any deactivation
    // would pass the red above. The member in good standing must keep receiving.
    expect(await until(() => bus.health().alive, 15_000)).toBe(true);
    const missionId = await createMissionWithThread();

    const fin = await openStream(tokens.fin);
    // Deactivate a user who is NOT the subscriber: a third seat minted for this.
    const third = await app.inject({
      method: 'POST',
      url: '/api/v1/dev/login',
      payload: { email: 'bystander@alpha.test', name: 'Bystander', role: 'visitor', tenantSlug: 'alpha' },
    });
    const me = await app.inject({ method: 'GET', url: '/api/v1/me', headers: auth((third.json() as { token: string }).token) });
    const bystanderId = (me.json() as { userId: string }).userId;
    await db.adminQuery(`UPDATE app_user SET is_active = false WHERE id = '${bystanderId}'`);

    await postToMission(missionId, 'life-goes-on');
    expect(await until(() => fin.frames.join('').includes('life-goes-on'))).toBe(true);
    expect(fin.ended()).toBe(false);
    fin.destroy();
  });
});
