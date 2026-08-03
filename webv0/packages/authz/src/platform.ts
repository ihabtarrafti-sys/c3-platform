/**
 * platform.ts — platform-level authority, which is NOT tenant membership.
 *
 * ⚖️ `D-015`/`D-016a`. The defect this exists to remove: `backup-status` and
 * `erasure-janitor/run` act platform-wide while being gated on a TENANT ROLE.
 * Under one tenant "owner of a tenant" and "platform operator" are the same
 * person, so both are correct BY ACCIDENT. The moment a second tenant exists,
 * tenant A's owner can read tenant B's backup state and sweep tenant B's data.
 *
 * ⛔ IT WAS NEVER A MISSING ENUM VALUE — IT IS A MISSING PRINCIPAL KIND. Adding
 * an eighth `C3Role` would put a *platform* principal *inside* a tenant
 * (`Actor.tenantId` is required and non-null), make it grantable through member
 * administration, and — because `roles.test.ts` asserts `canReadPeople` for every
 * role — **compel it to read every customer's People register.**
 *
 * ⇒ So platform authority is carried by explicit capabilities on a principal that
 * has no tenant, and this module never imports `Actor`.
 */

/**
 * The complete platform vocabulary. Two capabilities, deliberately narrow.
 *
 * ⛔ NEITHER GRANTS CUSTOMER-DATA VISIBILITY (`D-015`, and the clause that keeps
 * `D-016`'s break-glass exclusion honest). Executing the janitor authorises **the
 * governed operation, not unrestricted browsing of tenant data** — enforced at
 * the routes by `platformRouteDisclosure.test.ts`, which fails when a platform
 * response grows a customer datum or even a new field.
 *
 * ⚖️ The set is CLOSED. A third capability is a decision someone has to make in
 * this file, not a string a caller can invent at a call site.
 */
export const PLATFORM_CAPABILITIES = [
  'platform.backup_status.read',
  'platform.erasure_janitor.execute',
] as const;

export type PlatformCapability = (typeof PLATFORM_CAPABILITIES)[number];

/**
 * A principal holding platform authority. **Deliberately not an `Actor`.**
 *
 * ⛔ `Actor` carries a required, non-null `tenantId`. Typing this against `Actor`
 * would hard-wire tenant membership into the platform path — the exact coupling
 * `D-015` exists to break, and it would have to be unpicked later by someone who
 * no longer remembers why it was there.
 *
 * ⚖️ THERE IS NO `tenantId` FIELD HERE, AND ITS ABSENCE IS NOT AN ADMISSION
 * SIGNAL (`D-016a`). A platform principal simply has no tenant; that is a
 * CLASSIFICATION, never a GRANT.
 */
export interface PlatformPrincipal {
  /** Stable identifier of the acting principal — a service or a C3 staff identity. */
  readonly principalId: string;
  /** What kind of thing is acting. Human actions carry extra obligations upstream. */
  readonly kind: 'service' | 'staff';
  /**
   * ⛔ THE ANSWERABLE HUMAN, AND IT IS REQUIRED.
   *
   * A service principal names **what ran**; only a registered owner names **who
   * is answerable**. A platform-wide destructive sweep attributable to nobody is
   * worse than one attributable to the wrong tenant's owner — the first cannot be
   * asked why. So a principal with no accountable owner is refused rather than
   * admitted with a blank field.
   */
  readonly accountableOwner: string;
  /** Explicitly granted capabilities. An empty list is a principal that may do nothing. */
  readonly capabilities: readonly PlatformCapability[];
}

/** Raised when platform authority is absent. Never names what WOULD have worked. */
export class PlatformAuthorityError extends Error {
  readonly code = 'PLATFORM_AUTHORITY_REQUIRED';
  constructor(message: string) {
    super(message);
    this.name = 'PlatformAuthorityError';
  }
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Does this principal hold the capability?
 *
 * ⛔ ADMISSION IS POSITIVE, ALWAYS (`D-016a`). Every branch below refuses unless
 * something is PRESENT: a principal, an accountable owner, a granted capability.
 * **A negative can never be an admission criterion** — "has no tenant", "is not a
 * customer", "was not refused elsewhere" grant nothing here, and no future edit
 * may make absence sufficient.
 *
 * ⚖️ Why that phrasing is load-bearing rather than pedantic: *"admit principals
 * with no tenant membership"* and *"add a second positive resolution path"*
 * describe the same feature and produce opposite code. The first reads as
 * REMOVING the check that refuses non-members — and that denial is the only thing
 * standing between an uninvited stranger and the product.
 */
export function hasPlatformCapability(
  principal: PlatformPrincipal | null | undefined,
  capability: PlatformCapability,
): boolean {
  if (!principal) return false;
  if (!isNonEmpty(principal.principalId)) return false;
  // No answerable human ⇒ no authority, however well-formed the grant looks.
  if (!isNonEmpty(principal.accountableOwner)) return false;
  return principal.capabilities.includes(capability);
}

/**
 * Fail-closed assertion for a platform route.
 *
 * ⛳ It takes a `PlatformPrincipal | null` rather than an `Actor`, so a tenant
 * actor cannot be passed here at all — the type system refuses the mistake before
 * the check has to.
 */
export function assertPlatformCapability(
  principal: PlatformPrincipal | null | undefined,
  capability: PlatformCapability,
): void {
  if (!hasPlatformCapability(principal, capability)) {
    // Deliberately uninformative about WHICH condition failed: a caller learning
    // "your owner field is blank" is learning the shape of the authority model.
    throw new PlatformAuthorityError('Platform authority is required for this operation.');
  }
}
