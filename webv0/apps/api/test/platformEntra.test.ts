/**
 * platformEntra.test.ts — the second door refuses what the first one refuses,
 * for its own reasons (`D-019`).
 *
 * ⚖️ The property under test is not "app-only tokens work now". It is that
 * opening this door did NOT widen the tenant one: `entra.ts:52` still rejects
 * `idtyp: 'app'`, and the audience separates the two surfaces so a token good for
 * one is useless at the other.
 */
import { describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { createPlatformAdmission, type PlatformEntraConfig } from '../src/auth/platformEntra';
import { createEntraAuthAdapter } from '../src/auth/entra';
import { AuthError } from '../src/auth/types';
import type { AdminDirectory, PlatformIdentityKey } from '../src/auth/directory';
import type { PlatformPrincipal } from '@c3web/authz';

const TENANT = 'aaaaaaaa-1111-2222-3333-444444444444';
const OTHER_TENANT = 'bbbbbbbb-1111-2222-3333-444444444444';
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const PLATFORM_AUDIENCE = 'api://c3-platform-ops';
const TENANT_API_AUDIENCE = 'api://c3web-staging';
const SP_OID = 'cccccccc-1111-2222-3333-444444444444';

const CONFIG: PlatformEntraConfig = {
  issuer: ISSUER,
  audience: PLATFORM_AUDIENCE,
  jwksUri: 'https://unused',
  tenantId: TENANT,
};

const REGISTERED: PlatformPrincipal = {
  principalId: `entra:${ISSUER}:${SP_OID}`,
  kind: 'service',
  accountableOwner: 'ihab@c3hq.org',
  capabilities: ['platform.erasure_janitor.execute'],
};

/** A registry holding exactly the subjects given — everything else is unknown. */
function registry(known: Map<string, PlatformPrincipal>): { directory: AdminDirectory; lookups: string[] } {
  const lookups: string[] = [];
  const directory = {
    probe: async () => {},
    resolvePlatformPrincipal: async (key: PlatformIdentityKey) => {
      lookups.push(key.subject);
      return known.get(key.subject) ?? null;
    },
    resolveTenantBySlug: async () => null,
    resolveMembership: async () => null,
    resolveUserId: async () => null,
    upsertDevMembership: async () => {},
    close: async () => {},
  } as unknown as AdminDirectory;
  return { directory, lookups };
}

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  const keyResolver = createLocalJWKSet({ keys: [jwk] });
  const sign = (claims: Record<string, unknown>, audience = PLATFORM_AUDIENCE) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  return { keyResolver, sign };
}

/** A service principal's token: app-only, which the TENANT validator refuses. */
const APP_ONLY = { tid: TENANT, oid: SP_OID, idtyp: 'app' };

describe('⛳ app-only tokens are admitted HERE, and the registry decides', () => {
  it('a registered service principal is admitted with its granted capabilities', async () => {
    const { keyResolver, sign } = await setup();
    const admission = createPlatformAdmission(CONFIG, registry(new Map([[SP_OID, REGISTERED]])).directory, keyResolver);

    const principal = await admission.admit(await sign(APP_ONLY));

    expect(principal).not.toBeNull();
    expect(principal!.accountableOwner).toBe('ihab@c3hq.org');
    expect(principal!.capabilities).toEqual(['platform.erasure_janitor.execute']);
  });

  it('⛔ a VALID token for an UNREGISTERED principal resolves to null — the token is not the authority', async () => {
    // The whole of `D-016a` in one case: authenticating successfully proves who
    // is calling and grants nothing. Admission is the PRESENCE of a row.
    const { keyResolver, sign } = await setup();
    const admission = createPlatformAdmission(CONFIG, registry(new Map()).directory, keyResolver);

    expect(await admission.admit(await sign(APP_ONLY))).toBeNull();
  });

  it('the registry is keyed on the token SUBJECT, not on an app id', async () => {
    // `D-019`: a second trust root must later be a row and an adapter. Keying on
    // `oid` (the acting principal) rather than `appid` also matters now — one app
    // registration can back more than one principal, and the row must name the
    // actor that ran.
    const { keyResolver, sign } = await setup();
    const reg = registry(new Map([[SP_OID, REGISTERED]]));
    const admission = createPlatformAdmission(CONFIG, reg.directory, keyResolver);

    await admission.admit(await sign({ ...APP_ONLY, appid: 'some-app-registration' }));
    expect(reg.lookups).toEqual([SP_OID]);
  });
});

describe('⛔ opening this door did NOT widen the tenant one', () => {
  it('the SAME app-only token the platform admits is REFUSED by the tenant validator', async () => {
    // ⚖️ THE LOAD-BEARING CROSS-CHECK. `entra.ts:52` rejects `idtyp: 'app'`, and
    // that check lives in the SHARED claim validator — so the tempting way to
    // support service principals was to relax it. That would have admitted
    // human-less tokens to every TENANT route as a side effect.
    //
    // One token, two doors, opposite outcomes. If this ever stops throwing, the
    // separate door has become a hole in the existing one.
    const { keyResolver, sign } = await setup();
    const token = await sign(APP_ONLY);

    const platform = createPlatformAdmission(CONFIG, registry(new Map([[SP_OID, REGISTERED]])).directory, keyResolver);
    expect(await platform.admit(token), 'the platform door admits it').not.toBeNull();

    const tenant = createEntraAuthAdapter(
      { issuer: ISSUER, audience: PLATFORM_AUDIENCE, jwksUri: 'https://unused', tenantId: TENANT, scope: 'C3.Access' },
      registry(new Map()).directory,
      keyResolver,
    );
    // Audience deliberately matched here so the ONLY thing refusing it is the
    // app-only rule — otherwise this would pass for the wrong reason.
    await expect(tenant.authenticate(token), 'the tenant door must still refuse it').rejects.toThrow(
      /application-only/,
    );
  });
});

describe('⛔ the audience is the lock — the two surfaces do not share tokens', () => {
  it('a token minted for the TENANT API is refused here', async () => {
    // If this ever passes, the second door has become a hole in the first: a
    // tenant-API token would carry platform authority.
    const { keyResolver, sign } = await setup();
    const admission = createPlatformAdmission(CONFIG, registry(new Map([[SP_OID, REGISTERED]])).directory, keyResolver);

    await expect(admission.admit(await sign(APP_ONLY, TENANT_API_AUDIENCE))).rejects.toThrow(
      /unexpected "aud" claim value/,
    );
  });

  it('⛔ refuses BEFORE consulting the registry — validation precedes authority', async () => {
    // The `CR-005` shape, pre-empted on the new door: a refusal that happens for
    // the right reason, proven by the collaborator never being reached.
    const { keyResolver, sign } = await setup();
    const reg = registry(new Map([[SP_OID, REGISTERED]]));
    const admission = createPlatformAdmission(CONFIG, reg.directory, keyResolver);

    await expect(admission.admit(await sign(APP_ONLY, TENANT_API_AUDIENCE))).rejects.toThrow(AuthError);
    expect(reg.lookups, 'the registry must not be consulted for an inadmissible token').toEqual([]);
  });

  it('refuses a token from a different Entra directory', async () => {
    const { keyResolver, sign } = await setup();
    const reg = registry(new Map([[SP_OID, REGISTERED]]));
    const admission = createPlatformAdmission(CONFIG, reg.directory, keyResolver);

    await expect(admission.admit(await sign({ ...APP_ONLY, tid: OTHER_TENANT }))).rejects.toThrow(
      /different tenant/,
    );
    expect(reg.lookups).toEqual([]);
  });

  it('refuses a token with no oid — an unnamed actor cannot be looked up', async () => {
    const { keyResolver, sign } = await setup();
    const reg = registry(new Map());
    const admission = createPlatformAdmission(CONFIG, reg.directory, keyResolver);

    await expect(admission.admit(await sign({ tid: TENANT, idtyp: 'app' }))).rejects.toThrow(/missing oid/);
    expect(reg.lookups).toEqual([]);
  });
});
