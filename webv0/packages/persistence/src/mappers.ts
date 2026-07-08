/**
 * mappers.ts — row → domain object translation. The surrogate UUID never
 * escapes persistence; the domain sees only canonical business identities.
 */
import {
  type Apparel,
  type Approval,
  type ApprovalEvent,
  type ApprovalStatus,
  type AuditEvent,
  type AuditAction,
  type Credential,
  type Journey,
  type JourneyStatus,
  type Kit,
  type OperationType,
  type Person,
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
    isActive: row.isActive ?? row.is_active,
    version: row.version,
    createdAt: isoReq(row.createdAt ?? row.created_at),
    updatedAt: isoReq(row.updatedAt ?? row.updated_at),
  };
}

export function mapKit(row: any): Kit {
  return { kitId: row.kitId ?? row.kit_id, ...mapEquipmentBase(row) };
}

export function mapApparel(row: any): Apparel {
  return { apparelId: row.apparelId ?? row.apparel_id, ...mapEquipmentBase(row) };
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
