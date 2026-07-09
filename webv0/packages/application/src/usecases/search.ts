/**
 * search.ts — S3 global search (Track A, plan of record): one box → any id or
 * name, ACROSS ONLY WHAT THE ACTOR MAY SEE.
 *
 * The role boundary is the design: each domain is fanned out only when the
 * actor holds its read capability (agreements need canReadAgreements; the
 * approvals queue needs submit/review standing) — a denied domain is simply
 * absent from the results, the same truthful absence the registers use. Only
 * IDENTITY fields are matched and returned (ids, names, codes, types, titles)
 * — never financial values, notes, or directory data (members are deliberately
 * out of V1).
 *
 * Mechanics: in-memory case-insensitive substring over the existing RLS'd
 * list reads, capped per domain. Honest at Geekay scale (tens–hundreds of
 * rows/register, one org); the scale-up path is a pg_trgm index + SQL ILIKE
 * pushdown behind this same contract — the API shape doesn't change.
 */
import type { Actor } from '@c3web/domain';
import { assertReadPeople, canReadAgreements, canReviewApproval, canSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

export const SEARCH_RESULT_KINDS = [
  'person',
  'mission',
  'agreement',
  'entity',
  'credential',
  'journey',
  'kit',
  'apparel',
  'approval',
] as const;
export type SearchResultKind = (typeof SEARCH_RESULT_KINDS)[number];

export interface SearchResult {
  readonly kind: SearchResultKind;
  /** The canonical business id (PER-0001, MSN-0001, …). */
  readonly id: string;
  /** Primary display line, e.g. the person's name or the mission's name. */
  readonly title: string;
  /** Secondary context line, e.g. "SATR/2024/0001 · Riyadh". */
  readonly subtitle: string | null;
}

const PER_DOMAIN_LIMIT = 5;
const MIN_QUERY_LENGTH = 2;

export async function globalSearch(p: Persistence, actor: Actor, qRaw: string): Promise<SearchResult[]> {
  assertReadPeople(actor);
  const q = qRaw.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const reads = p.reads.forActor(actor);
  const hit = (...fields: Array<string | null | undefined>): boolean =>
    fields.some((f) => typeof f === 'string' && f.toLowerCase().includes(q));
  const take = <T>(rows: T[]): T[] => rows.slice(0, PER_DOMAIN_LIMIT);

  const showAgreements = canReadAgreements(actor.role);
  const showApprovals = canSubmitApproval(actor.role) || canReviewApproval(actor.role);

  const [people, missions, agreements, entities, credentials, journeys, kit, apparel, approvals] = await Promise.all([
    reads.listPeople(),
    reads.listMissions(),
    showAgreements ? reads.listAgreements() : Promise.resolve([]),
    reads.listEntities(),
    reads.listCredentials(),
    reads.listJourneys(),
    reads.listKit(),
    reads.listApparel(),
    showApprovals ? reads.listApprovals() : Promise.resolve([]),
  ]);

  const results: SearchResult[] = [
    ...take(people.filter((x) => hit(x.personId, x.fullName, x.ign, x.personnelCode))).map((x) => ({
      kind: 'person' as const,
      id: x.personId,
      title: x.fullName,
      subtitle: [x.ign, x.currentTeam].filter(Boolean).join(' · ') || null,
    })),
    ...take(missions.filter((x) => hit(x.missionId, x.name, x.code, x.organizer, x.city))).map((x) => ({
      kind: 'mission' as const,
      id: x.missionId,
      title: x.name,
      subtitle: [x.code, x.city].filter(Boolean).join(' · ') || null,
    })),
    // Identity fields only — never the value/terms (canViewFinancials is a
    // stricter gate than canReadAgreements and search must not out-leak it).
    ...take(agreements.filter((x) => hit(x.agreementId, x.agreementCode, x.agreementType, x.personId, x.entityId))).map((x) => ({
      kind: 'agreement' as const,
      id: x.agreementId,
      title: x.agreementCode ?? x.agreementId,
      subtitle: [x.agreementType, x.personId ?? x.entityId].filter(Boolean).join(' · ') || null,
    })),
    ...take(entities.filter((x) => hit(x.entityId, x.name, x.code, x.jurisdiction))).map((x) => ({
      kind: 'entity' as const,
      id: x.entityId,
      title: x.name,
      subtitle: [x.code, x.jurisdiction].filter(Boolean).join(' · ') || null,
    })),
    ...take(credentials.filter((x) => hit(x.credentialId, x.credentialType, x.personId, x.issuer))).map((x) => ({
      kind: 'credential' as const,
      id: x.credentialId,
      title: x.credentialType,
      subtitle: x.personId,
    })),
    ...take(journeys.filter((x) => hit(x.journeyId, x.title, x.journeyType, x.personId))).map((x) => ({
      kind: 'journey' as const,
      id: x.journeyId,
      title: x.title ?? x.journeyType,
      subtitle: [x.journeyType, x.personId].filter(Boolean).join(' · ') || null,
    })),
    ...take(kit.filter((x) => hit(x.kitId, x.name, x.category, x.assignedPersonId))).map((x) => ({
      kind: 'kit' as const,
      id: x.kitId,
      title: x.name,
      subtitle: x.assignedPersonId,
    })),
    ...take(apparel.filter((x) => hit(x.apparelId, x.name, x.category, x.assignedPersonId))).map((x) => ({
      kind: 'apparel' as const,
      id: x.apparelId,
      title: x.name,
      subtitle: x.assignedPersonId,
    })),
    ...take(approvals.filter((x) => hit(x.approvalId, x.operationType, x.targetPersonId, x.targetId))).map((x) => ({
      kind: 'approval' as const,
      id: x.approvalId,
      title: x.operationType,
      subtitle: [x.status, x.targetPersonId].filter(Boolean).join(' · ') || null,
    })),
  ];
  return results;
}
