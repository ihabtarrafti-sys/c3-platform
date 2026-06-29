/**
 * Credential types — C3 Platform
 *
 * A Credential is a physical or digital document that satisfies one or more
 * operational obligations for a person (right-to-work, identity, travel, etc.).
 *
 * Sprint 8 expanded CredentialType to cover the full Geekay credential universe.
 * CredentialCapability maps each document to the obligation(s) it satisfies.
 */

// ---------------------------------------------------------------------------
// CredentialCapability
// ---------------------------------------------------------------------------

/**
 * The operational capability a credential confers.
 *
 * Protocols evaluate obligations by capability — they don't care which specific
 * document satisfies the requirement, only that the person holds an active,
 * non-expired credential with the required capability.
 *
 * Multiple CredentialTypes can satisfy the same capability (e.g. both Passport
 * and NationalID satisfy Identity).
 */
export type CredentialCapability =
  | 'Identity'
  | 'Travel'
  | 'RightToWork'
  | 'RightToReside'
  | 'CompetitionEligibility'
  | 'TransferEligibility'
  | 'HealthCoverage'
  | 'HealthClearance'
  | 'FinancialAccess';

// ---------------------------------------------------------------------------
// CredentialType
// ---------------------------------------------------------------------------

/**
 * The physical/legal type of the credential document.
 *
 * This is what ops staff actually see and handle. A single CredentialType maps
 * to one or more CredentialCapabilities in the protocol evaluation logic.
 *
 * Categories:
 *   Identity & Residency  — Passport, NationalID, EmiratesID, Iqama, ResidencePermit, DriversLicense
 *   Visa & Entry          — Visa, EntryPermit, WorkPermit, LabourCard
 *   Competition           — LeagueRegistration, FederationLicense, TransferClearance
 *   Health                — InsuranceCard, MedicalClearance
 *   Financial             — BankAccount, TaxNumber
 *   Catch-all             — Other
 */
export type CredentialType =
  // Identity & Residency
  | 'Passport'
  | 'NationalID'
  | 'EmiratesID'
  | 'Iqama'
  | 'ResidencePermit'
  | 'DriversLicense'
  // Visa & Entry
  | 'Visa'
  | 'EntryPermit'
  | 'WorkPermit'
  | 'LabourCard'
  // Competition
  | 'LeagueRegistration'
  | 'FederationLicense'
  | 'TransferClearance'
  // Health
  | 'InsuranceCard'
  | 'MedicalClearance'
  // Financial
  | 'BankAccount'
  | 'TaxNumber'
  // Catch-all
  | 'Other';

// ---------------------------------------------------------------------------
// Credential
// ---------------------------------------------------------------------------

export interface Credential {
  /** Auto-generated integer PK (SharePoint list item ID). */
  Id: number;

  /** Human-readable unique ID, e.g. "CRED-0042". */
  CredentialID: string;

  /** PersonID of the credential holder. Foreign key to the People list. */
  HolderPersonID: string;

  /** The type of document. */
  Type: CredentialType;

  /** The document's own reference number (passport number, visa number, etc.). */
  ReferenceNumber: string;

  /** Issuing authority (e.g. "UAE GDRFA", "IESF"). Optional. */
  IssuedBy?: string;

  /** ISO 8601 date the document was issued. Optional. */
  IssuedDate?: string;

  /** ISO 8601 expiry date. Null/absent means the document does not expire. */
  ExpiryDate?: string;

  /**
   * ISO 8601 date the document becomes valid.
   * Used for visas and permits that have a future start date.
   */
  ValidFromDate?: string;

  /** Discriminator for types with sub-variants (e.g. Visa subtype "Tourist", "Employment"). */
  SubType?: string;

  /** Free-text notes for ops staff. */
  Notes?: string;

  /** False when superseded or manually deactivated. Only active credentials satisfy obligations. */
  IsActive: boolean;

  /** CredentialID of the document this one replaces (renewal chain). */
  SupersedesCredentialID?: string;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type CreateCredentialInput = Omit<Credential, 'Id' | 'CredentialID' | 'IsActive'>;
