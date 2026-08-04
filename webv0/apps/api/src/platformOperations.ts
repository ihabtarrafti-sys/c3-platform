/**
 * platformOperations.ts — reattribution: the two platform routes accept a
 * PLATFORM principal, and every platform operation records BOTH identities.
 *
 * ⚖️ `D-015` clause 3: tenant owners retain access DURING THE MIGRATION PERIOD.
 * So this is deliberately an OR, not a replacement — the platform path is added
 * beside the existing owner path, and owner standing is retired LAST, once the
 * platform path is certified against the five criteria. Removing it here would
 * take away a capability the owner uses today to close a risk that cannot occur
 * until a second tenant exists.
 *
 * ⛔ AND THE OR IS THE DANGEROUS SHAPE, SO IT IS WRITTEN TO BE DELETED. The
 * transitional arm is one clearly-named function with one call site per route;
 * `platformReattribution.test.ts` pins that removing it leaves the platform path
 * intact and tenant owners refused. *A transition period whose end condition is
 * unnamed does not end — this one's end is a two-line deletion and a test that
 * already describes the world after it.*
 */
import type { Pool } from 'pg';
import {
  assertPlatformCapability,
  hasPlatformCapability,
  type PlatformCapability,
  type PlatformPrincipal,
} from '@c3web/authz';
import type { Actor } from '@c3web/domain';

/**
 * ⛳ TRANSITIONAL (`D-015` clause 3) — DELETE THIS AT CERTIFICATION.
 *
 * A tenant owner may still reach the platform routes until the platform path is
 * certified. This is the ONLY place that is true, and it exists as a named
 * function so that retiring it is an unmistakable act rather than an edit
 * somewhere inside an authorization expression.
 */
export function tenantOwnerTransitionalAccess(actor: Actor | undefined): boolean {
  return actor?.role === 'owner';
}

export interface PlatformOperationContext {
  readonly principal: PlatformPrincipal | null;
  readonly actor: Actor | undefined;
}

/**
 * May this request exercise `capability`?
 *
 * ⛔ The platform arm is checked FIRST and on its own terms: a registered
 * principal holding the capability is admitted because of what it HOLDS
 * (`D-016a`), never because of anything it lacks. The tenant-owner arm is the
 * transitional fallback and nothing else.
 */
export function mayExercise(ctx: PlatformOperationContext, capability: PlatformCapability): boolean {
  if (hasPlatformCapability(ctx.principal, capability)) return true;
  return tenantOwnerTransitionalAccess(ctx.actor);
}

/**
 * Record a platform operation — BOTH identities, durably (`D-015` cert item 2).
 *
 * ⚖️ A log line is not a record: logs rotate, and the accountability standard was
 * ratified as a property of the OPERATION. *A service principal names WHAT RAN;
 * only the registered owner names WHO IS ANSWERABLE.*
 *
 * ⛔ The write is AWAITED and its failure PROPAGATES. Recording is not telemetry
 * decorating the operation — for a destructive platform sweep it is half the
 * authorisation: an operation that cannot be attributed must not be reported as
 * having succeeded. (For the transitional tenant-owner arm there is no platform
 * principal to record, and the existing tenant audit trail already covers it.)
 */
export async function recordPlatformOperation(
  pool: Pool,
  principal: PlatformPrincipal | null,
  capability: PlatformCapability,
  detail: Record<string, unknown> | null,
): Promise<void> {
  if (!principal) return;
  const [provider, issuer, subject] = splitPrincipalId(principal.principalId);
  await pool.query(
    `INSERT INTO platform_operation (provider, issuer, subject, kind, accountable_owner, capability, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [provider, issuer, subject, principal.kind, principal.accountableOwner, capability, detail ? JSON.stringify(detail) : null],
  );
}

/**
 * `principalId` is `provider:issuer:subject`, and the issuer is a URL that
 * itself contains colons — so this splits on the FIRST and LAST boundaries
 * rather than naively on every colon. A wrong split would file the operation
 * under an identity that never acted.
 */
function splitPrincipalId(principalId: string): [string, string, string] {
  const first = principalId.indexOf(':');
  const last = principalId.lastIndexOf(':');
  if (first < 0 || last <= first) return ['entra', '', principalId];
  return [principalId.slice(0, first), principalId.slice(first + 1, last), principalId.slice(last + 1)];
}

export { assertPlatformCapability };
