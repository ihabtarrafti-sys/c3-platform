/**
 * search.ts — S3.1 Search Elevation: one box → any id or name, ACROSS ONLY
 * WHAT THE ACTOR MAY SEE ("search ships with features" — the standing law).
 *
 * The role boundary IS the design: a domain is included only when the actor
 * holds its read capability — finance registers (invoices, distributions,
 * P&L lines, agreement terms, beneficiaries) need canViewFinancials,
 * agreements need canReadAgreements, the approvals queue needs submit/review
 * standing, claims narrow to the actor's OWN submissions for non-finance
 * roles, and document hits allowlist owner types the role can open. A denied
 * domain is simply ABSENT — the same truthful absence the registers use.
 * Only IDENTITY fields are matched and returned (ids, names, codes, labels,
 * filenames, bank REFERENCE numbers) — never money values, notes, or
 * directory data.
 *
 * Mechanics (M-04): pushed into PostgreSQL — one UNION ALL statement with
 * per-domain rank + LIMIT (exact > prefix > substring, recency tiebreak), so
 * the transfer is bounded by (domains × limit), never a whole register.
 */
import type { Actor } from '@c3web/domain';
import { assertReadPeople, canReadAgreements, canReviewApproval, canSubmitApproval, canSubmitClaim, canViewFinancials } from '@c3web/authz';
import type { Persistence, SearchDomain } from '../ports';

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
  'team',
  'invoice',
  'claim',
  'distribution',
  'document',
  'term',
  'line',
  'beneficiary',
] as const;
export type SearchResultKind = (typeof SEARCH_RESULT_KINDS)[number];

export interface SearchResult {
  readonly kind: SearchResultKind;
  /** The canonical business id (PER-0001, MSN-0001, INV-0001, …). */
  readonly id: string;
  /** Primary display line, e.g. the person's name or the invoice number. */
  readonly title: string;
  /** Secondary context line, e.g. "SATR/2024/0001 · Riyadh". */
  readonly subtitle: string | null;
  /**
   * The OWNING record's business id for child records (term→AGR, line→MSN,
   * distribution→MSN, beneficiary→PER); documents carry "OwnerType:OWNER-ID".
   * Null for top-level records — the web routes hits through this.
   */
  readonly parentId: string | null;
}

const PER_DOMAIN_LIMIT = 5;
const MIN_QUERY_LENGTH = 2;

export async function globalSearch(p: Persistence, actor: Actor, qRaw: string): Promise<SearchResult[]> {
  assertReadPeople(actor);
  const q = qRaw.trim().toLowerCase();
  if (q.length < MIN_QUERY_LENGTH) return [];

  const finance = canViewFinancials(actor.role);
  const domains: SearchDomain[] = ['person', 'mission', 'entity', 'credential', 'journey', 'kit', 'apparel', 'team'];
  if (canReadAgreements(actor.role)) domains.push('agreement');
  if (canSubmitApproval(actor.role) || canReviewApproval(actor.role)) domains.push('approval');
  if (canSubmitClaim(actor.role)) domains.push('claim');
  if (finance) domains.push('invoice', 'distribution', 'term', 'line', 'beneficiary');

  // Documents follow their OWNER's read gate, type by type.
  const documentOwnerTypes = ['Person', 'Mission', 'Credential', 'Entity'];
  if (canReadAgreements(actor.role)) documentOwnerTypes.push('Agreement');
  if (finance) documentOwnerTypes.push('Invoice', 'Claim');
  domains.push('document');

  const rows = await p.reads.forActor(actor).searchTenant({
    q,
    limitPerDomain: PER_DOMAIN_LIMIT,
    domains,
    claimsOwnIdentity: finance ? null : actor.identity,
    documentOwnerTypes,
  });

  return rows.map((r) => ({
    kind: r.kind as SearchResultKind,
    id: r.id,
    title: r.title,
    subtitle: r.subtitle,
    parentId: r.parent_id,
  }));
}
