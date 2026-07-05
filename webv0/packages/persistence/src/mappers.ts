/**
 * mappers.ts — row → domain object translation. The surrogate UUID never
 * escapes persistence; the domain sees only canonical business identities.
 */
import {
  type Approval,
  type ApprovalEvent,
  type ApprovalStatus,
  type AuditEvent,
  type AuditAction,
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
