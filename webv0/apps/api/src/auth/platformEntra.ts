/**
 * platformEntra.ts — the SECOND door, with its own lock (`D-019`).
 *
 * ⛔ WHY THIS IS A SEPARATE MODULE AND NOT A FLAG ON THE TENANT VALIDATOR.
 * `entra.ts:52` rejects application-only tokens (`idtyp === 'app'`), and that
 * rejection sits in the SHARED claim validator. Relaxing it to admit service
 * principals would widen the **tenant** API as a side effect — every tenant route
 * would begin accepting tokens that carry no human identity. **A separate door
 * with its own lock, never a hole in the existing one.**
 *
 * ⚖️ AND THE AUDIENCE IS THE LOCK. This validator accepts only tokens minted for
 * the PLATFORM app registration. A token good for the tenant API is not good
 * here, and vice versa — which is the same environment-separation property that
 * made staging and production tokens mutually useless, applied between surfaces
 * instead of between environments.
 *
 * ⛔ ADMISSION IS POSITIVE (`D-016a`). A valid token proves only who is calling.
 * Authority comes from a ROW in `platform_principal`; no row means refused. There
 * is deliberately no path where authenticating successfully is sufficient.
 */
import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey, type KeyLike } from 'jose';
import type { PlatformPrincipal } from '@c3web/authz';
import { AuthError } from './types';
import type { AdminDirectory } from './directory';

export interface PlatformEntraConfig {
  /** The tenant-specific v2 issuer — never common/organizations/consumers. */
  readonly issuer: string;
  /** ⛔ The PLATFORM audience. Distinct from the tenant API's by construction. */
  readonly audience: string;
  readonly jwksUri: string;
  /** The Entra directory GUID; a token from any other tid is refused. */
  readonly tenantId: string;
}

export interface PlatformAdmission {
  /**
   * Validate a bearer token against the PLATFORM audience and resolve it to a
   * registered principal. Throws `AuthError` when the token is not admissible;
   * returns `null` when the token is valid but the caller is not registered.
   *
   * ⚖️ The two outcomes are kept apart on purpose: a bad token is a transport
   * failure, an unregistered identity is an authority decision, and collapsing
   * them would make "we do not know you" indistinguishable from "your token is
   * malformed" — which is exactly the conflation `CR-005` was about.
   */
  admit(bearerToken: string): Promise<PlatformPrincipal | null>;
}

/**
 * ⛳ APP-ONLY TOKENS ARE ACCEPTED HERE, AND ONLY HERE.
 *
 * A service principal presents `idtyp: 'app'` and carries no human identity —
 * which is precisely why the tenant validator refuses it. On this surface the
 * accountability requirement is met differently: the registry row names an
 * `accountable_owner`, and a principal without one cannot be admitted at all.
 * **A service principal names WHAT RAN; only the registered owner names WHO IS
 * ANSWERABLE.**
 */
export function createPlatformAdmission(
  config: PlatformEntraConfig,
  directory: AdminDirectory,
  keyResolver?: JWTVerifyGetKey | KeyLike | Uint8Array,
): PlatformAdmission {
  const keys = keyResolver ?? createRemoteJWKSet(new URL(config.jwksUri));

  return {
    async admit(bearerToken: string): Promise<PlatformPrincipal | null> {
      let payload: Record<string, unknown>;
      try {
        payload = (
          await jwtVerify(bearerToken, keys as never, {
            issuer: config.issuer,
            // ⛔ THE PLATFORM AUDIENCE. A tenant-API token fails here.
            audience: config.audience,
            algorithms: ['RS256'],
          })
        ).payload as Record<string, unknown>;
      } catch (err) {
        throw new AuthError(`Invalid platform token: ${(err as Error).message}`);
      }

      // The directory GUID is pinned exactly as the tenant path pins it: a
      // correctly-signed token from another Entra directory is another
      // organisation's token, whatever it claims.
      const tid = payload.tid;
      if (typeof tid !== 'string' || tid !== config.tenantId) {
        throw new AuthError('Platform token rejected: issued by a different tenant.');
      }

      // `oid` is the immutable subject — for a service principal, the service
      // principal's object id. Never `appid`: an app registration can be granted
      // to more than one principal, and the row must name the ACTOR.
      const oid = payload.oid;
      if (typeof oid !== 'string' || !oid) {
        throw new AuthError('Platform token rejected: missing oid claim.');
      }

      // ⛔ AUTHORITY IS THE ROW, NOT THE TOKEN. Everything above establishes only
      // WHO is calling. `null` here is the honest answer for a perfectly valid
      // token belonging to nobody we have registered — and the caller refuses it.
      return directory.resolvePlatformPrincipal({ provider: 'entra', issuer: config.issuer, subject: oid });
    },
  };
}
