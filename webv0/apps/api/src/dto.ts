/**
 * dto.ts — explicit domain → wire mappers. The internal tenantId is never put
 * on the wire; canonical business ids are the external identity.
 */
import type { AgreementTerm, Apparel, Approval, ApprovalEvent, AuditEvent, Credential, Entity, FxRate, Journey, Kit, Member, Mission, MissionParticipant, Person } from '@c3web/domain';
import type { AgreementView } from '@c3web/application';
import type { AgreementDto, AgreementTermDto, ApparelDto, ApprovalDto, CredentialDto, EntityDto, FxRateDto, JourneyDto, KitDto, MemberDto, MissionDto, MissionParticipantDto, PersonDto } from '@c3web/api-contracts';

const equipmentDtoBase = (e: Kit | Apparel) => ({
  name: e.name,
  category: e.category,
  size: e.size,
  assignedPersonId: e.assignedPersonId,
  notes: e.notes,
  status: e.status,
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

/**
 * Agreement (per-actor view) → wire. The financial field is forwarded ONLY
 * when the application read model included it — structural omission survives
 * the wire (plain ISO dates and integer cents pass through untouched).
 */
export function toAgreementDto(a: AgreementView): AgreementDto {
  return {
    agreementId: a.agreementId,
    personId: a.personId,
    entityId: a.entityId,
    agreementCode: a.agreementCode,
    agreementType: a.agreementType,
    linkedAgreementId: a.linkedAgreementId,
    startsOn: a.startsOn,
    endsOn: a.endsOn,
    ...('valueUsdCents' in a ? { valueUsdCents: a.valueUsdCents ?? null } : {}),
    notes: a.notes,
    status: a.status,
    version: a.version,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/** Agreement financial term → wire (Finance S3; only reached by canViewFinancials). */
export function toAgreementTermDto(t: AgreementTerm): AgreementTermDto {
  return {
    termId: t.termId,
    agreementId: t.agreementId,
    kind: t.kind,
    amountMinor: t.amountMinor,
    currency: t.currency,
    percentBps: t.percentBps,
    label: t.label,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** Mission → wire (plain ISO dates pass through untouched). */
export function toMissionDto(m: Mission): MissionDto {
  return {
    missionId: m.missionId,
    name: m.name,
    gameTitle: m.gameTitle,
    startsOn: m.startsOn,
    endsOn: m.endsOn,
    notes: m.notes,
    isActive: m.isActive,
    version: m.version,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

export function toMissionParticipantDto(mp: MissionParticipant, showPerDiem = false): MissionParticipantDto {
  return {
    missionId: mp.missionId,
    personId: mp.personId,
    personName: mp.personName,
    role: mp.role,
    isActive: mp.isActive,
    // Finance S2: per-diem is OMITTED entirely for roles without canViewPerDiem.
    ...(showPerDiem ? { perDiemAmountMinor: mp.perDiemAmountMinor, perDiemCurrency: mp.perDiemCurrency } : {}),
    createdAt: mp.createdAt,
    updatedAt: mp.updatedAt,
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
    entityId: p.entityId,
    notes: p.notes,
    isActive: p.isActive,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function toEntityDto(e: Entity): EntityDto {
  return {
    entityId: e.entityId,
    name: e.name,
    jurisdiction: e.jurisdiction,
    registrationId: e.registrationId,
    localCurrency: e.localCurrency,
    isActive: e.isActive,
    version: e.version,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export function toFxRateDto(r: FxRate): FxRateDto {
  return { currency: r.currency, usdPerUnit: r.usdPerUnit, updatedAt: r.updatedAt };
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
