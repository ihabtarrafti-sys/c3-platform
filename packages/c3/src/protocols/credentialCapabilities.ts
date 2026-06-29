/**
 * Credential capability map — Sprint 6G
 *
 * Maps each CredentialType to the operational capabilities it provides.
 *
 * Design principle:
 *   Protocols express requirements as capabilities ('Identity', 'Travel', 'RightToWork')
 *   not specific document names ('EmiratesID', 'UAE Visa'). This file is the
 *   single source of truth for resolving which credential types satisfy which
 *   capability in the current evaluation context.
 *
 * The model is deliberately jurisdiction-agnostic: a Saudi Iqama and a UAE
 * EmiratesID provide the same operational capabilities (Identity + RightToWork
 * + RightToReside). Jurisdiction-specific refinement — e.g. "only an Iqama
 * satisfies RightToWork in Saudi Arabia" — is deferred to a future
 * JurisdictionContext layer.
 *
 * Locked decision (Sprint 6G architecture review):
 *   "Protocols should ask for operational capabilities, not specific document names."
 *
 * Ref: The Geekay Operational Model v2 — "On Credentials"
 */

import type { CredentialCapability, CredentialType } from '@c3/types';

// ---------------------------------------------------------------------------
// Capability map
// ---------------------------------------------------------------------------

export const CREDENTIAL_CAPABILITIES: Record<CredentialType, CredentialCapability[]> = {
  // ── Identity & residency ───────────────────────────────────────────────
  Passport:           ['Identity'],
  NationalID:         ['Identity'],
  EmiratesID:         ['Identity', 'RightToWork', 'RightToReside'],
  Iqama:              ['Identity', 'RightToWork', 'RightToReside'],
  ResidencePermit:    ['RightToReside'],
  DriversLicense:     ['Identity'],

  // ── Travel authorisation ──────────────────────────────────────────────
  Visa:               ['Travel'],
  EntryPermit:        ['Travel'],

  // ── Work authorisation ────────────────────────────────────────────────
  WorkPermit:         ['RightToWork'],
  LabourCard:         ['RightToWork'],

  // ── Competition & transfers ───────────────────────────────────────────
  LeagueRegistration: ['CompetitionEligibility'],
  FederationLicense:  ['CompetitionEligibility'],
  TransferClearance:  ['TransferEligibility'],

  // ── Health ────────────────────────────────────────────────────────────
  InsuranceCard:      ['HealthCoverage'],
  MedicalClearance:   ['HealthClearance'],

  // ── Financial ─────────────────────────────────────────────────────────
  BankAccount:        ['FinancialAccess'],
  TaxNumber:          ['FinancialAccess'],

  // ── Catch-all ─────────────────────────────────────────────────────────
  Other:              [],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if a credential of the given type provides the requested capability.
 *
 * Used by protocol evaluation to filter credentials:
 *   `credentials.filter(c => c.IsActive && credentialProvides(c.Type, spec.satisfiedByCapability))`
 */
export const credentialProvides = (
  type: CredentialType,
  capability: CredentialCapability,
): boolean => CREDENTIAL_CAPABILITIES[type].includes(capability);

/**
 * Returns all credential types that can satisfy a given capability.
 *
 * Useful for future UI surfaces:
 *   "This obligation requires Travel Authorization.
 *    Accepted documents: Visa, Entry Permit."
 */
export const credentialTypesFor = (
  capability: CredentialCapability,
): CredentialType[] =>
  (Object.entries(CREDENTIAL_CAPABILITIES) as [CredentialType, CredentialCapability[]][])
    .filter(([, caps]) => caps.includes(capability))
    .map(([type]) => type);
