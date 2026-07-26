import { canonicalSha256 } from '../canonical.js';
import {
  findReservedQueryToken,
  type H1BulkRecordDescriptor,
  type H1CorpusPlan,
  type H1Register,
} from './corpusPlanner.js';
import type { H1TenantSlot } from './seedPlan.js';

export interface H1BulkSeedRow {
  readonly rowId: string;
  readonly phase: number;
  readonly table: string;
  readonly tenantSlot: H1TenantSlot;
  readonly values: Readonly<Record<string, unknown>>;
}

export interface H1BulkSeedMaterialization {
  readonly measurementStatus: 'NOT_YET_MEASURED';
  readonly rowCount: 99_403;
  readonly rows: readonly H1BulkSeedRow[];
  readonly rowsCanonicalSha256: string;
  readonly tableCounts: Readonly<Record<string, number>>;
}

export class H1BulkRowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'H1BulkRowError';
  }
}

const PHASE_BY_REGISTER = Object.freeze({
  person: 100,
  mission: 100,
  entity: 100,
  team: 100,
  approval: 110,
  agreement: 120,
  credential: 120,
  journey: 120,
  kit: 120,
  apparel: 120,
  claim: 120,
  beneficiary: 120,
  term: 130,
  line: 130,
  invoice: 140,
  distribution: 140,
  document: 150,
} satisfies Readonly<Record<H1Register, number>>);

function fail(message: string): never {
  throw new H1BulkRowError(message);
}

function descriptorIndex(
  records: readonly H1BulkRecordDescriptor[],
): ReadonlyMap<string, readonly H1BulkRecordDescriptor[]> {
  const index = new Map<string, H1BulkRecordDescriptor[]>();
  for (const record of records) {
    const key = `${record.tenantSlot}:${record.register}`;
    const existing = index.get(key) ?? [];
    existing.push(record);
    index.set(key, existing);
  }
  return index;
}

function dependency(
  index: ReadonlyMap<string, readonly H1BulkRecordDescriptor[]>,
  tenantSlot: H1TenantSlot,
  register: H1Register,
  ordinal: number,
): H1BulkRecordDescriptor {
  const candidates = index.get(`${tenantSlot}:${register}`);
  if (candidates === undefined || candidates.length === 0) {
    fail(`bulk dependency ${tenantSlot}/${register} is unavailable`);
  }
  const selected = candidates[(ordinal - 1) % candidates.length];
  if (selected === undefined) {
    fail(`bulk dependency ${tenantSlot}/${register}/${ordinal} is unavailable`);
  }
  return selected;
}

function collisionFreeDocumentSha256(
  row: H1BulkRecordDescriptor,
  reservedQueryTokens: readonly string[],
): string {
  const initial = canonicalSha256({
    artifactKind: 'hearth-search-h1-synthetic-document',
    rowId: row.bulkRowId,
  });
  if (findReservedQueryToken(initial, reservedQueryTokens) === null) {
    return initial;
  }

  for (let rejectionNonce = 1; rejectionNonce <= 10_000; rejectionNonce += 1) {
    const candidate = canonicalSha256({
      artifactKind: 'hearth-search-h1-synthetic-document',
      rejectionNonce,
      rowId: row.bulkRowId,
    });
    if (findReservedQueryToken(candidate, reservedQueryTokens) === null) {
      return candidate;
    }
  }

  fail(`bulk row ${row.bulkRowId} exhausted document hash rejection sampling`);
}

function valuesFor(
  row: H1BulkRecordDescriptor,
  index: ReadonlyMap<string, readonly H1BulkRecordDescriptor[]>,
  reservedQueryTokens: readonly string[],
): Readonly<Record<string, unknown>> {
  const tenantId =
    row.tenantSlot === 'T01'
      ? '00000000-0000-4000-8000-000000000001'
      : '00000000-0000-4000-8000-000000000002';
  const { recordId } = row.source;
  const { primaryText, secondaryText, code } = row.deterministicFields;
  const personId = dependency(
    index,
    row.tenantSlot,
    'person',
    row.generatedOrdinal,
  ).source.recordId;
  const missionId = dependency(
    index,
    row.tenantSlot,
    'mission',
    row.generatedOrdinal,
  ).source.recordId;
  const entityId = dependency(
    index,
    row.tenantSlot,
    'entity',
    row.generatedOrdinal,
  ).source.recordId;
  const approvalId = dependency(
    index,
    row.tenantSlot,
    'approval',
    row.generatedOrdinal,
  ).source.recordId;
  const agreementId = dependency(
    index,
    row.tenantSlot,
    'agreement',
    row.generatedOrdinal,
  ).source.recordId;
  const lineId = dependency(
    index,
    row.tenantSlot,
    'line',
    row.generatedOrdinal,
  ).source.recordId;
  const actorEmail = `hearthbulk.${row.tenantSlot.toLowerCase()}@synthetic.invalid`;
  const frozenTimestamp = row.deterministicFields.frozenTimestamp;

  let values: Readonly<Record<string, unknown>>;
  switch (row.register) {
    case 'person':
      values = {
        tenant_id: tenantId,
        person_id: recordId,
        full_name: primaryText,
        ign: code,
        personnel_code: secondaryText,
        current_team: 'Hearthbulk',
        is_active: true,
      };
      break;
    case 'mission':
      values = {
        tenant_id: tenantId,
        mission_id: recordId,
        name: primaryText,
        code,
        organizer: secondaryText,
        city: 'Hearthbulk',
        starts_on: '2035-06-01',
        ends_on: '2035-06-30',
        finance_stage: 'Planning',
        is_active: true,
      };
      break;
    case 'agreement':
      values = {
        tenant_id: tenantId,
        agreement_id: recordId,
        agreement_code: code,
        agreement_type: primaryText,
        person_id: personId,
        entity_id: null,
        starts_on: '2035-01-01',
        ends_on: '2035-12-31',
        status: 'Active',
        created_by_approval_id: null,
      };
      break;
    case 'entity':
      values = {
        tenant_id: tenantId,
        entity_id: recordId,
        name: primaryText,
        code,
        jurisdiction: secondaryText,
        local_currency: 'USD',
        is_active: true,
      };
      break;
    case 'credential':
      values = {
        tenant_id: tenantId,
        credential_id: recordId,
        credential_type: primaryText,
        person_id: personId,
        issuer: secondaryText,
        kind: 'Other',
        issued_on: '2035-01-01',
        expires_on: null,
        is_active: true,
        created_by_approval_id: null,
      };
      break;
    case 'journey':
      values = {
        tenant_id: tenantId,
        journey_id: recordId,
        title: primaryText,
        journey_type: secondaryText,
        person_id: personId,
        started_on: '2035-01-01',
        ended_on: null,
        status: 'Active',
        created_by_approval_id: approvalId,
      };
      break;
    case 'kit':
      values = {
        tenant_id: tenantId,
        kit_id: recordId,
        name: primaryText,
        category: secondaryText,
        assigned_person_id: personId,
        status: 'Received',
        is_active: true,
      };
      break;
    case 'apparel':
      values = {
        tenant_id: tenantId,
        apparel_id: recordId,
        name: primaryText,
        category: secondaryText,
        assigned_person_id: personId,
        status: 'Received',
        is_active: true,
      };
      break;
    case 'approval':
      values = {
        tenant_id: tenantId,
        approval_id: recordId,
        operation_type: 'ProvisionMember',
        target_person_id: personId,
        target_id: entityId,
        status: 'Submitted',
        payload: {
          synthetic: true,
          h1BulkRowId: row.bulkRowId,
        },
        submitted_by: actorEmail,
        submitted_at: frozenTimestamp,
      };
      break;
    case 'team':
      values = {
        tenant_id: tenantId,
        team_id: recordId,
        name: primaryText,
        code,
        kind: 'GameDivision',
        game_title: secondaryText,
        is_active: true,
      };
      break;
    case 'invoice':
      values = {
        tenant_id: tenantId,
        invoice_id: recordId,
        invoice_number: code,
        entity_id: entityId,
        mission_id: missionId,
        line_id: lineId,
        billed_to_name: primaryText,
        income_category: 'Other',
        currency: 'USD',
        subtotal_minor: 100,
        vat_rate_bps: 0,
        vat_minor: 0,
        total_minor: 100,
        status: 'Voided',
        issued_on: '2035-06-15',
        issued_by: actorEmail,
        voided_reason: secondaryText,
      };
      break;
    case 'claim':
      values = {
        tenant_id: tenantId,
        claim_id: recordId,
        submitted_by: actorEmail,
        person_id: null,
        mission_id: null,
        category: secondaryText,
        description: primaryText,
        amount_minor: 100,
        currency: 'USD',
        expense_on: '2035-06-15',
        status: 'Submitted',
      };
      break;
    case 'distribution':
      values = {
        tenant_id: tenantId,
        distribution_id: recordId,
        mission_id: missionId,
        line_id: lineId,
        pool_minor: 100,
        currency: 'USD',
        org_share_bps: 10_000,
        org_cut_minor: 100,
        status: 'Live',
        revoked_reason: null,
        created_by: actorEmail,
      };
      break;
    case 'document':
      values = {
        tenant_id: tenantId,
        document_id: recordId,
        owner_type: 'Mission',
        owner_id: missionId,
        file_name: `${code}.pdf`,
        content_type: 'application/pdf',
        size_bytes: 1,
        sha256: collisionFreeDocumentSha256(
          row,
          reservedQueryTokens,
        ),
        label: primaryText,
        storage_key: `hearthbulk/${row.tenantSlot.toLowerCase()}/${recordId}.pdf`,
        uploaded_by: actorEmail,
        record_kind: 'RegisteredEvidence',
        is_active: true,
      };
      break;
    case 'term':
      values = {
        tenant_id: tenantId,
        term_id: recordId,
        agreement_id: agreementId,
        kind: 'PerformanceBonus',
        amount_minor: 100,
        currency: 'USD',
        percent_bps: null,
        label: primaryText,
        is_active: true,
      };
      break;
    case 'line':
      values = {
        tenant_id: tenantId,
        line_id: recordId,
        mission_id: missionId,
        direction: 'Income',
        category: 'Other',
        label: primaryText,
        amount_minor: 100,
        currency: 'USD',
        payment_status: 'Received',
        received_amount_minor: 100,
        received_usd_per_unit: 1,
        payment_source_label: 'Hearthbulk',
        ref_no: code,
        is_active: true,
      };
      break;
    case 'beneficiary':
      values = {
        tenant_id: tenantId,
        beneficiary_id: recordId,
        person_id: personId,
        freelancer_id: null,
        vendor_id: null,
        label: primaryText,
        bank_name: secondaryText,
        bank_country: 'AE',
        currency: 'USD',
        status: 'Registered',
      };
      break;
  }
  return {
    ...values,
    created_at: frozenTimestamp,
    updated_at: frozenTimestamp,
  };
}

function everyString(
  value: unknown,
  visit: (candidate: string) => void,
): void {
  if (typeof value === 'string') {
    visit(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) everyString(item, visit);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      everyString(item, visit);
    }
  }
}

function compileReservedTokenMatcher(
  reservedQueryTokens: readonly string[],
): RegExp {
  const alternatives = reservedQueryTokens.map((token) =>
    token
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'),
  );
  if (alternatives.length === 0 || alternatives.some((token) => token === '')) {
    fail('bulk materialization requires non-empty reserved query tokens');
  }
  return new RegExp(`(?:${alternatives.join('|')})`, 'u');
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function materializeH1BulkRows(
  plan: H1CorpusPlan,
): H1BulkSeedMaterialization {
  if (
    plan.measurementStatus !== 'NOT_YET_MEASURED' ||
    plan.bulkRecords.length !== 99_403
  ) {
    fail('bulk materialization requires the complete H1 corpus plan');
  }
  const index = descriptorIndex(plan.bulkRecords);
  const rows: H1BulkSeedRow[] = [];
  const tableCounts: Record<string, number> = {};
  const reservedTokenMatcher = compileReservedTokenMatcher(
    plan.reservedQueryTokens,
  );
  for (const descriptor of plan.bulkRecords) {
    const values = valuesFor(
      descriptor,
      index,
      plan.reservedQueryTokens,
    );
    everyString(values, (value) => {
      if (
        reservedTokenMatcher.test(
          value.normalize('NFKC').toLowerCase(),
        )
      ) {
        fail(
          `bulk row ${descriptor.bulkRowId} contains a reserved query token`,
        );
      }
    });
    const row = Object.freeze({
      rowId: descriptor.bulkRowId,
      phase: PHASE_BY_REGISTER[descriptor.register],
      table: descriptor.physicalTable,
      tenantSlot: descriptor.tenantSlot,
      values: Object.freeze({ ...values }),
    });
    rows.push(row);
    tableCounts[row.table] = (tableCounts[row.table] ?? 0) + 1;
  }
  rows.sort(
    (left, right) =>
      left.phase - right.phase ||
      compareText(left.table, right.table) ||
      compareText(left.rowId, right.rowId),
  );
  return Object.freeze({
    measurementStatus: 'NOT_YET_MEASURED',
    rowCount: 99_403,
    rows: Object.freeze(rows),
    rowsCanonicalSha256: canonicalSha256(rows),
    tableCounts: Object.freeze({ ...tableCounts }),
  });
}
