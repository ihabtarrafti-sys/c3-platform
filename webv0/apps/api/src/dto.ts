/**
 * dto.ts — explicit domain → wire mappers. The internal tenantId is never put
 * on the wire; canonical business ids are the external identity.
 */
import type { Approval, ApprovalEvent, AuditEvent, Person } from '@c3web/domain';
import type { ApprovalDto, PersonDto } from '@c3web/api-contracts';

export function toPersonDto(p: Person): PersonDto {
  return {
    personId: p.personId,
    fullName: p.fullName,
    ign: p.ign,
    nationality: p.nationality,
    primaryRole: p.primaryRole,
    personnelCode: p.personnelCode,
    currentTeam: p.currentTeam,
    currentGameTitle: p.currentGameTitle,
    primaryDepartment: p.primaryDepartment,
    notes: p.notes,
    isActive: p.isActive,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function toApprovalDto(a: Approval): ApprovalDto {
  return {
    approvalId: a.approvalId,
    operationType: a.operationType,
    targetPersonId: a.targetPersonId,
    targetId: a.targetId,
    reason: a.reason,
    status: a.status,
    payload: a.payload,
    submittedBy: a.submittedBy,
    submittedAt: a.submittedAt,
    reviewedBy: a.reviewedBy,
    reviewedAt: a.reviewedAt,
    rejectionReason: a.rejectionReason,
    executedAt: a.executedAt,
    executionError: a.executionError,
    version: a.version,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function toApprovalEventDto(e: ApprovalEvent) {
  return { approvalId: e.approvalId, fromStatus: e.fromStatus, toStatus: e.toStatus, actor: e.actor, at: e.at, note: e.note };
}

export function toAuditEventDto(e: AuditEvent) {
  return { entityType: e.entityType, entityId: e.entityId, action: e.action, actor: e.actor, at: e.at, before: e.before, after: e.after };
}
