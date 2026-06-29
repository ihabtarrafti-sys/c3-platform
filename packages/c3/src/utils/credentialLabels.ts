/**
 * Credential display labels — shared utility.
 *
 * Centralises human-readable strings for CredentialType and CredentialCapability
 * so they are not duplicated between PersonProfile, AddCredentialPanel, and any
 * future surface that needs to name a credential or a capability.
 *
 * Layer: utils — no component imports, no hooks, no services.
 */

import type { CredentialCapability, CredentialType } from '@c3/types';

// ---------------------------------------------------------------------------
// CredentialType labels
// ---------------------------------------------------------------------------

export const CREDENTIAL_TYPE_LABELS: Record<CredentialType, string> = {
  // Identity & residency
  Passport:           'Passport',
  NationalID:         'National ID',
  EmiratesID:         'Emirates ID',
  Iqama:              'Iqama',
  ResidencePermit:    'Residence Permit',
  DriversLicense:     "Driver's License",
  // Travel authorisation
  Visa:               'Visa',
  EntryPermit:        'Entry Permit',
  // Work authorisation
  WorkPermit:         'Work Permit',
  LabourCard:         'Labour Card',
  // Competition & transfers
  LeagueRegistration: 'League Registration',
  FederationLicense:  'Federation License',
  TransferClearance:  'Transfer Clearance',
  // Health
  InsuranceCard:      'Insurance Card',
  MedicalClearance:   'Medical Clearance',
  // Financial
  BankAccount:        'Bank Account',
  TaxNumber:          'Tax Number',
  // Catch-all
  Other:              'Credential',
};

/**
 * All credential types in display order, grouped by operational domain.
 * Used to populate dropdowns in the same order as the label map.
 */
export const CREDENTIAL_TYPE_ORDER: CredentialType[] = [
  // Identity & residency
  'Passport', 'NationalID', 'EmiratesID', 'Iqama', 'ResidencePermit', 'DriversLicense',
  // Travel authorisation
  'Visa', 'EntryPermit',
  // Work authorisation
  'WorkPermit', 'LabourCard',
  // Competition & transfers
  'LeagueRegistration', 'FederationLicense', 'TransferClearance',
  // Health
  'InsuranceCard', 'MedicalClearance',
  // Financial
  'BankAccount', 'TaxNumber',
  // Catch-all
  'Other',
];

// ---------------------------------------------------------------------------
// CredentialCapability labels
// ---------------------------------------------------------------------------

/**
 * Human-readable labels for CredentialCapability values.
 * Used in panel titles ("Resolves Right to Work") and future UI surfaces.
 */
export const CAPABILITY_LABELS: Record<CredentialCapability, string> = {
  Identity:               'Identity Document',
  Travel:                 'Travel Authorization',
  RightToWork:            'Right to Work',
  RightToReside:          'Right to Reside',
  CompetitionEligibility: 'Competition Eligibility',
  TransferEligibility:    'Transfer Eligibility',
  HealthCoverage:         'Health Coverage',
  HealthClearance:        'Health Clearance',
  FinancialAccess:        'Financial Access',
};
