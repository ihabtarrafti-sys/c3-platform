/**
 * identity.ts — canonical identity normalization for governance decisions.
 *
 * Extracted from the frozen reference `packages/c3/src/utils/identity.ts`.
 * The SELF-REVIEW guard (ADR-013) compares a reviewer identity against a
 * submitter identity; a naive `===` fails OPEN across case/whitespace variants.
 *
 * SP-independence change (deliberate): the reference stripped a SharePoint
 * `i:0#.f|membership|` claim prefix here. In the Web V0 stack, provider-
 * specific claim shapes (SharePoint claims, Entra `preferred_username`/`upn`,
 * etc.) are translated to a bare email/UPN AT THE AUTH BOUNDARY, before any
 * identity reaches the domain. The domain therefore performs only
 * provider-neutral normalization: trim, lower-case, and validate that the
 * value is a single plausible email/UPN. Anything else FAILS CLOSED.
 *
 * Parity: for all non-claims inputs (plain emails, case/whitespace variants,
 * malformed values) this module produces results identical to the frozen
 * reference. See packages/domain/test/identity.parity.test.ts.
 */

/**
 * Normalize a raw identity string to its canonical lower-case UPN/email.
 * Returns null when the value cannot be normalized reliably — callers MUST
 * treat null as indeterminate and fail closed.
 */
export function canonicalizeIdentity(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  // A canonical identity must be a single plausible UPN/email token: no
  // residual claim/pipe/whitespace characters, exactly one '@', non-empty
  // local and domain parts.
  if (/[|\s]/.test(value)) return null;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return null;

  return value;
}

export type SelfReviewCheck =
  | { blocked: true; reason: 'self' | 'indeterminate-reviewer' | 'indeterminate-submitter' }
  | { blocked: false };

/**
 * Decide whether a review (begin-review / approve / reject) must be blocked
 * because the reviewer is — or cannot be proven distinct from — the submitter.
 *
 * FAIL CLOSED: an unparseable reviewer or submitter identity blocks the
 * review; equality of canonical values blocks the review; only two cleanly
 * normalized, different identities are allowed through.
 */
export function checkSelfReview(
  reviewerIdentity: string | null | undefined,
  submitterIdentity: string | null | undefined,
): SelfReviewCheck {
  const reviewer = canonicalizeIdentity(reviewerIdentity);
  if (reviewer === null) return { blocked: true, reason: 'indeterminate-reviewer' };
  const submitter = canonicalizeIdentity(submitterIdentity);
  if (submitter === null) return { blocked: true, reason: 'indeterminate-submitter' };
  if (reviewer === submitter) return { blocked: true, reason: 'self' };
  return { blocked: false };
}
