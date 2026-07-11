/**
 * intakeToken.ts — Track B6: the guest-intake capability token (server-only).
 *
 * A 256-bit URL-safe secret is the whole capability. Only its SHA-256 is ever
 * stored (intake_link.token_hash) or compared; the raw token is shown to the
 * minting staff member ONCE and never persisted. Unguessable ⇒ presenting the
 * exact token is the only way to resolve a link (no enumeration). Lives here,
 * not in @c3web/domain, because the web bundle imports domain and must never
 * pull in node:crypto.
 */
import { randomBytes, createHash } from 'node:crypto';

/** SHA-256 (hex) of a presented token — the stored/compared form. */
export function hashIntakeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Mint a fresh token + its hash. The token is returned to the caller ONCE. */
export function mintIntakeToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url'); // 256-bit, URL-safe
  return { token, tokenHash: hashIntakeToken(token) };
}
