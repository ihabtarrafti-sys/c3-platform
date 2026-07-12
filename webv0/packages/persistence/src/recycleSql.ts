/**
 * recycleSql.ts — Track B2: the Recycle Bin read, one statement.
 *
 * A UNION ALL over the whole-record soft-delete domains (the searchSql
 * pattern): each branch selects `is_active = false` rows in a uniform shape
 * and looks up provenance from the LATEST audit_event for that entity — since
 * the record is currently inactive, its latest event IS the removal, by
 * construction. RLS applies to every branch and to audit_event.
 */
import { sql, type SQL } from 'drizzle-orm';
import { RESTORE_CLASS_OF, type RecycleKind } from '@c3web/domain';

interface Branch {
  readonly kind: RecycleKind;
  readonly table: string;
  readonly idCol: string;
  /** Business-id column used as the record id AND the audit_event.entity_id key. */
  readonly auditType: string;
  readonly labelExpr: string;
  readonly sublabelExpr: string;
  readonly parentExpr: string;
  // restoreClass is NOT duplicated here — it comes from the domain RESTORE_CLASS_OF
  // (single source of truth), so the bin list can never drift from the dispatch.
}

const BRANCHES: readonly Branch[] = [
  { kind: 'person', table: 'person', idCol: 'person_id', auditType: 'Person', labelExpr: 'full_name', sublabelExpr: `nullif(ign, '')`, parentExpr: 'NULL' },
  { kind: 'entity', table: 'entity', idCol: 'entity_id', auditType: 'Entity', labelExpr: 'name', sublabelExpr: `nullif(concat_ws(' · ', code, jurisdiction), '')`, parentExpr: 'NULL' },
  { kind: 'team', table: 'team', idCol: 'team_id', auditType: 'Team', labelExpr: 'name', sublabelExpr: `nullif(concat_ws(' · ', code, kind), '')`, parentExpr: 'NULL' },
  { kind: 'credential', table: 'credential', idCol: 'credential_id', auditType: 'Credential', labelExpr: 'credential_type', sublabelExpr: 'person_id', parentExpr: 'person_id' },
  { kind: 'kit', table: 'kit', idCol: 'kit_id', auditType: 'Kit', labelExpr: 'name', sublabelExpr: `nullif(concat_ws(' · ', category, assigned_person_id), '')`, parentExpr: 'assigned_person_id' },
  { kind: 'apparel', table: 'apparel', idCol: 'apparel_id', auditType: 'Apparel', labelExpr: 'name', sublabelExpr: `nullif(concat_ws(' · ', category, assigned_person_id), '')`, parentExpr: 'assigned_person_id' },
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
  return sql.raw(`SELECT
      '${b.kind}' AS kind,
      ${b.idCol} AS id,
      ${b.labelExpr} AS label,
      ${b.sublabelExpr} AS sublabel,
      ${b.parentExpr} AS parent_id,
      updated_at AS removed_at,
      version AS version,
      '${RESTORE_CLASS_OF[b.kind]}' AS restore_class,
      (SELECT ae.actor FROM audit_event ae
        WHERE ae.entity_type = '${b.auditType}' AND ae.entity_id = ${b.table}.${b.idCol}
        ORDER BY ae.at DESC LIMIT 1) AS removed_by
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
