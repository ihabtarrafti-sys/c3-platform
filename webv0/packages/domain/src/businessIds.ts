/**
 * businessIds.ts — canonical business identifiers.
 *
 * PersonID (PER-XXXX) and ApprovalID (APR-XXXX) are the DOMAIN identity of a
 * record — never the database surrogate key, never a parsed list Title. The
 * reference implementation derived these from SharePoint numeric item IDs;
 * that coupling is removed. Here a sequence number (allocated atomically and
 * server-side by @c3web/persistence's business_id_counter) is formatted into
 * the canonical string.
 *
 * Formatting is pure and deterministic. Parsing is provided for display/tests
 * only — the domain never treats the numeric suffix as an addressable key.
 */

const MIN_WIDTH = 4;

export type BusinessIdKind = 'person' | 'approval' | 'credential' | 'journey' | 'kit' | 'apparel';

const PREFIX: Record<BusinessIdKind, string> = {
  person: 'PER',
  approval: 'APR',
  credential: 'CRED',
  journey: 'JRN',
  kit: 'KIT',
  apparel: 'APL',
};

const PATTERN: Record<BusinessIdKind, RegExp> = {
  person: /^PER-\d{4,}$/,
  approval: /^APR-\d{4,}$/,
  credential: /^CRED-\d{4,}$/,
  journey: /^JRN-\d{4,}$/,
  kit: /^KIT-\d{4,}$/,
  apparel: /^APL-\d{4,}$/,
};

/** Format an allocated sequence number into a canonical business ID. */
export function formatBusinessId(kind: BusinessIdKind, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence <= 0) {
    throw new RangeError(`Business ID sequence must be a positive integer, got ${sequence}`);
  }
  return `${PREFIX[kind]}-${String(sequence).padStart(MIN_WIDTH, '0')}`;
}

export const formatPersonId = (sequence: number): string => formatBusinessId('person', sequence);
export const formatApprovalId = (sequence: number): string => formatBusinessId('approval', sequence);
export const formatCredentialId = (sequence: number): string => formatBusinessId('credential', sequence);
export const formatJourneyId = (sequence: number): string => formatBusinessId('journey', sequence);
export const formatKitId = (sequence: number): string => formatBusinessId('kit', sequence);
export const formatApparelId = (sequence: number): string => formatBusinessId('apparel', sequence);

export function isBusinessId(kind: BusinessIdKind, value: unknown): value is string {
  return typeof value === 'string' && PATTERN[kind].test(value);
}

export const isPersonId = (value: unknown): value is string => isBusinessId('person', value);
export const isApprovalId = (value: unknown): value is string => isBusinessId('approval', value);
export const isCredentialId = (value: unknown): value is string => isBusinessId('credential', value);
export const isJourneyId = (value: unknown): value is string => isBusinessId('journey', value);
export const isKitId = (value: unknown): value is string => isBusinessId('kit', value);
export const isApparelId = (value: unknown): value is string => isBusinessId('apparel', value);

/**
 * Placeholder written to an AddPerson approval's target person field at
 * submission time — the person does not exist until execution allocates a
 * real PER-XXXX. Preserved from the reference (ADR-013 AddPerson pattern).
 */
export const PENDING_ADD_PERSON_TARGET = 'PENDING-ADDPERSON';
