import type { Credential } from './credentials';
import type { ObligationEvaluation, ObligationSpan } from './obligations';

// ---------------------------------------------------------------------------
// ProtocolFn
// ---------------------------------------------------------------------------

/**
 * The signature shared by all protocol evaluation functions.
 *
 * A protocol function is pure: given a person's current credentials and optional
 * context, it returns a complete ObligationEvaluation. Hooks and aggregators are
 * protocol-agnostic — callers supply whichever protocol functions they need.
 *
 * Example: `evaluateOnboardingObligations` from `@c3/protocols`
 *
 * Note: was previously defined in hooks/usePersonReadiness. Moved to types in
 * Sprint 8 so GapFilter and the aggregation hook (useOperationalGaps) can
 * reference it without importing from the hooks layer.
 */
export type ProtocolFn = (
  personId: string,
  credentials: Credential[],
  context?: ProtocolContext,
) => ObligationEvaluation;

// ---------------------------------------------------------------------------
// ProtocolContext
// ---------------------------------------------------------------------------

/**
 * Context passed to a protocol evaluation function.
 *
 * Protocols use this to compute obligation spans that align to real operational
 * deadlines rather than relying on hardcoded default windows (e.g. 90 days).
 *
 * Span resolution precedence (first non-null wins):
 *   1. context.span         — explicit span, highest priority
 *   2. context.mission.Span — derived from the activating Mission
 *   3. Protocol default     — fallback (e.g. 90-day forward window)
 *
 * All fields are optional — callers that do not yet have span or mission context
 * simply omit them, and protocol evaluation falls back to its default behaviour.
 * This ensures backward compatibility: all existing callers continue to work
 * unchanged when no context is provided.
 *
 * Future: ProtocolContext may grow to include additional fields as the model
 * matures (e.g. jurisdiction, league-specific rule variants). The optional
 * shape means additions are never breaking changes.
 */
export interface ProtocolContext {
  /**
   * An explicit obligation span.
   * When present, obligations are evaluated against this span regardless of
   * the caller's mission context. Use when the span is known directly (e.g.
   * a specific tournament date range).
   *
   * Callers with a Mission use:
   *   span: { from: mission.Span.StartDate, to: mission.Span.EndDate }
   *
   * Sprint 14 S14-4: The previous `mission?: Mission` field was removed.
   * Protocols only needed mission.Span — callers now extract the span before
   * calling and pass it directly. This removes the dependency from the protocol
   * evaluation layer to the Mission domain type.
   */
  span?: ObligationSpan;

  /**
   * Jurisdiction identifier for this protocol evaluation.
   *
   * When present, jurisdiction-aware protocols (e.g. evaluateKSAObligations)
   * apply jurisdiction-specific rules in addition to or in place of defaults.
   * Added in S14-4 so future protocols can consume it without a type change.
   *
   * Not used by any protocol in v1 — derives from Mission.Jurisdiction when set.
   */
  jurisdiction?: string;
}
