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

export type BusinessIdKind =
  | 'person'
  | 'approval'
  | 'credential'
  | 'journey'
  | 'kit'
  | 'apparel'
  | 'mission'
  | 'missionLine'
  | 'document'
  | 'agreement'
  | 'agreementTerm'
  | 'entity'
  | 'invoice'
  | 'team';

const PREFIX: Record<BusinessIdKind, string> = {
  person: 'PER',
  approval: 'APR',
  credential: 'CRED',
  journey: 'JRN',
  kit: 'KIT',
  apparel: 'APL',
  mission: 'MSN',
  missionLine: 'PNL',
  document: 'DOC',
  agreement: 'AGR',
  agreementTerm: 'TRM',
  entity: 'ENT',
  invoice: 'INV',
  team: 'TEAM',
};

const PATTERN: Record<BusinessIdKind, RegExp> = {
  person: /^PER-\d{4,}$/,
  approval: /^APR-\d{4,}$/,
  credential: /^CRED-\d{4,}$/,
  journey: /^JRN-\d{4,}$/,
  kit: /^KIT-\d{4,}$/,
  apparel: /^APL-\d{4,}$/,
  mission: /^MSN-\d{4,}$/,
  missionLine: /^PNL-\d{4,}$/,
  document: /^DOC-\d{4,}$/,
  agreement: /^AGR-\d{4,}$/,
  agreementTerm: /^TRM-\d{4,}$/,
  entity: /^ENT-\d{4,}$/,
  invoice: /^INV-\d{4,}$/,
  team: /^TEAM-\d{4,}$/,
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
export const formatMissionId = (sequence: number): string => formatBusinessId('mission', sequence);
export const formatMissionLineId = (sequence: number): string => formatBusinessId('missionLine', sequence);
export const formatDocumentId = (sequence: number): string => formatBusinessId('document', sequence);
export const formatAgreementId = (sequence: number): string => formatBusinessId('agreement', sequence);
export const formatAgreementTermId = (sequence: number): string => formatBusinessId('agreementTerm', sequence);
export const formatEntityId = (sequence: number): string => formatBusinessId('entity', sequence);
export const formatInvoiceId = (sequence: number): string => formatBusinessId('invoice', sequence);
export const formatTeamId = (sequence: number): string => formatBusinessId('team', sequence);

export function isBusinessId(kind: BusinessIdKind, value: unknown): value is string {
  return typeof value === 'string' && PATTERN[kind].test(value);
}

export const isPersonId = (value: unknown): value is string => isBusinessId('person', value);
export const isApprovalId = (value: unknown): value is string => isBusinessId('approval', value);
export const isCredentialId = (value: unknown): value is string => isBusinessId('credential', value);
export const isJourneyId = (value: unknown): value is string => isBusinessId('journey', value);
export const isKitId = (value: unknown): value is string => isBusinessId('kit', value);
export const isApparelId = (value: unknown): value is string => isBusinessId('apparel', value);
export const isMissionId = (value: unknown): value is string => isBusinessId('mission', value);
export const isMissionLineId = (value: unknown): value is string => isBusinessId('missionLine', value);
export const isDocumentId = (value: unknown): value is string => isBusinessId('document', value);
export const isAgreementId = (value: unknown): value is string => isBusinessId('agreement', value);
export const isAgreementTermId = (value: unknown): value is string => isBusinessId('agreementTerm', value);
export const isEntityId = (value: unknown): value is string => isBusinessId('entity', value);

/**
 * Placeholder written to an AddPerson approval's target person field at
 * submission time — the person does not exist until execution allocates a
 * real PER-XXXX. Preserved from the reference (ADR-013 AddPerson pattern).
 */
export const PENDING_ADD_PERSON_TARGET = 'PENDING-ADDPERSON';
