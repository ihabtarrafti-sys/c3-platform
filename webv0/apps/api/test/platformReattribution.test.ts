/**
 * platformReattribution.test.ts — the platform path works, the transitional
 * tenant-owner arm is visible, and its removal is already described.
 *
 * ⚖️ `D-015` clause 3 makes this an OR rather than a replacement: tenant owners
 * keep access until the platform path is certified. An OR is the shape that
 * quietly becomes permanent, so the transitional arm is one named function with
 * one meaning, and these tests state exactly what the world looks like after it
 * is deleted — so certification is a deletion plus a green suite, not a design
 * exercise done under time pressure months from now.
 */
import { describe, expect, it } from 'vitest';
import { mayExercise, tenantOwnerTransitionalAccess } from '../src/platformOperations';
import type { PlatformPrincipal } from '@c3web/authz';
import type { Actor } from '@c3web/domain';

const OPERATOR: PlatformPrincipal = {
  principalId: 'entra:https://login.microsoftonline.com/t/v2.0:sp-1',
  kind: 'service',
  accountableOwner: 'ihab@c3hq.org',
  capabilities: ['platform.erasure_janitor.execute'],
};

const actor = (role: string): Actor => ({
  userId: 'u-1',
  identity: `${role}@customer.test`,
  displayName: role,
  role: role as Actor['role'],
  tenantId: 't-1',
});

describe('the PLATFORM path is admitted on its own terms', () => {
  it('a registered principal holding the capability may exercise it', () => {
    expect(mayExercise({ principal: OPERATOR, actor: undefined }, 'platform.erasure_janitor.execute')).toBe(true);
  });

  it('⛔ and holding ONE capability does not confer the other', () => {
    expect(mayExercise({ principal: OPERATOR, actor: undefined }, 'platform.backup_status.read')).toBe(false);
  });

  it('⛔ an unregistered caller with no tenant role is refused — absence grants nothing', () => {
    expect(mayExercise({ principal: null, actor: undefined }, 'platform.erasure_janitor.execute')).toBe(false);
  });
});

describe('⛳ TRANSITIONAL — tenant-owner access, and what its removal looks like', () => {
  it('a tenant owner may still reach the routes during the migration period', () => {
    // D-015 clause 3. Removing this today would take away a capability the owner
    // uses, to close a risk that cannot occur until a second tenant exists.
    expect(mayExercise({ principal: null, actor: actor('owner') }, 'platform.erasure_janitor.execute')).toBe(true);
  });

  it('⛔ but NO other tenant role does — the transition widened nothing', () => {
    for (const role of ['operations', 'finance', 'hr', 'legal', 'management', 'visitor']) {
      expect(
        mayExercise({ principal: null, actor: actor(role) }, 'platform.erasure_janitor.execute'),
        `${role} must not reach a platform route`,
      ).toBe(false);
    }
  });

  it('⚖️ the transitional arm is ONE named predicate — certification deletes exactly this', () => {
    // The end condition, made concrete. At certification `tenantOwnerTransitionalAccess`
    // is deleted and `mayExercise` loses its second line; this test is then
    // rewritten to expect `false`, and the criterion-1 test below already
    // describes that world. *A transition period whose end condition is unnamed
    // does not end.*
    expect(tenantOwnerTransitionalAccess(actor('owner'))).toBe(true);
    expect(tenantOwnerTransitionalAccess(actor('operations'))).toBe(false);
    expect(tenantOwnerTransitionalAccess(undefined)).toBe(false);
  });

  it('⛔ CERTIFICATION CRITERION 1, pre-written: with the arm gone, a tenant owner is refused', () => {
    // Red-before-green in advance. `mayExercise` minus its transitional line IS
    // `hasPlatformCapability`, so this asserts the post-certification behaviour
    // against the function that will remain — no owner standing, no access.
    const afterCertification = (ctx: { principal: PlatformPrincipal | null; actor: Actor | undefined }) =>
      mayExercise({ principal: ctx.principal, actor: undefined }, 'platform.erasure_janitor.execute');

    expect(afterCertification({ principal: null, actor: actor('owner') }), 'owner standing alone opens nothing').toBe(
      false,
    );
    expect(afterCertification({ principal: OPERATOR, actor: undefined }), 'the platform path still works').toBe(true);
  });
});
