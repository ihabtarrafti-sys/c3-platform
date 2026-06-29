import type { Credential, CredentialCapability } from '@c3/types';
import type { Obligation, ObligationEvaluation, ObligationSpan, ObligationStatus } from '@c3/types';
import type { ProtocolContext } from '@c3/types';
import { computeDaysToExpiry } from '@c3/utils/dateUtils';
import { credentialProvides } from './credentialCapabilities';

// ---------------------------------------------------------------------------
// Protocol identity
// ---------------------------------------------------------------------------

const PROTOCOL_NAME = 'OnboardingProtocol';

/**
 * Days remaining below which a satisfying credential is considered AtRisk
 * when no ProtocolContext span is provided.
 *
 * This is the fallback approximation: obligations are span-covering, but when
 * no span is supplied via ProtocolContext, the span is approximated as a 90-day
 * forward window from evaluation date.
 *
 * When ProtocolContext supplies a span (directly or via a Mission), this
 * constant is not used — the real span end date drives AtRisk evaluation.
 */
const AT_RISK_THRESHOLD_DAYS = 90;

// ---------------------------------------------------------------------------
// Obligation specifications
//
// Obligations are expressed as operational capabilities, not document names.
// A capability ('Identity', 'Travel', 'RightToWork') is satisfied by any
// credential type that provides that capability, as defined in
// protocols/credentialCapabilities.ts.
//
// This keeps the protocol jurisdiction-agnostic: the same OnboardingProtocol
// works whether the person holds a UAE Emirates ID, a Saudi Iqama, or an
// equivalent residency document from another jurisdiction.
//
// Ref: Sprint 6G — locked decision:
//   "Protocols should ask for operational capabilities, not specific document names."
// ---------------------------------------------------------------------------

interface ObligationSpec {
  id: string;
  requirement: string;
  satisfiedByCapability: CredentialCapability;
  /**
   * The operational role or team that owns this obligation type by default.
   * Expressed as suggested ownership for uncovered gaps.
   * Ref: Ownership principle locked in Sprint 6E architecture review.
   */
  defaultOwner: string;
}

const OBLIGATION_SPECS: ObligationSpec[] = [
  {
    id: 'identity',
    requirement: 'Identity Document',
    satisfiedByCapability: 'Identity',
    defaultOwner: 'PRO Coordinator',
  },
  {
    id: 'right-to-work',
    requirement: 'Right to Work Authorization',
    satisfiedByCapability: 'RightToWork',
    defaultOwner: 'PRO Coordinator',
  },
  {
    id: 'travel',
    requirement: 'Travel Authorization',
    satisfiedByCapability: 'Travel',
    defaultOwner: 'Operations Coordinator',
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function worstStatus(statuses: ObligationStatus[]): ObligationStatus {
  if (statuses.includes('Unsatisfied')) return 'Unsatisfied';
  if (statuses.includes('AtRisk')) return 'AtRisk';
  return 'Satisfied';
}

/**
 * Resolve the obligation span from the provided context.
 *
 * When context.span is set, obligations are evaluated against that span.
 * When absent, returns null and the caller falls back to the default threshold
 * (AT_RISK_THRESHOLD_DAYS).
 *
 * Sprint 14 S14-4: The previous fallback from context.mission.Span was removed.
 * Callers with a Mission now extract the span before calling the protocol and
 * pass it as context.span directly. There is no longer any path through which
 * the protocol touches the Mission entity.
 */
function resolveSpan(context?: ProtocolContext): ObligationSpan | null {
  if (context?.span) return context.span;
  return null;
}

function evaluateObligation(
  spec: ObligationSpec,
  personID: string,
  credentials: Credential[],
  context?: ProtocolContext,
): Obligation {
  const resolvedSpan = resolveSpan(context);

  const matching = credentials.filter(
    c => c.IsActive && credentialProvides(c.Type, spec.satisfiedByCapability),
  );

  // No credential that provides the required capability is on file.
  if (matching.length === 0) {
    return {
      id: spec.id,
      protocolName: PROTOCOL_NAME,
      targetPersonID: personID,
      requirement: spec.requirement,
      satisfiedByCapability: spec.satisfiedByCapability,
      status: 'Unsatisfied',
      statusReason: `No ${spec.requirement} on file.`,
      span: resolvedSpan ?? undefined,
      defaultOwner: spec.defaultOwner,
    };
  }

  // From all non-expired matching credentials, pick the one with the latest expiry.
  // If all are expired, fall back to the first for status reporting.
  const nonExpired = matching.filter(c =>
    !c.ExpiryDate || computeDaysToExpiry(c.ExpiryDate) > 0,
  );

  const candidate =
    nonExpired.length > 0
      ? nonExpired.reduce((best, c) => {
          if (!c.ExpiryDate) return c; // no expiry = best possible
          if (!best.ExpiryDate) return best;
          return new Date(c.ExpiryDate) > new Date(best.ExpiryDate) ? c : best;
        })
      : matching[0]; // all expired; report on first found

  // Credential exists but has no expiry — unconditionally satisfied.
  if (!candidate.ExpiryDate) {
    return {
      id: spec.id,
      protocolName: PROTOCOL_NAME,
      targetPersonID: personID,
      requirement: spec.requirement,
      satisfiedByCapability: spec.satisfiedByCapability,
      status: 'Satisfied',
      satisfiedByCredentialID: candidate.CredentialID,
      statusReason: `${spec.requirement} is valid (no expiry date).`,
      span: resolvedSpan ?? undefined,
      defaultOwner: spec.defaultOwner,
    };
  }

  const days = computeDaysToExpiry(candidate.ExpiryDate);

  if (days <= 0) {
    return {
      id: spec.id,
      protocolName: PROTOCOL_NAME,
      targetPersonID: personID,
      requirement: spec.requirement,
      satisfiedByCapability: spec.satisfiedByCapability,
      status: 'Unsatisfied',
      satisfiedByCredentialID: candidate.CredentialID,
      credentialExpiryDate: candidate.ExpiryDate,
      statusReason: `${spec.requirement} expired ${Math.abs(days)}d ago — must be renewed.`,
      span: resolvedSpan ?? undefined,
      defaultOwner: spec.defaultOwner,
    };
  }

  // ── Span-aware AtRisk evaluation ─────────────────────────────────────────
  //
  // When a span is available, AtRisk means the credential expires before the
  // span ends — it won't cover the full required period.
  //
  // When no span is available, AtRisk means the credential expires within the
  // AT_RISK_THRESHOLD_DAYS default window.

  if (resolvedSpan !== null) {
    const daysUntilSpanEnd = computeDaysToExpiry(resolvedSpan.to);

    if (days <= daysUntilSpanEnd) {
      // Credential exists and is valid today, but will lapse before the span ends.
      return {
        id: spec.id,
        protocolName: PROTOCOL_NAME,
        targetPersonID: personID,
        requirement: spec.requirement,
        satisfiedByCapability: spec.satisfiedByCapability,
        status: 'AtRisk',
        satisfiedByCredentialID: candidate.CredentialID,
        credentialExpiryDate: candidate.ExpiryDate,
        statusReason: `${spec.requirement} expires in ${days}d — before span end (${resolvedSpan.to}). Renewal required.`,
        span: resolvedSpan,
        defaultOwner: spec.defaultOwner,
      };
    }

    // Credential remains valid through span end — satisfied.
    return {
      id: spec.id,
      protocolName: PROTOCOL_NAME,
      targetPersonID: personID,
      requirement: spec.requirement,
      satisfiedByCapability: spec.satisfiedByCapability,
      status: 'Satisfied',
      satisfiedByCredentialID: candidate.CredentialID,
      credentialExpiryDate: candidate.ExpiryDate,
      statusReason: `${spec.requirement} is valid through span end (${resolvedSpan.to}).`,
      span: resolvedSpan,
      defaultOwner: spec.defaultOwner,
    };
  }

  // ── Default threshold-based AtRisk evaluation (no span provided) ─────────

  if (days <= AT_RISK_THRESHOLD_DAYS) {
    return {
      id: spec.id,
      protocolName: PROTOCOL_NAME,
      targetPersonID: personID,
      requirement: spec.requirement,
      satisfiedByCapability: spec.satisfiedByCapability,
      status: 'AtRisk',
      satisfiedByCredentialID: candidate.CredentialID,
      credentialExpiryDate: candidate.ExpiryDate,
      statusReason: `${spec.requirement} expires in ${days}d — renewal required before expiry.`,
      defaultOwner: spec.defaultOwner,
    };
  }

  return {
    id: spec.id,
    protocolName: PROTOCOL_NAME,
    targetPersonID: personID,
    requirement: spec.requirement,
    satisfiedByCapability: spec.satisfiedByCapability,
    status: 'Satisfied',
    satisfiedByCredentialID: candidate.CredentialID,
    credentialExpiryDate: candidate.ExpiryDate,
    statusReason: `${spec.requirement} is valid.`,
    defaultOwner: spec.defaultOwner,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluates the Onboarding Protocol against a person's current credential set.
 *
 * The protocol requires three operational capabilities for onboarding readiness:
 *   1. Identity Document    — any credential providing the 'Identity' capability
 *   2. Right to Work        — any credential providing the 'RightToWork' capability
 *   3. Travel Authorization — any credential providing the 'Travel' capability
 *
 * This replaces the previous UAE-centric model (Passport / UAE Visa / Emirates ID)
 * with a jurisdiction-agnostic capability model. The same protocol applies
 * regardless of which documents the person holds — evaluation resolves which
 * credential types satisfy each capability via the CREDENTIAL_CAPABILITIES map.
 *
 * When `context` is provided:
 *   - context.span defines the obligation span; credentials must remain valid
 *     through span.to, not merely for 90 days. Callers with a Mission extract
 *     the span and pass it directly (see useMissionGaps).
 *   - All evaluated obligations carry the resolved span in their `span` field.
 *
 * When `context` is absent (all existing callers):
 *   - Falls back to AT_RISK_THRESHOLD_DAYS (90-day forward window).
 *   - Behaviour is identical to pre-6E evaluation.
 *
 * Expected outcomes with current mock data (no context, 90-day default):
 *   PER-0001 — AtRisk      (Travel Authorization expires in ~11 days: Visa)
 *   PER-0002 — Unsatisfied (no Travel Authorization; no Right to Work)
 *   PER-0003 — Satisfied   (all three capabilities covered)
 */
export function evaluateOnboardingObligations(
  personID: string,
  credentials: Credential[],
  context?: ProtocolContext,
): ObligationEvaluation {
  const obligations = OBLIGATION_SPECS.map(spec =>
    evaluateObligation(spec, personID, credentials, context),
  );

  return {
    personID,
    protocolName: PROTOCOL_NAME,
    evaluatedAt: new Date().toISOString(),
    obligations,
    overallStatus: worstStatus(obligations.map(o => o.status)),
  };
}
