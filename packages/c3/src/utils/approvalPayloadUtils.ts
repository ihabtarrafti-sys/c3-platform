/**
 * approvalPayloadUtils.ts
 *
 * Sprint 21 Phase 2 — Pure helpers for approval payload display.
 * Sprint 21 Phase 3 — Humanize AddCredential credentialType using CREDENTIAL_TYPE_LABELS.
 * Sprint 23 Phase 1 — DeactivateCredential payload summary.
 *
 * All functions are pure (no React, no hooks, no side effects).
 * Safe parse only — never throws on bad input, never outputs raw JSON.
 *
 * Used by PersonApprovalHistoryCard for compact per-row payload summaries.
 * ApprovalInbox uses its own full-grid PayloadSummary component (unchanged).
 *
 * See: packages/c3/src/services/interfaces/approvalPayloads.ts (payload shapes)
 */

import type { CredentialType } from '@c3/types';
import { CREDENTIAL_TYPE_LABELS } from '@c3/utils/credentialLabels';

// ---------------------------------------------------------------------------
// formatApprovalPayloadSummary
// ---------------------------------------------------------------------------

/**
 * Returns a short plain-text summary of an approval payload, suitable for
 * inline display in a compact list row.
 *
 * Returns null when:
 *   - raw is undefined/empty
 *   - JSON parse fails
 *   - operationType is not recognised
 *
 * Never throws. Never returns raw JSON.
 *
 * Examples:
 *   InitiateJourney:    "Onboarding · PER-0004"
 *   AddCredential:      "League Registration · A12345678 · PER-0004 · Expires 2027-06-01"
 *   AddCredential (no expiry): "Work Permit · V-2024-001 · PER-0007"
 *   DeactivateCredential: "Deactivate · League Registration · A12345678 · PER-0004"
 */
export function formatApprovalPayloadSummary(
  raw: string | undefined,
  operationType: string,
): string | null {
  if (!raw || !raw.trim()) return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  if (operationType === 'InitiateJourney') {
    const journeyType = typeof parsed['journeyType'] === 'string' && parsed['journeyType'].trim()
      ? parsed['journeyType'].trim()
      : 'Journey';
    const personId = typeof parsed['personId'] === 'string' && parsed['personId'].trim()
      ? parsed['personId'].trim()
      : null;
    return [journeyType, personId].filter(Boolean).join(' · ');
  }

  if (operationType === 'AddCredential') {
    // Humanize the raw credentialType key (e.g. "LeagueRegistration" → "League Registration").
    // Falls back to the raw key if not found in the labels map (forward-compat safety).
    const rawType = typeof parsed['credentialType'] === 'string' && parsed['credentialType'].trim()
      ? parsed['credentialType'].trim()
      : null;
    const credType = rawType
      ? (CREDENTIAL_TYPE_LABELS[rawType as CredentialType] ?? rawType)
      : null;

    const refNum     = typeof parsed['referenceNumber'] === 'string' && parsed['referenceNumber'].trim()
      ? parsed['referenceNumber'].trim() : null;
    const holderId   = typeof parsed['holderPersonId']  === 'string' && parsed['holderPersonId'].trim()
      ? parsed['holderPersonId'].trim()  : null;
    const expiryDate = typeof parsed['expiryDate']      === 'string' && parsed['expiryDate'].trim()
      ? `Expires ${parsed['expiryDate'].trim()}`        : null;

    const parts = [credType, refNum, holderId, expiryDate].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : null;
  }

  if (operationType === 'DeactivateCredential') {
    const rawType = typeof parsed['credentialType'] === 'string' && parsed['credentialType'].trim()
      ? parsed['credentialType'].trim()
      : null;
    const credType = rawType
      ? (CREDENTIAL_TYPE_LABELS[rawType as CredentialType] ?? rawType)
      : null;

    const refNum   = typeof parsed['referenceNumber'] === 'string' && parsed['referenceNumber'].trim()
      ? parsed['referenceNumber'].trim() : null;
    const holderId = typeof parsed['holderPersonId']  === 'string' && parsed['holderPersonId'].trim()
      ? parsed['holderPersonId'].trim()  : null;

    const parts = ['Deactivate', credType, refNum, holderId].filter(Boolean);
    return parts.length > 0 ? parts.join(' · ') : 'Deactivate credential';
  }

  // Unknown operationType — do not surface raw payload
  return null;
}
