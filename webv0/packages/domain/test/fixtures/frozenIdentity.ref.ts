/**
 * frozenIdentity.ref.ts — STATIC REFERENCE FIXTURE (verbatim copy).
 *
 * Source: packages/c3/src/utils/identity.ts @ commit 0558a6c (frozen
 * SharePoint baseline, SPFx 1.0.0.8). Copied so the Web V0 npm root has no
 * imports outside webv0/. The frozen source never changes; if it ever did,
 * this fixture intentionally preserves the CERTIFIED behaviour being
 * parity-tested. Do not edit.
 */
/**
 * identity.ts — canonical identity normalization (Sprint 33, Defect B).
 *
 * The self-approval guard (ADR-013) previously compared identity strings with
 * raw `===`. SharePoint surfaces the SAME person in multiple formats:
 *
 *   - SPFx claims login name:  i:0#.f|membership|user@tenant.com
 *   - bare email / UPN:        user@tenant.com
 *   - case variations:         User@Tenant.com
 *   - stray whitespace:        " user@tenant.com "
 *
 * A raw comparison therefore FAILS OPEN: a claims-format session identity
 * never equals a bare-email historical SubmittedBy, so a submitter could
 * review their own submission. This module is the ONE shared normalizer.
 *
 * Rules (mandated):
 *   - trim whitespace, normalize case;
 *   - remove ONLY the known SharePoint membership claim prefix, anchored at
 *     the start of the string — never broad substring stripping;
 *   - compare full canonical UPN/email values — no substring matching, no
 *     cross-domain or alias equivalence;
 *   - FAIL CLOSED: when either identity cannot be normalized to a plausible
 *     UPN/email, the review is BLOCKED (indeterminate), never allowed.
 */

/** SharePoint membership claim prefix, anchored. Case-insensitive because
 *  SharePoint emits both "i:0#.f" and occasionally upper-cased variants. */
const MEMBERSHIP_CLAIM_PREFIX = /^i:0#\.f\|membership\|/i;

/**
 * Normalize a raw identity string to its canonical lower-case UPN/email.
 * Returns null when the value cannot be normalized reliably — callers MUST
 * treat null as indeterminate and fail closed.
 */
export function canonicalizeIdentity(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (!value) return null;

  // Strip ONLY the anchored membership claim prefix (safe, non-substring).
  value = value.replace(MEMBERSHIP_CLAIM_PREFIX, '').trim();
  if (!value) return null;

  value = value.toLowerCase();

  // A canonical identity must be a single plausible UPN/email token:
  // exactly one '@', non-empty local and domain parts, and no residual
  // claim/pipe/whitespace characters.
  if (/[|\s]/.test(value)) return null;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@') || at === value.length - 1) return null;

  return value;
}

export type SelfReviewCheck =
  | { blocked: true; reason: 'self' | 'indeterminate-reviewer' | 'indeterminate-submitter' }
  | { blocked: false };

/**
 * Decide whether a review (approve/reject) must be blocked because the
 * reviewer is — or cannot be proven distinct from — the submitter.
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
