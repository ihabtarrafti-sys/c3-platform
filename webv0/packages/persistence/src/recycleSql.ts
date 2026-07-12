/**
 * recycleSql.ts — Track B2: the Recycle Bin read, one statement.
 *
 * A UNION ALL over the whole-record soft-delete domains (the searchSql
 * pattern): each branch selects `is_active = false` rows in a uniform shape
 * and looks up removal provenance from the LATEST *deactivation* audit_event
 * for that entity (M-11). We must NOT trust the row's updated_at nor its latest
 * event of any kind: inactive rows accept permitted direct-audited edits (e.g.
 * a credential's issuer/notes, a kit's assignment), so the newest event — and
 * updated_at — can post-date the actual removal. Filtering to the domain's
 * deactivate action, ordered (at DESC, id DESC) for a deterministic tie-break,
 * pins the true remover + removal time. RLS applies to every branch and to
 * audit_event.
 */
import { sql, type SQL } from 'drizzle-orm';
import { RESTORE_CLASS_OF, type RecycleKind } from '@c3web/domain';

interface Branch {
  readonly kind: RecycleKind;
  readonly table: string;
  readonly idCol: string;
  /** Business-id column used as the record id AND the audit_event.entity_id key. */
  readonly auditType: string;
  /** The domain's deactivation audit action — the row's removal is attributed
   *  to the latest event of THIS action, never to a later permitted edit. */
  readonly deactivateAction: string;
  readonly labelExpr: string;
  readonly sublabelExpr: string;
  readonly parentExpr: string;
  // restoreClass is NOT duplicated here — it comes from the domain RESTORE_CLASS_OF
  // (single source of truth), so the bin list can never drift from the dispatch.
}

const BRANCHES: readonly Branch[] = [
  { kind: 'person', table: 'person', idCol: 'person_id', auditType: 'Person', deactivateAction: 'PersonDeactivated', labelExpr: 'full_name', sublabelExpr: `nullif(ign, '')`, parentExpr: 'NULL' },
  { kind: 'entity', table: 'entity', idCol: 'entity_id', auditType: 'Entity', deactivateAction: 'EntityDeactivated', labelExpr: 'name', sublabelExpr: `nullif(concat_ws(' · ', code, jurisdiction), '')`, parentExpr: 'NULL' },
  { kind: 'team', table: 'team', idCol: 'team_id', auditType: 'Team', deactivateAction: 'TeamDeactivated', labelExpr: 'name', sublabelExpr: `nullif(concat_ws(' · ', code, kind), '')`, parentExpr: 'NULL' },
  { kind: 'credential', table: 'credential', idCol: 'credential_id', auditType: 'Credential', deactivateAction: 'CredentialDeactivated', labelExpr: 'credential_type', sublabelExpr: 'person_id', parentExpr: 'person_id' },
  { kind: 'kit', table: 'kit', idCol: 'kit_id', auditType: 'Kit', deactivateAction: 'KitDeactivated', labelExpr: 'name', sublabelExpr: `nullif(concat_ws(' · ', category, assigned_person_id), '')`, parentExpr: 'assigned_person_id' },
  { kind: 'apparel', table: 'apparel', idCol: 'apparel_id', auditType: 'Apparel', deactivateAction: 'ApparelDeactivated', labelExpr: 'name', sublabelExpr: `nullif(concat_ws(' · ', category, assigned_person_id), '')`, parentExpr: 'assigned_person_id' },
];

export interface RecycleRow {
  readonly kind: string;
  readonly id: string;
  readonly label: string;
  readonly sublabel: string | null;
  readonly parent_id: string | null;
  readonly removed_at: string;
  readonly removed_by: string | null;
  readonly version: number;
  readonly restore_class: string;
}

function branchSelect(b: Branch): SQL {
  // The removal event: the LATEST row whose action is this domain's deactivate,
  // ordered (at DESC, id DESC) so ties resolve deterministically. removed_at
  // falls back to updated_at only when no deactivation event exists (e.g. a
  // legacy row seeded inactive), keeping the column non-null and the ORDER BY
  // stable.
  const removalEvent = (col: string): string => `(SELECT ae.${col} FROM audit_event ae
        WHERE ae.entity_type = '${b.auditType}' AND ae.entity_id = ${b.table}.${b.idCol}
          AND ae.action = '${b.deactivateAction}'
        ORDER BY ae.at DESC, ae.id DESC LIMIT 1)`;
  return sql.raw(`SELECT
      '${b.kind}' AS kind,
      ${b.idCol} AS id,
      ${b.labelExpr} AS label,
      ${b.sublabelExpr} AS sublabel,
      ${b.parentExpr} AS parent_id,
      COALESCE(${removalEvent('at')}, updated_at) AS removed_at,
      version AS version,
      '${RESTORE_CLASS_OF[b.kind]}' AS restore_class,
      ${removalEvent('actor')} AS removed_by
    FROM ${b.table}
    WHERE is_active = false`);
}

/** The full recycle-bin statement: newest removal first, then a stable kind/id order. */
export function buildRecycleQuery(): SQL {
  const blocks = BRANCHES.map(branchSelect);
  return sql`SELECT kind, id, label, sublabel, parent_id, removed_at, removed_by, version, restore_class
    FROM (${sql.join(blocks, sql` UNION ALL `)}) AS removed
    ORDER BY removed_at DESC, kind ASC, id ASC`;
}
