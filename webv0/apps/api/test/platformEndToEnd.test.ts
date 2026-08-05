/**
 * platformEndToEnd.test.ts — ONE test that drives the WHOLE platform path.
 *
 * ⚖️ LAW 34, and this file exists because of it. Every component of the platform
 * path was correct and tested — the registry resolver, the validator, the
 * capability check, the transitional predicate, the operation record — and
 * **nothing drove a request end to end.** Neural read the hook and concluded the
 * path was unreachable for the exact population `D-019` authorised: a service
 * principal with NO tenant membership. *Components each correct + composition
 * never exercised = a capability that does not exist.*
 *
 * ⛔ Neither of us could settle it by reading. This test settles it: a registered
 * platform principal, holding no tenant membership whatsoever, through
 * `buildApp` + `inject`, to the route, writing both identities.
 *
 * ⚖️ The question this answers is the one to ask of every finished chapter:
 * **which single test drives the whole path end to end?** *If the answer is a
 * list of unit tests, the capability is a hypothesis with good parts.*
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Client } from 'pg';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';
import { createPlatformAdmission } from '../src/auth/platformEntra';

const TENANT_GUID = 'aaaaaaaa-1111-2222-3333-444444444444';
const ISSUER = `https://login.microsoftonline.com/${TENANT_GUID}/v2.0`;
const PLATFORM_AUDIENCE = 'api://c3-platform-ops';
/** The service principal's object id — the ACTOR, never an app registration id. */
const SP_OID = 'cccccccc-1111-2222-3333-444444444444';
const OWNER_EMAIL = 'ihab@c3hq.org';

let db: TestDatabase;
let admin: Client;
let deps: Deps;
let app: FastifyInstance;
let platformToken: string;

beforeAll(async () => {
  db = await startTestDatabase();
  admin = new Client({ connectionString: db.adminUrl });
  await admin.connect();

  // A registered platform principal. ⛔ NO tenant, NO membership, NO role — this
  // is precisely the population `D-016a` says must be admitted by the PRESENCE
  // of its registration and by nothing else.
  await admin.query(
    `INSERT INTO platform_principal (provider, issuer, subject, kind, accountable_owner, capabilities)
     VALUES ('entra', $1, $2, 'service', $3, ARRAY['platform.backup_status.read']::text[])`,
    [ISSUER, SP_OID, OWNER_EMAIL],
  );

  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'dev',
    DEV_AUTH_SECRET: 'platform-e2e-secret-0123456789',
    DATABASE_URL: db.appUrl,
    DATABASE_ADMIN_URL: db.adminUrl,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));

  // The platform door, wired with a LOCAL keypair standing in for Entra's JWKS —
  // the same substitution `entra.test.ts` uses. Everything else is the real path.
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  deps.platformAdmission = createPlatformAdmission(
    { issuer: ISSUER, audience: PLATFORM_AUDIENCE, jwksUri: `https://login.microsoftonline.com/${TENANT_GUID}/discovery/v2.0/keys`, tenantId: TENANT_GUID },
    deps.directory!,
    createLocalJWKSet({ keys: [jwk] }),
  );

  // An app-only token: `idtyp: 'app'`, no human identity — refused by the tenant
  // validator by design, admissible here and only here.
  platformToken = await new SignJWT({ tid: TENANT_GUID, oid: SP_OID, idtyp: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(ISSUER)
    .setAudience(PLATFORM_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);

  app = buildApp(deps);
  await app.ready();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await deps?.close();
  await admin?.end().catch(() => {});
  await db?.stop();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('⛔ THE COMPOSITION — a tenant-less platform principal reaches the route', () => {
  it('reaches GET /settings/backup-status and is not refused by the tenant path', async () => {
    // THE FALSIFICATION. If the hook's `AccessNotProvisionedError` branch caught
    // this principal — as reading the code suggested it might — the response
    // would be 403 ACCESS_NOT_PROVISIONED and the capability would not exist.
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/backup-status',
      headers: auth(platformToken),
    });

    expect(res.statusCode, res.body).toBe(200);
    // The route answered honestly (nothing is configured in test), which is the
    // proof it RAN rather than being intercepted.
    expect(res.json()).toMatchObject({ configured: false });
  });

  it('⛔ and the operation is RECORDED with BOTH identities — criterion 2, exercised', async () => {
    // Criterion 2 cannot be discharged by a principal that cannot reach the
    // route. This is the only place both halves are proven at once: the platform
    // path is live AND the accountability record is written by a real request.
    await app.inject({ method: 'GET', url: '/api/v1/settings/backup-status', headers: auth(platformToken) });

    const rows = await admin.query<{ subject: string; kind: string; accountable_owner: string; capability: string }>(
      `SELECT subject, kind, accountable_owner, capability FROM platform_operation
        WHERE capability = 'platform.backup_status.read' ORDER BY at DESC LIMIT 1`,
    );
    expect(rows.rowCount, 'a platform request must leave a durable record').toBeGreaterThan(0);
    expect(rows.rows[0]).toMatchObject({
      subject: SP_OID,          // WHAT RAN
      accountable_owner: OWNER_EMAIL, // WHO ANSWERS
      kind: 'service',
      capability: 'platform.backup_status.read',
    });
  });

  it('⛔ holding ONE capability does not open the OTHER route', async () => {
    // This principal holds backup_status.read only. The erasure janitor is a
    // destructive platform-wide sweep and must refuse it — otherwise "registered"
    // would mean "omnipotent", and the closed vocabulary would be decoration.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/settings/erasure-janitor/run',
      headers: auth(platformToken),
    });
    expect(res.statusCode, res.body).toBe(403);
  });
});

describe('⛔ the tenant refusal is UNTOUCHED — a second door, not a hole', () => {
  it('an UNREGISTERED app-only token is still refused', async () => {
    // Same shape of token, same audience, no registry row. Admission is the
    // PRESENCE of a registration (`D-016a`) — so this must fail, and it must fail
    // without the platform path having widened anything.
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k2', alg: 'RS256', use: 'sig' };
    // A DIFFERENT key: this token cannot even validate, which is the outer layer.
    const stranger = await new SignJWT({ tid: TENANT_GUID, oid: 'unregistered-oid', idtyp: 'app' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k2' })
      .setIssuer(ISSUER)
      .setAudience(PLATFORM_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    void jwk;

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/backup-status',
      headers: auth(stranger),
    });
    expect([401, 403], res.body).toContain(res.statusCode);
  });

  it('a garbage bearer token is refused, and no platform record is written', async () => {
    const before = await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM platform_operation`);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/settings/backup-status',
      headers: auth('not-a-token'),
    });
    expect([401, 403]).toContain(res.statusCode);
    const after = await admin.query<{ n: string }>(`SELECT count(*)::text AS n FROM platform_operation`);
    expect(after.rows[0]!.n, 'a refused request must record nothing').toBe(before.rows[0]!.n);
  });
});
