/**
 * devIdp.test.ts — the dev IdP adapter's SERVER-resolved userId (Comms Phase 1).
 *
 * The stable userId is NEVER taken from the (self-asserted) dev token — it is
 * resolved from the immutable dev identity binding via the directory, keyed by
 * the RAW token subject (the exact string /dev/login stored), and FAILS CLOSED
 * when the identity is not provisioned.
 */
import { describe, it, expect } from 'vitest';
import { createDevAuthAdapter, signDevToken } from '../src/auth/devIdp';
import { AuthError } from '../src/auth/types';
import type { AdminDirectory, ExternalIdentityKey } from '../src/auth/directory';

const SECRET = 'dev-secret-under-test';
const TENANT = '00000000-0000-0000-0000-0000000000aa';
const USER_ID = '77777777-7777-7777-7777-777777777777';

function fakeDirectory(resolve: (key: ExternalIdentityKey) => string | null): AdminDirectory {
  return {
    resolveTenantBySlug: async () => null,
    resolveMembership: async () => null,
    resolveUserId: async (key: ExternalIdentityKey) => resolve(key),
    upsertDevMembership: async () => {},
    close: async () => {},
  };
}

describe('dev IdP adapter — server-resolved participant userId', () => {
  it('resolves the stable userId from the directory (not the token), keyed by the RAW subject', async () => {
    let seenKey: ExternalIdentityKey | undefined;
    const adapter = createDevAuthAdapter(SECRET, fakeDirectory((key) => {
      seenKey = key;
      return USER_ID;
    }));
    // Mixed-case email: the binding subject is the RAW value, while the actor
    // identity is canonicalized — the adapter must resolve by the raw subject so
    // it matches what /dev/login stored, regardless of case.
    const token = await signDevToken(SECRET, {
      identity: 'Owner@Geekay.com',
      displayName: 'Owner',
      role: 'owner',
      tenantId: TENANT,
      tenantSlug: 'geekay',
    });
    const principal = await adapter.authenticate(token);

    expect(principal.userId).toBe(USER_ID); // from the directory, never the token
    expect(principal.identity).toBe('owner@geekay.com'); // canonicalized
    expect(seenKey).toEqual({ provider: 'dev', issuerTenantId: 'dev', subject: 'Owner@Geekay.com' });
    expect(principal).toMatchObject({ role: 'owner', tenantId: TENANT, tenantSlug: 'geekay' });
  });

  it('FAILS CLOSED when the identity is not provisioned — never fabricates a userId', async () => {
    const adapter = createDevAuthAdapter(SECRET, fakeDirectory(() => null));
    const token = await signDevToken(SECRET, {
      identity: 'ghost@nowhere.com',
      displayName: 'Ghost',
      role: 'owner',
      tenantId: TENANT,
      tenantSlug: 'geekay',
    });
    await expect(adapter.authenticate(token)).rejects.toThrow(AuthError);
  });
});
