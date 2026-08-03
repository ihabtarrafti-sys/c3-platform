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
  userId: '99999999-9999-9999-9999-999999999901',
  tenantId: '00000000-0000-0000-0000-0000000000aa',
  tenantSlug: 'geekay',
  role: 'owner',
  email: 'owner@geekay.com',
  displayName: 'Geekay Owner',
};

/**
 * A directory that COUNTS membership resolutions (CR-005).
 *
 * ⚖️ The count is the point. "Did it refuse?" and "did it refuse in the
 * VALIDATION phase?" are different questions, and only the second one detects a
 * deleted audience/issuer check — because deleting it does not stop the refusal,
 * it merely moves the refusal downstream to the empty directory.
 */
function spyDirectory(known: Map<string, ResolvedMembership>): {
  readonly directory: AdminDirectory;
  readonly resolutionCalls: number;
} {
  let resolutionCalls = 0;
  const base = fakeDirectory(known);
  const directory: AdminDirectory = {
    ...base,
    resolveMembership: async (key: ExternalIdentityKey) => {
      resolutionCalls += 1;
      return base.resolveMembership(key);
    },
  };
  return {
    directory,
    get resolutionCalls() {
      return resolutionCalls;
    },
  };
}

function fakeDirectory(known: Map<string, ResolvedMembership>): AdminDirectory {
  return {
    probe: async () => {},
    // Platform admission is not a tenant concern: these fakes exercise the TENANT
    // path, where the registry must never be consulted, and null is the honest answer.
    resolvePlatformPrincipal: async () => null,
    resolveTenantBySlug: async () => null,
    resolveMembership: async (key: ExternalIdentityKey) =>
      known.get(`${key.provider}|${key.issuerTenantId}|${key.subject}`) ?? null,
    resolveUserId: async (key: ExternalIdentityKey) =>
      known.get(`${key.provider}|${key.issuerTenantId}|${key.subject}`)?.userId ?? null,
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
    // The stable userId (uuid) likewise comes from the directory, never a claim.
    expect(principal).toMatchObject({
      userId: '99999999-9999-9999-9999-999999999901',
      identity: 'owner@geekay.com',
      role: 'owner',
      tenantSlug: 'geekay',
    });
  });

  /**
   * ⛔ CR-005. The previous version of this test asserted only
   * `.rejects.toThrow(AuthError)` against an adapter built with an EMPTY
   * directory — and `AccessNotProvisionedError extends AuthError` (`types.ts:74`).
   * So a token with a wrong audience sailed through `jwtVerify`, reached
   * membership resolution, found nothing, and threw `AccessNotProvisionedError`,
   * which satisfied the assertion.
   *
   * ⚖️ **MEASURED, NOT INFERRED: with `audience: config.audience` deleted from
   * `entra.ts`, the whole file still passed 10/10.** The test could not detect the
   * removal of the control it exists to guard.
   *
   * *A negative test whose fixture guarantees the assertion by a second route has
   * not tested the first one.* This matters more than its latency suggests: the
   * staging↔production authentication boundary was verified once, by hand, on
   * 2026-08-02. This test is the only STANDING guard on it.
   */
  it('⛔ rejects a wrong audience IN VALIDATION — never reaching membership resolution', async () => {
    const { keyResolver, sign } = await setup();
    const spy = spyDirectory(new Map());
    const adapter = createEntraAuthAdapter(CONFIG, spy.directory, keyResolver);

    const failure = await adapter
      .authenticate(await sign(GOOD_CLAIMS, { audience: 'api://other' }))
      .then(() => null, (err: unknown) => err);

    // 1 · the EXACT reason, not merely "some AuthError". This is the string
    // production actually returned when the boundary was probed by hand.
    expect(failure).toBeInstanceOf(AuthError);
    expect((failure as Error).message).toMatch(/unexpected "aud" claim value/);
    // …and NOT the class the empty fixture would have produced.
    expect(failure, 'a resolution failure is not an audience failure').not.toBeInstanceOf(
      AccessNotProvisionedError,
    );

    // 2 · THE STRUCTURAL HALF. An error-message match is a string comparison; an
    // unreached collaborator is a fact about control flow. This is what makes the
    // test fail when the audience check is deleted, because deletion lets the
    // token through to resolution.
    expect(spy.resolutionCalls, 'validation must refuse BEFORE the directory is consulted').toBe(0);
  });

  it('⛔ rejects a wrong issuer IN VALIDATION — never reaching membership resolution', async () => {
    const { keyResolver, sign } = await setup();
    const spy = spyDirectory(new Map());
    const adapter = createEntraAuthAdapter(CONFIG, spy.directory, keyResolver);

    const failure = await adapter
      .authenticate(await sign(GOOD_CLAIMS, { issuer: `https://login.microsoftonline.com/${OTHER_TENANT}/v2.0` }))
      .then(() => null, (err: unknown) => err);

    expect(failure).toBeInstanceOf(AuthError);
    expect((failure as Error).message).toMatch(/unexpected "iss" claim value/);
    expect(failure).not.toBeInstanceOf(AccessNotProvisionedError);
    expect(spy.resolutionCalls, 'validation must refuse BEFORE the directory is consulted').toBe(0);
  });

  it('⚖️ POSITIVE CONTROL: a valid token DOES reach resolution', async () => {
    // Without this, a universally broken adapter — one that threw on every token
    // before ever calling the directory — would satisfy both negatives above.
    // *A negative result is evidence only with a positive control beside it.*
    const { keyResolver, sign } = await setup();
    const spy = spyDirectory(new Map([[`entra|${TENANT}|${OID}`, membership]]));
    const adapter = createEntraAuthAdapter(CONFIG, spy.directory, keyResolver);

    const principal = await adapter.authenticate(await sign(GOOD_CLAIMS));

    expect(principal.identity).toBe('owner@geekay.com');
    expect(spy.resolutionCalls, 'the happy path must consult the directory exactly once').toBe(1);
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
