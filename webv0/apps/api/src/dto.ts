/**
 * dto.ts — explicit domain → wire mappers. The internal tenantId is never put
 * on the wire; canonical business ids are the external identity.
 */
import type { Apparel, Approval, ApprovalEvent, AuditEvent, Credential, Journey, Kit, Member, Person } from '@c3web/domain';
import type { ApparelDto, ApprovalDto, CredentialDto, JourneyDto, KitDto, MemberDto, PersonDto } from '@c3web/api-contracts';

const equipmentDtoBase = (e: Kit | Apparel) => ({
  name: e.name,
  category: e.category,
  size: e.size,
  assignedPersonId: e.assignedPersonId,
  notes: e.notes,
  isActive: e.isActive,
  version: e.version,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
});

export const toKitDto = (k: Kit): KitDto => ({ kitId: k.kitId, ...equipmentDtoBase(k) });
export const toApparelDto = (a: Apparel): ApparelDto => ({ apparelId: a.apparelId, ...equipmentDtoBase(a) });

/** Journey → wire (plain ISO dates pass through untouched). */
export function toJourneyDto(j: Journey): JourneyDto {
  return {
    journeyId: j.journeyId,
    personId: j.personId,
    journeyType: j.journeyType,
    title: j.title,
    startedOn: j.startedOn,
    endedOn: j.endedOn,
    status: j.status,
    notes: j.notes,
    version: j.version,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  };
}

/** Credential → wire (plain ISO dates pass through untouched). */
export function toCredentialDto(c: Credential): CredentialDto {
  return {
    credentialId: c.credentialId,
    personId: c.personId,
    credentialType: c.credentialType,
    issuer: c.issuer,
    issuedOn: c.issuedOn,
    expiresOn: c.expiresOn,
    notes: c.notes,
    isActive: c.isActive,
    version: c.version,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/** Member → wire (the internal tenantId never leaves the server). */
export function toMemberDto(m: Member): MemberDto {
  return {
    userId: m.userId,
    email: m.email,
    displayName: m.displayName,
    role: m.role,
    isActive: m.isActive,
    createdAt: m.createdAt,
  };
}

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
