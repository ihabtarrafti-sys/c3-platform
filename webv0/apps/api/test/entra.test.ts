/**
 * entra.test.ts — Entra token-validation boundary WITHOUT real Entra
 * credentials: a locally-generated RS256 keypair + local JWKS stand in for the
 * tenant's signing keys. Covers signature/issuer/audience/algorithm
 * enforcement and the Phase 2B claim rules: tid required+pinned, oid required,
 * delegated scp with C3.Access required, application-only rejected, and
 * role/group claims never granting authority.
 */
import { describe, it, expect } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { createEntraAuthAdapter, validateEntraClaims, type EntraConfig } from '../src/auth/entra';
import { AuthError, AccessNotProvisionedError } from '../src/auth/types';
import type { AdminDirectory, ExternalIdentityKey, ResolvedMembership } from '../src/auth/directory';

const TENANT = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER_TENANT = 'bbbbbbbb-1111-2222-3333-444444444444';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const AUDIENCE = 'api://c3web-staging';
const OID = 'cccccccc-1111-2222-3333-444444444444';

const CONFIG: EntraConfig = { issuer: ISSUER, audience: AUDIENCE, jwksUri: 'https://unused', tenantId: TENANT, scope: 'C3.Access' };

const membership: ResolvedMembership = {
  tenantId: '00000000-0000-0000-0000-0000000000aa',
  tenantSlug: 'geekay',
  role: 'owner',
  email: 'owner@geekay.com',
  displayName: 'Geekay Owner',
};

function fakeDirectory(known: Map<string, ResolvedMembership>): AdminDirectory {
  return {
    resolveTenantBySlug: async () => null,
    resolveMembership: async (key: ExternalIdentityKey) =>
      known.get(`${key.provider}|${key.issuerTenantId}|${key.subject}`) ?? null,
    upsertDevMembership: async () => {},
    close: async () => {},
  };
}

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const keyResolver = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, opts?: { issuer?: string; audience?: string }) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(opts?.issuer ?? ISSUER)
      .setAudience(opts?.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  return { keyResolver, sign };
}

const GOOD_CLAIMS = { tid: TENANT, oid: OID, scp: 'C3.Access', preferred_username: 'anything@anywhere.com', name: 'Token Name' };

describe('validateEntraClaims (pure claim rules)', () => {
  it('accepts a delegated token with tid+oid+C3.Access', () => {
    expect(validateEntraClaims(GOOD_CLAIMS, CONFIG)).toEqual({ tid: TENANT, oid: OID });
  });
  it('rejects a token without tid', () => {
    const { tid: _t, ...noTid } = GOOD_CLAIMS;
    expect(() => validateEntraClaims(noTid, CONFIG)).toThrow(/missing tid/);
  });
  it('rejects a token without oid', () => {
    const { oid: _o, ...noOid } = GOOD_CLAIMS;
    expect(() => validateEntraClaims(noOid, CONFIG)).toThrow(/missing oid/);
  });
  it('rejects a token for another tenant', () => {
    expect(() => validateEntraClaims({ ...GOOD_CLAIMS, tid: OTHER_TENANT }, CONFIG)).toThrow(/different tenant/);
  });
  it('rejects a token lacking the C3.Access scope', () => {
    expect(() => validateEntraClaims({ ...GOOD_CLAIMS, scp: 'User.Read openid' }, CONFIG)).toThrow(/C3\.Access/);
    const { scp: _s, ...noScp } = GOOD_CLAIMS;
    expect(() => validateEntraClaims(noScp, CONFIG)).toThrow(/C3\.Access/);
  });
  it('rejects application-only tokens (idtyp=app)', () => {
    expect(() => validateEntraClaims({ ...GOOD_CLAIMS, idtyp: 'app' }, CONFIG)).toThrow(/application-only/);
  });
});

describe('createEntraAuthAdapter (signature + resolution)', () => {
  it('accepts a valid token for a provisioned identity and resolves the DB profile', async () => {
    const { keyResolver, sign } = await setup();
    const known = new Map([[`entra|${TENANT}|${OID}`, membership]]);
    const adapter = createEntraAuthAdapter(CONFIG, fakeDirectory(known), keyResolver);
    const principal = await adapter.authenticate(await sign(GOOD_CLAIMS));
    // Identity comes from the DIRECTORY, not the token's preferred_username.
    expect(principal).toMatchObject({ identity: 'owner@geekay.com', role: 'owner', tenantSlug: 'geekay' });
  });

  it('rejects a wrong audience and a wrong issuer', async () => {
    const { keyResolver, sign } = await setup();
    const adapter = createEntraAuthAdapter(CONFIG, fakeDirectory(new Map()), keyResolver);
    await expect(adapter.authenticate(await sign(GOOD_CLAIMS, { audience: 'api://other' }))).rejects.toThrow(AuthError);
    await expect(
      adapter.authenticate(await sign(GOOD_CLAIMS, { issuer: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` })),
    ).rejects.toThrow(AuthError);
  });

  it('token role/group claims grant NOTHING (unprovisioned identity fails closed)', async () => {
    const { keyResolver, sign } = await setup();
    const adapter = createEntraAuthAdapter(CONFIG, fakeDirectory(new Map()), keyResolver);
    const forged = await sign({ ...GOOD_CLAIMS, roles: ['owner'], groups: ['C3 Owners'], wids: ['x'], c3_role: 'owner' });
    await expect(adapter.authenticate(forged)).rejects.toThrow(AccessNotProvisionedError);
  });

  it('cross-tenant identity collision: same oid under another tid is a DIFFERENT identity', async () => {
    const { keyResolver, sign } = await setup();
    // Only (TENANT, OID) is provisioned; a token from OTHER_TENANT with the
    // same oid is rejected at the tid gate — the collision can never reach the
    // provisioned membership.
    const known = new Map([[`entra|${TENANT}|${OID}`, membership]]);
    const adapter = createEntraAuthAdapter(CONFIG, fakeDirectory(known), keyResolver);
    await expect(adapter.authenticate(await sign({ ...GOOD_CLAIMS, tid: OTHER_TENANT }))).rejects.toThrow(/different tenant/);
  });
});
