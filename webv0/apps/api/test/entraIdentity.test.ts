/**
 * entraIdentity.test.ts — Entra membership resolution against the REAL C3
 * identity tables (embedded PostgreSQL) with a local JWKS. Proves the
 * immutable-identity model end to end:
 *   - membership binds to (provider='entra', tid, oid), never to email;
 *   - mutable token email/name changes preserve membership and role;
 *   - unknown identity and inactive user fail closed (truthful 403);
 *   - known Owner/Operations resolve to their C3 roles from the DB;
 *   - no auto-provisioning from a valid token.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { Client } from 'pg';
import { startTestDatabase, type TestDatabase } from '@c3web/test-support';
import { loadEnv } from '../src/env';
import { createLogger } from '../src/logger';
import { buildDeps, type Deps } from '../src/deps';
import { buildApp } from '../src/app';
import { createEntraAuthAdapter } from '../src/auth/entra';

const TID = 'aaaaaaaa-1111-2222-3333-444444444444';
const ISSUER = `https://login.microsoftonline.com/${TID}/v2.0`;
const AUD = 'api://c3web-staging';
const OWNER_OID = '11111111-aaaa-bbbb-cccc-000000000001';
const OPS_OID = '11111111-aaaa-bbbb-cccc-000000000002';
const STRANGER_OID = '11111111-aaaa-bbbb-cccc-00000000dead';

let db: TestDatabase;
let deps: Deps;
let app: FastifyInstance;
let sign: (claims: Record<string, unknown>) => Promise<string>;

beforeAll(async () => {
  db = await startTestDatabase();

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const keyResolver = createLocalJWKSet({ keys: [jwk] });
  sign = (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

  const env = loadEnv({
    NODE_ENV: 'test',
    AUTH_PROVIDER: 'entra',
    ENTRA_TENANT_ID: TID,
    ENTRA_ISSUER: ISSUER,
    ENTRA_AUDIENCE: AUD,
    ENTRA_JWKS_URI: 'https://unused.example/keys',
    DATABASE_URL: db.appUrl,
    DATABASE_AUTH_URL: db.authUrl,
  } as NodeJS.ProcessEnv);
  deps = buildDeps(env, createLogger(env));
  // Swap ONLY the JWKS source for the locally-generated keypair; the directory,
  // claim validation, and membership resolution are the real production path.
  deps.authAdapter = createEntraAuthAdapter(env.entra!, deps.directory!, keyResolver);
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
  await db.seedTenant({
    slug: 'geekay',
    users: [
      { key: 'owner', email: 'owner@geekay.com', displayName: 'Ihab', role: 'owner', entra: { tid: TID, oid: OWNER_OID } },
      { key: 'ops', email: 'ops@geekay.com', displayName: 'Khalailah', role: 'operations', entra: { tid: TID, oid: OPS_OID } },
    ],
  });
});

const me = (token: string) => app.inject({ method: 'GET', url: '/api/v1/me', headers: { authorization: `Bearer ${token}` } });
const claims = (oid: string, extra: Record<string, unknown> = {}) => ({ tid: TID, oid, scp: 'C3.Access', name: 'Token Name', ...extra });

describe('membership resolution by immutable (tid, oid)', () => {
  it('known Owner resolves Owner from the C3 database', async () => {
    const res = await me(await sign(claims(OWNER_OID)));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ role: 'owner', tenantSlug: 'geekay', identity: 'owner@geekay.com' });
  });

  it('known Operations resolves Operations', async () => {
    const res = await me(await sign(claims(OPS_OID)));
    expect(res.json()).toMatchObject({ role: 'operations', tenantSlug: 'geekay' });
  });

  it('a mutated token email/name preserves membership, role AND canonical identity', async () => {
    const res = await me(await sign(claims(OPS_OID, { preferred_username: 'renamed@elsewhere.com', email: 'renamed@elsewhere.com', name: 'Totally Renamed' })));
    expect(res.statusCode).toBe(200);
    // Same role, same tenant, and identity is the DB-stored profile email.
    expect(res.json()).toMatchObject({ role: 'operations', tenantSlug: 'geekay', identity: 'ops@geekay.com' });
  });

  it('unknown tid+oid fails closed with a truthful access-not-provisioned 403 (no auto-create)', async () => {
    const res = await me(await sign(claims(STRANGER_OID)));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCESS_NOT_PROVISIONED');
    // And nothing was auto-provisioned:
    const c = new Client({ connectionString: db.adminUrl });
    await c.connect();
    try {
      const r = await c.query('SELECT count(*)::int AS n FROM external_identity WHERE subject = $1', [STRANGER_OID]);
      expect(r.rows[0].n).toBe(0);
    } finally {
      await c.end();
    }
  });

  it('an inactive user fails closed even with a valid token and existing membership', async () => {
    const c = new Client({ connectionString: db.adminUrl });
    await c.connect();
    try {
      await c.query(`UPDATE app_user SET is_active = false WHERE email = 'ops@geekay.com'`);
    } finally {
      await c.end();
    }
    const res = await me(await sign(claims(OPS_OID)));
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('ACCESS_NOT_PROVISIONED');
  });

  it('token roles/groups claims cannot escalate a provisioned operations identity', async () => {
    const res = await me(await sign(claims(OPS_OID, { roles: ['owner'], groups: ['C3 Owners'], wids: ['admin'] })));
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('operations'); // DB role wins; claims ignored
  });

  it('the dev-login route does not exist under the entra provider', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/dev/login', payload: { email: 'x@y.com', role: 'owner', tenantSlug: 'geekay' } });
    expect(res.statusCode).toBe(404);
  });
});
