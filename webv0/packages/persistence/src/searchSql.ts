/**
 * searchSql.ts — S3.1 Search Elevation (+ M-04): global search IN PostgreSQL.
 *
 * One UNION ALL statement, one round-trip: each included domain contributes a
 * parenthesized SELECT with its OWN rank + recency ordering and its OWN LIMIT,
 * so the database transfers at most (domains × limit) identity rows — never a
 * whole register (the M-04 scale repair). RLS applies inside every branch.
 *
 * Ranking: exact business-id/title match (0) beats prefix (1) beats substring
 * (2); recency (updated_at) breaks ties. Matching is case-insensitive LIKE
 * with escaped metacharacters — pg_trgm remains the documented scale-up path
 * behind this same contract.
 *
 * The ROLE BOUNDARY is the caller's: the application layer decides which
 * domains are included (finance domains need canViewFinancials, agreements
 * canReadAgreements, approvals submit/review standing), narrows CLAIMS to the
 * caller's own submissions for non-finance roles, and allowlists DOCUMENT
 * owner types — search must never out-leak a register the role cannot open.
 * Only IDENTITY fields are matched and returned — never money, notes, or
 * directory data.
 */
import { sql, type SQL } from 'drizzle-orm';
import { SEARCH_DOMAINS, type SearchDomain, type TenantSearchSpec } from '@c3web/application';

/** Escape LIKE metacharacters (backslash is Postgres' default LIKE escape). */
export function escapeLike(q: string): string {
  return q.replace(/[\\%_]/g, (m) => `\\${m}`);
}

interface DomainSpec {
  readonly kind: SearchDomain;
  readonly table: string;
  /** Identity columns matched against the query (first = the business id). */
  readonly match: readonly string[];
  /** SQL expression for the returned id (the business id column). */
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly parent: string;
  /** Extra static WHERE (raw SQL, no user input). */
  readonly extraWhere?: string;
}

const D = (spec: DomainSpec): DomainSpec => spec;

const DOMAIN_SPECS: Record<SearchDomain, DomainSpec> = {
  person: D({
    kind: 'person',
    table: 'person',
    match: ['person_id', 'full_name', 'ign', 'personnel_code'],
    id: 'person_id',
    title: 'full_name',
    subtitle: `nullif(concat_ws(' · ', ign, current_team), '')`,
    parent: 'NULL',
  }),
  mission: D({
    kind: 'mission',
    table: 'mission',
    match: ['mission_id', 'name', 'code', 'organizer', 'city'],
    id: 'mission_id',
    title: 'name',
    subtitle: `nullif(concat_ws(' · ', code, city), '')`,
    parent: 'NULL',
  }),
  agreement: D({
    kind: 'agreement',
    table: 'agreement',
    match: ['agreement_id', 'agreement_code', 'agreement_type', 'person_id', 'entity_id'],
    id: 'agreement_id',
    title: 'coalesce(agreement_code, agreement_id)',
    subtitle: `nullif(concat_ws(' · ', agreement_type, coalesce(person_id, entity_id)), '')`,
    parent: 'NULL',
  }),
  entity: D({
    kind: 'entity',
    table: 'entity',
    match: ['entity_id', 'name', 'code', 'jurisdiction'],
    id: 'entity_id',
    title: 'name',
    subtitle: `nullif(concat_ws(' · ', code, jurisdiction), '')`,
    parent: 'NULL',
  }),
  credential: D({
    kind: 'credential',
    table: 'credential',
    match: ['credential_id', 'credential_type', 'person_id', 'issuer'],
    id: 'credential_id',
    title: 'credential_type',
    subtitle: 'person_id',
    parent: 'person_id',
  }),
  journey: D({
    kind: 'journey',
    table: 'journey',
    match: ['journey_id', 'title', 'journey_type', 'person_id'],
    id: 'journey_id',
    title: 'coalesce(title, journey_type)',
    subtitle: `nullif(concat_ws(' · ', journey_type, person_id), '')`,
    parent: 'person_id',
  }),
  kit: D({
    kind: 'kit',
    table: 'kit',
    match: ['kit_id', 'name', 'category', 'assigned_person_id'],
    id: 'kit_id',
    title: 'name',
    subtitle: 'assigned_person_id',
    parent: 'assigned_person_id',
  }),
  apparel: D({
    kind: 'apparel',
    table: 'apparel',
    match: ['apparel_id', 'name', 'category', 'assigned_person_id'],
    id: 'apparel_id',
    title: 'name',
    subtitle: 'assigned_person_id',
    parent: 'assigned_person_id',
  }),
  approval: D({
    kind: 'approval',
    table: 'approval',
    match: ['approval_id', 'operation_type', 'target_person_id', 'target_id'],
    id: 'approval_id',
    title: 'operation_type',
    subtitle: `nullif(concat_ws(' · ', status, target_person_id), '')`,
    parent: 'NULL',
  }),
  team: D({
    kind: 'team',
    table: 'team',
    match: ['team_id', 'name', 'code', 'game_title'],
    id: 'team_id',
    title: 'name',
    subtitle: `nullif(concat_ws(' · ', code, kind), '')`,
    parent: 'NULL',
  }),
  invoice: D({
    kind: 'invoice',
    table: 'invoice',
    match: ['invoice_id', 'invoice_number', 'billed_to_name'],
    id: 'invoice_id',
    title: 'invoice_number',
    subtitle: `nullif(concat_ws(' · ', billed_to_name, status), '')`,
    parent: 'mission_id',
  }),
  claim: D({
    kind: 'claim',
    table: 'claim',
    match: ['claim_id', 'description', 'category'],
    id: 'claim_id',
    title: 'description',
    subtitle: `nullif(concat_ws(' · ', category, status), '')`,
    parent: 'NULL',
  }),
  distribution: D({
    kind: 'distribution',
    table: 'distribution',
    match: ['distribution_id', 'mission_id', 'line_id'],
    id: 'distribution_id',
    title: 'distribution_id',
    subtitle: `nullif(concat_ws(' · ', status, mission_id), '')`,
    parent: 'mission_id',
  }),
  document: D({
    kind: 'document',
    table: 'document',
    match: ['document_id', 'file_name', 'label'],
    id: 'document_id',
    title: 'file_name',
    subtitle: `nullif(concat_ws(' · ', owner_type, owner_id), '')`,
    parent: `owner_type || ':' || owner_id`,
    extraWhere: 'is_active',
  }),
  term: D({
    kind: 'term',
    table: 'agreement_term',
    match: ['term_id', 'kind', 'label', 'agreement_id'],
    id: 'term_id',
    title: 'coalesce(label, kind)',
    subtitle: `nullif(concat_ws(' · ', kind, agreement_id), '')`,
    parent: 'agreement_id',
    extraWhere: 'is_active',
  }),
  line: D({
    kind: 'line',
    table: 'mission_line',
    match: ['line_id', 'ref_no', 'label'],
    id: 'line_id',
    title: 'label',
    subtitle: `nullif(concat_ws(' · ', ref_no, mission_id), '')`,
    parent: 'mission_id',
    extraWhere: 'is_active',
  }),
  beneficiary: D({
    kind: 'beneficiary',
    table: 'beneficiary',
    match: ['beneficiary_id', 'label', 'bank_name'],
    id: 'beneficiary_id',
    title: 'label',
    subtitle: `nullif(concat_ws(' · ', bank_name, coalesce(person_id, freelancer_id, vendor_id), status), '')`,
    parent: 'person_id',
  }),
};

/** One parenthesized, ranked, limited SELECT for a domain. */
function domainBlock(spec: TenantSearchSpec, d: DomainSpec): SQL {
  const like = `%${escapeLike(spec.q)}%`;
  const prefix = `${escapeLike(spec.q)}%`;
  const exact = spec.q;

  const matchExprs = d.match.map((col) => sql.raw(`lower(${col})`));
  const hit = sql.join(
    matchExprs.map((e) => sql`${e} LIKE ${like}`),
    sql` OR `,
  );
  const exactHit = sql.join(
    matchExprs.map((e) => sql`${e} = ${exact}`),
    sql` OR `,
  );
  const prefixHit = sql.join(
    matchExprs.map((e) => sql`${e} LIKE ${prefix}`),
    sql` OR `,
  );

  const guards: SQL[] = [sql`(${hit})`];
  if (d.extraWhere) guards.push(sql.raw(`(${d.extraWhere})`));
  if (d.kind === 'claim' && spec.claimsOwnIdentity !== null) guards.push(sql`submitted_by = ${spec.claimsOwnIdentity}`);
  if (d.kind === 'document') {
    if (spec.documentOwnerTypes.length === 0) guards.push(sql.raw('false'));
    else
      guards.push(
        sql`owner_type IN (${sql.join(
          spec.documentOwnerTypes.map((t) => sql`${t}`),
          sql`, `,
        )})`,
      );
  }

  return sql`(SELECT ${sql.raw(`'${d.kind}'`)} AS kind,
      ${sql.raw(d.id)} AS id,
      ${sql.raw(d.title)} AS title,
      ${sql.raw(d.subtitle)} AS subtitle,
      ${sql.raw(d.parent)} AS parent_id,
      (CASE WHEN ${exactHit} THEN 0 WHEN ${prefixHit} THEN 1 ELSE 2 END) AS rank,
      updated_at
    FROM ${sql.raw(d.table)}
    WHERE ${sql.join(guards, sql` AND `)}
    ORDER BY rank, updated_at DESC
    LIMIT ${spec.limitPerDomain})`;
}

/**
 * The full statement. Result order: rank, then recency, then a stable kind
 * order (the SEARCH_DOMAINS declaration) — deterministic across runs.
 */
export function buildSearchQuery(spec: TenantSearchSpec): SQL {
  const blocks = spec.domains.map((k) => domainBlock(spec, DOMAIN_SPECS[k]));
  const kindOrder = SEARCH_DOMAINS.map((k, i) => `WHEN '${k}' THEN ${i}`).join(' ');
  return sql`SELECT kind, id, title, subtitle, parent_id
    FROM (${sql.join(blocks, sql` UNION ALL `)}) AS hits
    ORDER BY rank, (CASE kind ${sql.raw(kindOrder)} ELSE 99 END), updated_at DESC`;
}
