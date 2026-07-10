/**
 * dataQuality.ts — S5 riders (plan of record, promoted 2026-07-10):
 * the DATA-QUALITY REPORT + DUPLICATE DETECTION.
 *
 * Import enforces the HARD rules (keys unique, references exist, all-or-
 * nothing); this report carries the SOFT signals a strict import must not
 * block on — potential duplicate people, incomplete profiles, credentials and
 * agreements whose dates have quietly gone stale. It is a review surface, not
 * a gate: it names records, it never mutates.
 *
 * Duplicate detection is exact-after-normalization (trim, lowercase, collapse
 * whitespace) on fullName / ign / personnelCode — no fuzzy matching in V1, so
 * every flagged group is a fact, not a guess. Inactive people ARE included in
 * duplicate groups (re-importing someone who exists as history is the classic
 * mistake) and are marked so the reviewer sees why.
 *
 * Pure derivation over structurally-typed rows (the search.ts pattern):
 * callers feed it whatever their reads return; `today` is injected so the
 * date checks are deterministic and testable.
 */

// ── the rows this report reads (structural — persistence stays unknown) ─────

export interface DqPersonRow {
  readonly personId: string;
  readonly fullName: string;
  readonly ign: string | null;
  readonly nationality: string | null;
  readonly primaryRole: string | null;
  readonly personnelCode: string | null;
  readonly isActive: boolean;
}

export interface DqCredentialRow {
  readonly credentialId: string;
  readonly personId: string;
  readonly credentialType: string;
  readonly expiresOn: string | null;
  readonly isActive: boolean;
}

export interface DqAgreementRow {
  readonly agreementId: string;
  readonly agreementType: string;
  readonly agreementCode: string | null;
  readonly personId: string | null;
  readonly entityId: string | null;
  readonly endsOn: string;
  readonly status: string;
}

// ── the report ───────────────────────────────────────────────────────────────

export const DUPLICATE_REASONS = ['fullName', 'ign', 'personnelCode'] as const;
export type DuplicateReason = (typeof DUPLICATE_REASONS)[number];

export interface DuplicatePersonGroup {
  readonly reason: DuplicateReason;
  /** The shared value as first seen (original casing). */
  readonly value: string;
  readonly people: ReadonlyArray<{ readonly personId: string; readonly fullName: string; readonly isActive: boolean }>;
}

export interface PersonRef {
  readonly personId: string;
  readonly fullName: string;
}

export interface CredentialRef {
  readonly credentialId: string;
  readonly personId: string;
  readonly credentialType: string;
  readonly expiresOn: string | null;
}

export interface AgreementRef {
  readonly agreementId: string;
  readonly agreementType: string;
  readonly anchor: string;
  readonly endsOn: string;
}

export interface DataQualityReport {
  readonly duplicatePeople: readonly DuplicatePersonGroup[];
  readonly peopleMissingNationality: readonly PersonRef[];
  readonly peopleMissingRole: readonly PersonRef[];
  readonly peopleMissingPersonnelCode: readonly PersonRef[];
  readonly activeCredentialsPastExpiry: readonly CredentialRef[];
  readonly credentialsWithoutExpiry: readonly CredentialRef[];
  readonly activeAgreementsPastEnd: readonly AgreementRef[];
  readonly activeAgreementsWithoutCode: readonly AgreementRef[];
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

function duplicateGroups(people: readonly DqPersonRow[], reason: DuplicateReason, field: (p: DqPersonRow) => string | null): DuplicatePersonGroup[] {
  const byValue = new Map<string, { value: string; people: Array<{ personId: string; fullName: string; isActive: boolean }> }>();
  for (const p of people) {
    const raw = field(p);
    if (!raw || raw.trim() === '') continue;
    const key = norm(raw);
    const entry = byValue.get(key) ?? { value: raw.trim(), people: [] };
    entry.people.push({ personId: p.personId, fullName: p.fullName, isActive: p.isActive });
    byValue.set(key, entry);
  }
  return [...byValue.values()]
    .filter((g) => g.people.length > 1)
    .map((g) => ({ reason, value: g.value, people: g.people.sort((a, b) => a.personId.localeCompare(b.personId)) }))
    .sort((a, b) => a.value.localeCompare(b.value));
}

/**
 * Build the report. `today` is an ISO date (YYYY-MM-DD); "past" means
 * STRICTLY before it — a credential expiring today is not yet stale.
 */
export function buildDataQualityReport(
  rows: {
    readonly people: readonly DqPersonRow[];
    readonly credentials: readonly DqCredentialRow[];
    readonly agreements: readonly DqAgreementRow[];
  },
  today: string,
): DataQualityReport {
  const activePeople = rows.people.filter((p) => p.isActive);
  const ref = (p: DqPersonRow): PersonRef => ({ personId: p.personId, fullName: p.fullName });
  const missing = (v: string | null): boolean => !v || v.trim() === '';
  const byPerson = (a: PersonRef, b: PersonRef) => a.personId.localeCompare(b.personId);
  const byCredential = (a: CredentialRef, b: CredentialRef) => a.credentialId.localeCompare(b.credentialId);
  const byAgreement = (a: AgreementRef, b: AgreementRef) => a.agreementId.localeCompare(b.agreementId);

  const credRef = (c: DqCredentialRow): CredentialRef => ({
    credentialId: c.credentialId,
    personId: c.personId,
    credentialType: c.credentialType,
    expiresOn: c.expiresOn,
  });
  const activeCredentials = rows.credentials.filter((c) => c.isActive);

  const agrRef = (a: DqAgreementRow): AgreementRef => ({
    agreementId: a.agreementId,
    agreementType: a.agreementType,
    anchor: a.personId ?? a.entityId ?? '—',
    endsOn: a.endsOn,
  });
  const activeAgreements = rows.agreements.filter((a) => a.status === 'Active');

  return {
    duplicatePeople: [
      ...duplicateGroups(rows.people, 'fullName', (p) => p.fullName),
      ...duplicateGroups(rows.people, 'ign', (p) => p.ign),
      ...duplicateGroups(rows.people, 'personnelCode', (p) => p.personnelCode),
    ],
    peopleMissingNationality: activePeople.filter((p) => missing(p.nationality)).map(ref).sort(byPerson),
    peopleMissingRole: activePeople.filter((p) => missing(p.primaryRole)).map(ref).sort(byPerson),
    peopleMissingPersonnelCode: activePeople.filter((p) => missing(p.personnelCode)).map(ref).sort(byPerson),
    activeCredentialsPastExpiry: activeCredentials
      .filter((c) => c.expiresOn !== null && c.expiresOn < today)
      .map(credRef)
      .sort(byCredential),
    credentialsWithoutExpiry: activeCredentials
      .filter((c) => c.expiresOn === null)
      .map(credRef)
      .sort(byCredential),
    activeAgreementsPastEnd: activeAgreements
      .filter((a) => a.endsOn < today)
      .map(agrRef)
      .sort(byAgreement),
    activeAgreementsWithoutCode: activeAgreements
      .filter((a) => missing(a.agreementCode))
      .map(agrRef)
      .sort(byAgreement),
  };
}
