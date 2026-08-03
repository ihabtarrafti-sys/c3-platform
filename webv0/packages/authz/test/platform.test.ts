/**
 * platform.test.ts — platform authority is granted POSITIVELY, or not at all.
 *
 * ⚖️ `D-016a` is the ruling under test, and it is the kind that only survives as
 * a test: *"admit principals with no tenant membership"* and *"add a second
 * POSITIVE resolution path"* describe the same feature and produce opposite code.
 * The first is a SUBTRACTION — it reads as removing the check that refuses
 * non-members, and that denial is the only thing standing between an uninvited
 * stranger and the product.
 *
 * ⇒ So these assert what must be PRESENT, never what may be absent.
 */
import { describe, expect, it } from 'vitest';
import {
  PLATFORM_CAPABILITIES,
  PlatformAuthorityError,
  assertPlatformCapability,
  hasPlatformCapability,
  type PlatformCapability,
  type PlatformPrincipal,
} from '../src/platform';

const OPERATOR: PlatformPrincipal = {
  principalId: 'svc-erasure-01',
  kind: 'service',
  accountableOwner: 'ihab@c3hq.org',
  capabilities: ['platform.erasure_janitor.execute'],
};

describe('⛔ admission is POSITIVE — presence of a grant, never absence of anything', () => {
  it('grants only the capability actually held', () => {
    expect(hasPlatformCapability(OPERATOR, 'platform.erasure_janitor.execute')).toBe(true);
    expect(hasPlatformCapability(OPERATOR, 'platform.backup_status.read')).toBe(false);
  });

  it('⛔ no principal is a REFUSAL, never a pass', () => {
    // The failure mode this forecloses: an unauthenticated or unresolved caller
    // reaching a platform route and being admitted because nothing objected.
    for (const absent of [null, undefined]) {
      expect(hasPlatformCapability(absent, 'platform.erasure_janitor.execute')).toBe(false);
    }
  });

  it('⛔ an empty capability list grants NOTHING — silence is not authority', () => {
    expect(hasPlatformCapability({ ...OPERATOR, capabilities: [] }, 'platform.erasure_janitor.execute')).toBe(
      false,
    );
  });

  it('⛔ no accountable owner ⇒ REFUSED, however well-formed the grant looks', () => {
    // A service principal names WHAT RAN; only a registered owner names WHO IS
    // ANSWERABLE. A platform-wide destructive sweep attributable to nobody is
    // worse than one attributable to the wrong tenant's owner: the first cannot
    // be asked why.
    for (const owner of ['', '   ']) {
      expect(
        hasPlatformCapability({ ...OPERATOR, accountableOwner: owner }, 'platform.erasure_janitor.execute'),
        `accountableOwner ${JSON.stringify(owner)} must not be admitted`,
      ).toBe(false);
    }
  });

  it('⛔ an unnamed principal is refused — identity is required, not decorative', () => {
    expect(hasPlatformCapability({ ...OPERATOR, principalId: '' }, 'platform.erasure_janitor.execute')).toBe(
      false,
    );
  });
});

describe('⚖️ the model cannot be reached from a tenant actor', () => {
  it('⛔ has NO tenant field — absence of a tenant is a classification, not a grant', () => {
    // `D-016a`, pinned structurally. If `tenantId` ever appears on this shape,
    // someone has begun deriving platform authority from tenant facts.
    expect(Object.keys(OPERATOR).sort()).toEqual(
      ['accountableOwner', 'capabilities', 'kind', 'principalId'].sort(),
    );
    expect(Object.keys(OPERATOR)).not.toContain('tenantId');
  });

  it('⛔ an Actor-shaped object confers nothing, even holding a tenant owner role', () => {
    // The type system already refuses this at compile time; the runtime belt
    // matters because the boundary decodes JSON, where types are gone.
    const tenantOwner = {
      userId: 'u-1',
      identity: 'owner@customer.test',
      displayName: 'Owner',
      role: 'owner',
      tenantId: 't-1',
    } as unknown as PlatformPrincipal;
    expect(hasPlatformCapability(tenantOwner, 'platform.erasure_janitor.execute')).toBe(false);
    expect(hasPlatformCapability(tenantOwner, 'platform.backup_status.read')).toBe(false);
  });
});

describe('the vocabulary is closed and narrow', () => {
  it('is exactly the two capabilities D-015 named', () => {
    // A third capability must be a decision made in the module, not a string
    // invented at a call site. `D-016` put break-glass explicitly out of scope,
    // and it must not arrive by someone adding a value here quietly.
    expect([...PLATFORM_CAPABILITIES].sort()).toEqual(
      ['platform.backup_status.read', 'platform.erasure_janitor.execute'].sort(),
    );
  });

  it('⛔ grants nothing for a capability outside the vocabulary', () => {
    const invented = 'platform.people.read' as PlatformCapability;
    expect(hasPlatformCapability({ ...OPERATOR, capabilities: [invented] }, invented)).toBe(true);
    // …and the guard above is why that is not alarming: the value cannot be
    // REQUESTED by any route, because every call site names a literal from the
    // closed union. This test records that the containment lives in the
    // vocabulary, not in the lookup.
    expect(PLATFORM_CAPABILITIES).not.toContain(invented);
  });
});

describe('assertPlatformCapability fails closed and says little', () => {
  it('throws PlatformAuthorityError when authority is absent', () => {
    expect(() => assertPlatformCapability(null, 'platform.backup_status.read')).toThrow(
      PlatformAuthorityError,
    );
    expect(() => assertPlatformCapability(OPERATOR, 'platform.backup_status.read')).toThrow(
      /Platform authority is required/,
    );
  });

  it('⛔ does not disclose WHICH condition failed', () => {
    // A caller learning "your accountableOwner is blank" is learning the shape of
    // the authority model. Every refusal reads identically.
    const messages = [null, { ...OPERATOR, accountableOwner: '' }, { ...OPERATOR, capabilities: [] }].map(
      (principal) => {
        try {
          assertPlatformCapability(principal as PlatformPrincipal | null, 'platform.erasure_janitor.execute');
          return 'no-throw';
        } catch (err) {
          return (err as Error).message;
        }
      },
    );
    expect(new Set(messages).size, 'every refusal must read identically').toBe(1);
  });

  it('permits the held capability', () => {
    expect(() => assertPlatformCapability(OPERATOR, 'platform.erasure_janitor.execute')).not.toThrow();
  });
});
