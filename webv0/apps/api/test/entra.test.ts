/**
 * entra.test.ts — proves the Entra OIDC boundary WITHOUT real Entra credentials:
 * a locally-generated RS256 keypair + local JWKS stand in for the tenant's
 * signing keys. Verifies signature/issuer/audience enforcement and the
 * provider-claim → canonical-identity translation, then membership resolution.
 */
import { describe, it, expect } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { createEntraAuthAdapter, translateEntraIdentity } from '../src/auth/entra';
import { AuthError } from '../src/auth/types';
import type { AdminDirectory, Membership } from '../src/auth/directory';

const ISSUER = 'https://login.microsoftonline.com/test-tenant/v2.0';
const AUDIENCE = 'api://c3web';

const fakeDirectory = (membership: Membership | null): AdminDirectory => ({
  resolveTenantBySlug: async () => null,
  upsertMembership: async () => {},
  resolveMembership: async (email) => (email === 'user@geekay.com' ? membership : null),
  close: async () => {},
});

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

describe('translateEntraIdentity', () => {
  it('prefers preferred_username, falls back to upn then email; canonicalises', () => {
    expect(translateEntraIdentity({ preferred_username: 'User@Geekay.com', name: 'U' })).toEqual({ identity: 'user@geekay.com', displayName: 'U' });
    expect(translateEntraIdentity({ upn: 'a@b.com' }).identity).toBe('a@b.com');
    expect(translateEntraIdentity({ email: 'c@d.com' }).identity).toBe('c@d.com');
  });
  it('fails closed when no usable identity claim is present', () => {
    expect(() => translateEntraIdentity({ name: 'no-id' })).toThrow(AuthError);
  });
});

describe('createEntraAuthAdapter', () => {
  it('accepts a validly-signed token and resolves membership to a principal', async () => {
    const { keyResolver, sign } = await setup();
    const adapter = createEntraAuthAdapter(
      { issuer: ISSUER, audience: AUDIENCE, jwksUri: 'https://unused' },
      fakeDirectory({ tenantId: '00000000-0000-0000-0000-0000000000aa', tenantSlug: 'geekay', role: 'owner' }),
      keyResolver,
    );
    const token = await sign({ preferred_username: 'user@geekay.com', name: 'Geekay Owner' });
    const principal = await adapter.authenticate(token);
    expect(principal).toMatchObject({ identity: 'user@geekay.com', role: 'owner', tenantSlug: 'geekay' });
  });

  it('rejects a wrong audience', async () => {
    const { keyResolver, sign } = await setup();
    const adapter = createEntraAuthAdapter({ issuer: ISSUER, audience: AUDIENCE, jwksUri: 'x' }, fakeDirectory(null), keyResolver);
    const token = await sign({ preferred_username: 'user@geekay.com' }, { audience: 'api://other' });
    await expect(adapter.authenticate(token)).rejects.toThrow(AuthError);
  });

  it('rejects a wrong issuer', async () => {
    const { keyResolver, sign } = await setup();
    const adapter = createEntraAuthAdapter({ issuer: ISSUER, audience: AUDIENCE, jwksUri: 'x' }, fakeDirectory(null), keyResolver);
    const token = await sign({ preferred_username: 'user@geekay.com' }, { issuer: 'https://evil/v2.0' });
    await expect(adapter.authenticate(token)).rejects.toThrow(AuthError);
  });

  it('refuses a validly-signed token with no C3 membership', async () => {
    const { keyResolver, sign } = await setup();
    const adapter = createEntraAuthAdapter({ issuer: ISSUER, audience: AUDIENCE, jwksUri: 'x' }, fakeDirectory(null), keyResolver);
    const token = await sign({ preferred_username: 'stranger@elsewhere.com' });
    await expect(adapter.authenticate(token)).rejects.toThrow(AuthError);
  });
});
