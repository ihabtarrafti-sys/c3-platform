/**
 * mappers.ts — row → domain object translation. The surrogate UUID never
 * escapes persistence; the domain sees only canonical business identities.
 */
import {
  type Agreement,
  type AgreementStatus,
  type AgreementTerm,
  type AgreementTermKind,
  type Apparel,
  type Approval,
  type ApprovalEvent,
  type ApprovalStatus,
  type AuditEvent,
  type AuditAction,
  type C3Document,
  type Credential,
  type Entity,
  type FxRate,
  type Invoice,
  type InvoiceStatus,
  type Journey,
  type JourneyStatus,
  type Kit,
  type Mission,
  type MissionBudget,
  type MissionLine,
  type MissionLineDirection,
  type MissionParticipant,
  type OperationType,
  type Person,
  type Team,
  type TeamMembership,
  parseApprovalPayload,
} from '@c3web/domain';

const iso = (v: Date | string | null): string | null =>
  v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

const isoReq = (v: Date | string): string => iso(v)!;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function mapPerson(row: any): Person {
  return {
    personId: row.personId ?? row.person_id,
    tenantId: row.tenantId ?? row.tenant_id,
    fullName: row.fullName ?? row.full_name,
    ign: row.ign ?? null,
    nationality: row.nationality ?? null,
    primaryRole: row.primaryRole ?? row.primary_role ?? null,
    personnelCode: row.personnelCode ?? row.personnel_code ?? null,
    currentTeam: row.currentTeam ?? row.current_team ?? null,
    currentGameTitle: row.currentGameTitle ?? row.current_game_title ?? null,
    primaryDepartment: row.primaryDepartment ?? row.primary_department ?? null,
    entityId: row.entityId ?? row.entity_id ?? null,
    notes: row.notes ?? null,
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

/**
 * Plain calendar date, defensively normalised. Drizzle mode:'string' delivers
 * ISO strings; if a raw path ever hands us a node-pg-parsed Date (constructed
 * at LOCAL midnight), rebuild from local components — never toISOString(),
 * which shifts to UTC and can change the day (the CP swap bug).
 */
const plainDate = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  if (v instanceof Date) {
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(v.getFullYear(), 4)}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
  }
  return String(v).slice(0, 10);
};

export function mapCredential(row: any): Credential {
  return {
    credentialId: row.credentialId ?? row.credential_id,
    tenantId: row.tenantId ?? row.tenant_id,
    personId: row.personId ?? row.person_id,
    credentialType: row.credentialType ?? row.credential_type,
    issuer: row.issuer ?? null,
    issuedOn: plainDate(row.issuedOn ?? row.issued_on)!,
    expiresOn: plainDate(row.expiresOn ?? row.expires_on),
    notes: row.notes ?? null,
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapJourney(row: any): Journey {
  return {
    journeyId: row.journeyId ?? row.journey_id,
    tenantId: row.tenantId ?? row.tenant_id,
    personId: row.personId ?? row.person_id,
    journeyType: row.journeyType ?? row.journey_type,
    title: row.title ?? null,
    startedOn: plainDate(row.startedOn ?? row.started_on)!,
    endedOn: plainDate(row.endedOn ?? row.ended_on),
    status: (row.status) as JourneyStatus,
    notes: row.notes ?? null,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

function mapEquipmentBase(row: any) {
  return {
    tenantId: row.tenantId ?? row.tenant_id,
    name: row.name,
    category: row.category,
    size: row.size ?? null,
    assignedPersonId: row.assignedPersonId ?? row.assigned_person_id ?? null,
    notes: row.notes ?? null,
    status: (row.status ?? 'Received') as Kit['status'],
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapEntity(row: any): Entity {
  return {
    entityId: row.entityId ?? row.entity_id,
    tenantId: row.tenantId ?? row.tenant_id,
    name: row.name,
    code: row.code ?? null,
    jurisdiction: row.jurisdiction,
    registrationId: row.registrationId ?? row.registration_id ?? null,
    localCurrency: (row.localCurrency ?? row.local_currency ?? 'USD') as Entity['localCurrency'],
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapFxRate(row: any): FxRate {
  return {
    currency: (row.currency) as FxRate['currency'],
    usdPerUnit: Number(row.usdPerUnit ?? row.usd_per_unit),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapKit(row: any): Kit {
  return { kitId: row.kitId ?? row.kit_id, ...mapEquipmentBase(row) };
}

export function mapApparel(row: any): Apparel {
  return { apparelId: row.apparelId ?? row.apparel_id, ...mapEquipmentBase(row) };
}

export function mapAgreement(row: any): Agreement {
  const cents = row.valueUsdCents ?? row.value_usd_cents ?? null;
  return {
    agreementId: row.agreementId ?? row.agreement_id,
    tenantId: row.tenantId ?? row.tenant_id,
    personId: row.personId ?? row.person_id ?? null,
    entityId: row.entityId ?? row.entity_id ?? null,
    agreementCode: row.agreementCode ?? row.agreement_code ?? null,
    agreementType: row.agreementType ?? row.agreement_type,
    linkedAgreementId: row.linkedAgreementId ?? row.linked_agreement_id ?? null,
    startsOn: plainDate(row.startsOn ?? row.starts_on)!,
    endsOn: plainDate(row.endsOn ?? row.ends_on)!,
    // bigint may arrive as a string from raw paths; cents are integers ≪ 2^53.
    valueUsdCents: cents === null ? null : Number(cents),
    notes: row.notes ?? null,
    status: (row.status) as AgreementStatus,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapTeam(row: any): Team {
  return {
    teamId: row.teamId ?? row.team_id,
    tenantId: row.tenantId ?? row.tenant_id,
    name: row.name,
    code: row.code,
    kind: (row.kind ?? 'GameDivision') as Team['kind'],
    gameTitle: row.gameTitle ?? row.game_title ?? null,
    notes: row.notes ?? null,
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

/** Membership rows arrive joined with the person's display name. */
export function mapTeamMembership(row: any): TeamMembership {
  return {
    tenantId: row.tenantId ?? row.tenant_id,
    teamId: row.teamId ?? row.team_id,
    personId: row.personId ?? row.person_id,
    personName: row.personName ?? row.person_name ?? (row.personId ?? row.person_id),
    role: row.role,
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapInvoice(row: any): Invoice {
  return {
    invoiceId: row.invoiceId ?? row.invoice_id,
    tenantId: row.tenantId ?? row.tenant_id,
    invoiceNumber: row.invoiceNumber ?? row.invoice_number,
    entityId: row.entityId ?? row.entity_id,
    missionId: row.missionId ?? row.mission_id,
    lineId: row.lineId ?? row.line_id,
    billedToName: row.billedToName ?? row.billed_to_name,
    billedToDetails: row.billedToDetails ?? row.billed_to_details ?? null,
    incomeCategory: row.incomeCategory ?? row.income_category,
    description: row.description ?? null,
    currency: row.currency as Invoice['currency'],
    subtotalMinor: Number(row.subtotalMinor ?? row.subtotal_minor),
    vatRateBps: row.vatRateBps ?? row.vat_rate_bps,
    vatMinor: Number(row.vatMinor ?? row.vat_minor),
    totalMinor: Number(row.totalMinor ?? row.total_minor),
    status: (row.status ?? 'Issued') as InvoiceStatus,
    issuedOn: row.issuedOn ?? row.issued_on,
    issuedBy: row.issuedBy ?? row.issued_by,
    voidedReason: row.voidedReason ?? row.voided_reason ?? null,
    documentId: row.documentId ?? row.document_id ?? null,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapDocument(row: any): C3Document {
  const size = row.sizeBytes ?? row.size_bytes;
  return {
    documentId: row.documentId ?? row.document_id,
    tenantId: row.tenantId ?? row.tenant_id,
    ownerType: (row.ownerType ?? row.owner_type) as C3Document['ownerType'],
    ownerId: row.ownerId ?? row.owner_id,
    fileName: row.fileName ?? row.file_name,
    contentType: row.contentType ?? row.content_type,
    sizeBytes: Number(size),
    sha256: row.sha256,
    label: row.label ?? null,
    storageKey: row.storageKey ?? row.storage_key,
    uploadedBy: row.uploadedBy ?? row.uploaded_by,
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapAgreementTerm(row: any): AgreementTerm {
  const amount = row.amountMinor ?? row.amount_minor ?? null;
  const bps = row.percentBps ?? row.percent_bps ?? null;
  return {
    termId: row.termId ?? row.term_id,
    tenantId: row.tenantId ?? row.tenant_id,
    agreementId: row.agreementId ?? row.agreement_id,
    kind: (row.kind) as AgreementTermKind,
    // bigint may arrive as a string on raw paths; term amounts are integers ≪ 2^53.
    amountMinor: amount === null ? null : Number(amount),
    currency: (row.currency ?? null) as AgreementTerm['currency'],
    percentBps: bps === null ? null : Number(bps),
    label: row.label ?? null,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapMission(row: any): Mission {
  return {
    missionId: row.missionId ?? row.mission_id,
    tenantId: row.tenantId ?? row.tenant_id,
    name: row.name,
    code: row.code ?? null,
    organizer: row.organizer ?? null,
    city: row.city ?? null,
    teamId: row.teamId ?? row.team_id ?? null,
    gameTitle: row.gameTitle ?? row.game_title ?? null,
    startsOn: plainDate(row.startsOn ?? row.starts_on)!,
    endsOn: plainDate(row.endsOn ?? row.ends_on),
    notes: row.notes ?? null,
    financeStage: (row.financeStage ?? row.finance_stage) as Mission['financeStage'],
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapMissionLine(row: any): MissionLine {
  const amount = row.amountMinor ?? row.amount_minor;
  const received = row.receivedAmountMinor ?? row.received_amount_minor ?? null;
  const snapshot = row.receivedUsdPerUnit ?? row.received_usd_per_unit ?? null;
  return {
    lineId: row.lineId ?? row.line_id,
    tenantId: row.tenantId ?? row.tenant_id,
    missionId: row.missionId ?? row.mission_id,
    direction: (row.direction) as MissionLineDirection,
    category: row.category ?? 'Other',
    label: row.label,
    // bigint may arrive as a string on raw paths; amounts are integers ≪ 2^53.
    amountMinor: Number(amount),
    currency: (row.currency) as MissionLine['currency'],
    paymentStatus: (row.paymentStatus ?? row.payment_status ?? null) as MissionLine['paymentStatus'],
    receivedAmountMinor: received === null ? null : Number(received),
    // numeric arrives as a string (exactness); the domain wants a number.
    receivedUsdPerUnit: snapshot === null ? null : Number(snapshot),
    paymentSourceLabel: row.paymentSourceLabel ?? row.payment_source_label ?? null,
    refNo: row.refNo ?? row.ref_no ?? null,
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapMissionBudget(row: any): MissionBudget {
  const amount = row.amountMinor ?? row.amount_minor;
  return {
    tenantId: row.tenantId ?? row.tenant_id,
    missionId: row.missionId ?? row.mission_id,
    direction: (row.direction) as MissionLineDirection,
    category: row.category,
    currency: (row.currency) as MissionBudget['currency'],
    amountMinor: Number(amount),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

/** Participant rows arrive joined with the person's display name (person_name). */
export function mapMissionParticipant(row: any): MissionParticipant {
  return {
    tenantId: row.tenantId ?? row.tenant_id,
    missionId: row.missionId ?? row.mission_id,
    personId: row.personId ?? row.person_id,
    personName: row.personName ?? row.person_name ?? row.full_name ?? '',
    role: row.role,
    isActive: row.isActive ?? row.is_active,
    perDiemAmountMinor:
      (row.perDiemAmountMinor ?? row.per_diem_amount_minor) == null ? null : Number(row.perDiemAmountMinor ?? row.per_diem_amount_minor),
    perDiemCurrency: (row.perDiemCurrency ?? row.per_diem_currency ?? null) as MissionParticipant['perDiemCurrency'],
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapApproval(row: any): Approval {
  return {
    approvalId: row.approvalId ?? row.approval_id,
    tenantId: row.tenantId ?? row.tenant_id,
    operationType: (row.operationType ?? row.operation_type) as OperationType,
    targetPersonId: row.targetPersonId ?? row.target_person_id,
    targetId: row.targetId ?? row.target_id ?? null,
    reason: row.reason ?? null,
    status: (row.status) as ApprovalStatus,
    payload: parseApprovalPayload(row.payload),
    submittedBy: row.submittedBy ?? row.submitted_by,
    submittedAt: isoReq(row.submittedAt ?? row.submitted_at),
    reviewedBy: row.reviewedBy ?? row.reviewed_by ?? null,
    reviewedAt: iso(row.reviewedAt ?? row.reviewed_at ?? null),
    rejectionReason: row.rejectionReason ?? row.rejection_reason ?? null,
    executedAt: iso(row.executedAt ?? row.executed_at ?? null),
    executionError: row.executionError ?? row.execution_error ?? null,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapApprovalEvent(row: any): ApprovalEvent {
  return {
    approvalId: row.approvalId ?? row.approval_id,
    tenantId: row.tenantId ?? row.tenant_id,
    fromStatus: (row.fromStatus ?? row.from_status ?? null) as ApprovalStatus | null,
    toStatus: (row.toStatus ?? row.to_status) as ApprovalStatus,
    actor: row.actor,
    at: isoReq(row.at),
    note: row.note ?? null,
  };
}

export function mapAuditEvent(row: any): AuditEvent {
  return {
    tenantId: row.tenantId ?? row.tenant_id,
    entityType: row.entityType ?? row.entity_type,
    entityId: row.entityId ?? row.entity_id,
    action: (row.action) as AuditAction,
    actor: row.actor,
    at: isoReq(row.at),
    before: (row.before ?? null) as Record<string, unknown> | null,
    after: (row.after ?? null) as Record<string, unknown> | null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
