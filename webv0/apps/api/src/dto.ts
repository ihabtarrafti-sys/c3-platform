/**
 * dto.ts — explicit domain → wire mappers. The internal tenantId is never put
 * on the wire; canonical business ids are the external identity.
 */
import { delegationState } from '@c3web/domain';
import type { PayloadDisclosure } from '@c3web/authz';
import type { AgreementTerm, Apparel, C3Document, Approval, ApprovalEvent, AuditEvent, Credential, Entity, FxRate, Invoice, Journey, Team, TeamMembership, Distribution, DistributionShare, Claim, Delegation, Beneficiary, IntakeLink, IntakeSubmission, Kit, Member, Mission, MissionBudget, MissionLine, MissionParticipant, MissionPnl, Person } from '@c3web/domain';
import type { AgreementView } from '@c3web/application';
import type { AgreementDto, AgreementTermDto, ApparelDto, DocumentDto, ApprovalDto, CredentialDto, EntityDto, FxRateDto, InvoiceDto, IntakeLinkDto, IntakeSubmissionDto, JourneyDto, TeamDto, TeamMembershipDto, DistributionDto, DistributionShareDto, ClaimDto, DelegationDto, BeneficiaryDto, ApprovalSummaryDto, KitDto, MemberDto, MissionBudgetDto, MissionDto, MissionLineDto, MissionParticipantDto, MissionPnlDto, PersonDto } from '@c3web/api-contracts';

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

/**
 * Credential → wire (plain ISO dates pass through untouched). S12: the
 * document number is PII — structurally omitted without standing, same law
 * and same shape as toPersonDto.
 */
export function toCredentialDto(c: Credential, includePii: boolean): CredentialDto {
  return {
    credentialId: c.credentialId,
    personId: c.personId,
    credentialType: c.credentialType,
    kind: c.kind,
    issuingCountry: c.issuingCountry,
    ...(includePii ? { documentNumber: c.documentNumber } : {}),
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

/** S12: beneficiary → wire (names/labels only — no account data exists to map). */
export function toBeneficiaryDto(b: Beneficiary): BeneficiaryDto {
  return {
    beneficiaryId: b.beneficiaryId,
    personId: b.personId,
    freelancerId: b.freelancerId,
    vendorId: b.vendorId,
    label: b.label,
    bankName: b.bankName,
    bankCountry: b.bankCountry,
    currency: b.currency,
    paymentType: b.paymentType,
    registeredWithEntityId: b.registeredWithEntityId,
    status: b.status,
    statusDate: b.statusDate,
    notes: b.notes,
    version: b.version,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
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
    code: m.code,
    organizer: m.organizer,
    city: m.city,
    teamId: m.teamId,
    gameTitle: m.gameTitle,
    startsOn: m.startsOn,
    endsOn: m.endsOn,
    notes: m.notes,
    financeStage: m.financeStage,
    isActive: m.isActive,
    version: m.version,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
}

/** Mission income/expense line → wire (Finance S4 + S2; only reached by canViewFinancials). */
export function toMissionLineDto(l: MissionLine): MissionLineDto {
  return {
    lineId: l.lineId,
    missionId: l.missionId,
    direction: l.direction,
    category: l.category,
    label: l.label,
    amountMinor: l.amountMinor,
    currency: l.currency,
    paymentStatus: l.paymentStatus,
    receivedAmountMinor: l.receivedAmountMinor,
    receivedUsdPerUnit: l.receivedUsdPerUnit,
    paymentSourceLabel: l.paymentSourceLabel,
    refNo: l.refNo,
    isActive: l.isActive,
    version: l.version,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  };
}

/** Team → wire (S7). */
export function toTeamDto(t: Team): TeamDto {
  return {
    teamId: t.teamId,
    name: t.name,
    code: t.code,
    kind: t.kind,
    gameTitle: t.gameTitle,
    notes: t.notes,
    isActive: t.isActive,
    version: t.version,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/** Team membership → wire (S7; person name joined at read). */
export function toTeamMembershipDto(m: TeamMembership): TeamMembershipDto {
  return {
    teamId: m.teamId,
    personId: m.personId,
    personName: m.personName,
    role: m.role,
    isActive: m.isActive,
    version: m.version,
  };
}

/** Claim → wire (S9; per-actor scoping happens in the use-case). */
export function toDelegationDto(d: Delegation): DelegationDto {
  return {
    delegationId: d.delegationId,
    granteeIdentity: d.granteeIdentity,
    grantedBy: d.grantedBy,
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    reason: d.reason,
    revokedAt: d.revokedAt,
    revokedBy: d.revokedBy,
    revokeReason: d.revokeReason,
    state: delegationState(d, new Date().toISOString().slice(0, 10)),
    version: d.version,
    createdAt: d.createdAt,
  };
}

export function toClaimDto(c: Claim): ClaimDto {
  return {
    claimId: c.claimId,
    submittedBy: c.submittedBy,
    personId: c.personId,
    missionId: c.missionId,
    category: c.category,
    description: c.description,
    amountMinor: c.amountMinor,
    currency: c.currency,
    expenseOn: c.expenseOn,
    status: c.status,
    reviewedBy: c.reviewedBy,
    rejectionReason: c.rejectionReason,
    paidOn: c.paidOn,
    paymentSourceLabel: c.paymentSourceLabel,
    refNo: c.refNo,
    version: c.version,
    createdAt: c.createdAt,
  };
}

/** Distribution + payout rows → wire (S8; finance-gated reads only). */
export function toDistributionDto(d: Distribution): DistributionDto {
  return {
    distributionId: d.distributionId,
    missionId: d.missionId,
    lineId: d.lineId,
    poolMinor: d.poolMinor,
    currency: d.currency,
    orgShareBps: d.orgShareBps,
    orgCutMinor: d.orgCutMinor,
    status: d.status,
    revokedReason: d.revokedReason,
    notes: d.notes,
    createdBy: d.createdBy,
    version: d.version,
    createdAt: d.createdAt,
  };
}

export function toDistributionShareDto(s: DistributionShare): DistributionShareDto {
  return {
    distributionId: s.distributionId,
    personId: s.personId,
    personName: s.personName,
    shareBps: s.shareBps,
    amountMinor: s.amountMinor,
    payoutStatus: s.payoutStatus,
    paidOn: s.paidOn,
    paymentSourceLabel: s.paymentSourceLabel,
    refNo: s.refNo,
    version: s.version,
  };
}

/** Invoice → wire (S6). 1:1 — the record IS the outward claim. */
export function toInvoiceDto(i: Invoice): InvoiceDto {
  return {
    invoiceId: i.invoiceId,
    invoiceNumber: i.invoiceNumber,
    entityId: i.entityId,
    missionId: i.missionId,
    lineId: i.lineId,
    billedToName: i.billedToName,
    billedToDetails: i.billedToDetails,
    incomeCategory: i.incomeCategory,
    description: i.description,
    currency: i.currency,
    subtotalMinor: i.subtotalMinor,
    vatRateBps: i.vatRateBps,
    vatMinor: i.vatMinor,
    totalMinor: i.totalMinor,
    status: i.status,
    issuedOn: i.issuedOn,
    issuedBy: i.issuedBy,
    voidedReason: i.voidedReason,
    documentId: i.documentId,
    version: i.version,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
  };
}

/** Document metadata → wire (S4; the storage key NEVER leaves the server). */
// Track B6: guest intake. The internal storageKey is NEVER put on the wire.
export function toIntakeLinkDto(l: IntakeLink): IntakeLinkDto {
  return {
    id: l.id,
    kind: l.kind,
    label: l.label,
    createdBy: l.createdBy,
    createdAt: l.createdAt,
    expiresAt: l.expiresAt,
    maxUses: l.maxUses,
    usedCount: l.usedCount,
    status: l.status,
    consumedAt: l.consumedAt,
  };
}

export function toIntakeSubmissionDto(s: IntakeSubmission): IntakeSubmissionDto {
  return {
    id: s.id,
    linkId: s.linkId,
    kind: s.kind,
    payload: s.payload,
    uploads: s.uploads.map((u) => ({
      uploadId: u.uploadId,
      fileName: u.fileName,
      contentType: u.contentType,
      sizeBytes: u.sizeBytes,
      sha256: u.sha256,
    })),
    status: s.status,
    submittedAt: s.submittedAt,
    reviewedBy: s.reviewedBy,
    reviewedAt: s.reviewedAt,
    promotedApprovalId: s.promotedApprovalId,
    promotedPersonId: s.promotedPersonId,
    decisionNote: s.decisionNote,
  };
}

export function toDocumentDto(d: C3Document): DocumentDto {
  return {
    documentId: d.documentId,
    ownerType: d.ownerType,
    ownerId: d.ownerId,
    fileName: d.fileName,
    contentType: d.contentType,
    sizeBytes: d.sizeBytes,
    sha256: d.sha256,
    label: d.label,
    uploadedBy: d.uploadedBy,
    version: d.version,
    createdAt: d.createdAt,
  };
}

/** Mission budget cell → wire (S2). */
export function toMissionBudgetDto(b: MissionBudget): MissionBudgetDto {
  return {
    missionId: b.missionId,
    direction: b.direction,
    category: b.category,
    currency: b.currency,
    amountMinor: b.amountMinor,
    version: b.version,
    updatedAt: b.updatedAt,
  };
}

/** Derived P&L → wire (readonly domain arrays → the mutable wire shape). */
export function toMissionPnlDto(pnl: MissionPnl): MissionPnlDto {
  return {
    perCurrency: pnl.perCurrency.map((t) => ({ ...t })),
    perDiem: { entries: pnl.perDiem.entries.map((e) => ({ ...e })), openEnded: pnl.perDiem.openEnded },
    perCategory: pnl.perCategory.map((c) => ({
      direction: c.direction,
      category: c.category,
      actual: c.actual.map((a) => ({ ...a })),
      budget: c.budget.map((b) => ({ ...b })),
      actualUsdMinor: c.actualUsdMinor,
      budgetUsdMinor: c.budgetUsdMinor,
      varianceUsdMinor: c.varianceUsdMinor,
    })),
    settlement: { ...pnl.settlement },
    blended: pnl.blended ? { ...pnl.blended } : null,
    missingRates: [...pnl.missingRates],
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
    version: mp.version,
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

/**
 * S11: the PII tier is enforced HERE — structural omission (the keys are not
 * present at all without standing), never masking. Callers pass the actor's
 * canViewPersonPII; there is no PII-bearing overload without the flag.
 */
export function toPersonDto(p: Person, includePii: boolean): PersonDto {
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
    firstName: p.firstName,
    lastName: p.lastName,
    otherNationalities: [...p.otherNationalities],
    position: p.position,
    dateOfJoining: p.dateOfJoining,
    ...(includePii
      ? {
          dateOfBirth: p.dateOfBirth,
          addressLine1: p.addressLine1,
          addressLine2: p.addressLine2,
          addressCity: p.addressCity,
          addressCountry: p.addressCountry,
          phone: p.phone,
          email: p.email,
        }
      : {}),
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
    code: e.code,
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

/**
 * HARDEN-0 (audit H-01): the approval payload is projected BY ROLE at this one
 * boundary. Delegation grants standing to decide, never wider disclosure —
 * fields beyond the actor's PII/financial standing are OMITTED (absence, not
 * masking; the H-07 panel names withheld fields honestly). The immutable
 * payload in the database is untouched; this shapes the WIRE view only.
 */
export function projectApprovalPayload(payload: Approval['payload'], d: PayloadDisclosure): Record<string, unknown> {
  switch (payload.operationType) {
    case 'UpdatePersonIdentity': {
      if (d.pii) return payload as unknown as Record<string, unknown>;
      const { dateOfBirth: _dob, ...patch } = payload.input.patch;
      return { operationType: payload.operationType, input: { personId: payload.input.personId, patch } };
    }
    case 'UpdateCredentialFacts': {
      if (d.pii) return payload as unknown as Record<string, unknown>;
      const { documentNumber: _num, ...patch } = payload.input.patch;
      return { operationType: payload.operationType, input: { credentialId: payload.input.credentialId, patch } };
    }
    case 'AddCredential': {
      if (d.pii) return payload as unknown as Record<string, unknown>;
      const { documentNumber: _num, ...input } = payload.input as Record<string, unknown>;
      return { operationType: payload.operationType, input };
    }
    case 'AddAgreement': {
      if (d.financial) return payload as unknown as Record<string, unknown>;
      const { valueUsdCents: _v, ...input } = payload.input as Record<string, unknown>;
      return { operationType: payload.operationType, input };
    }
    case 'AddAgreementTerm':
    case 'UpdateAgreementTerm': {
      if (d.financial) return payload as unknown as Record<string, unknown>;
      const { amountMinor: _a, currency: _c, percentBps: _p, ...input } = payload.input as Record<string, unknown>;
      return { operationType: payload.operationType, input };
    }
    case 'ImportBatch': {
      if (d.financial) return payload as unknown as Record<string, unknown>;
      const { agreements: _rows, ...input } = payload.input as Record<string, unknown>;
      return { operationType: payload.operationType, input };
    }
    default:
      return payload as unknown as Record<string, unknown>;
  }
}

export function toApprovalDto(a: Approval, d: PayloadDisclosure): ApprovalDto {
  return {
    approvalId: a.approvalId,
    operationType: a.operationType,
    targetPersonId: a.targetPersonId,
    targetId: a.targetId,
    reason: a.reason,
    status: a.status,
    payload: projectApprovalPayload(a.payload, d) as ApprovalDto['payload'],
    submittedBy: a.submittedBy,
    submittedAt: a.submittedAt,
    reviewedBy: a.reviewedBy,
    reviewedAt: a.reviewedAt,
    rejectionReason: a.rejectionReason,
    executedAt: a.executedAt,
    executionError: a.executionError,
    version: a.version,
    editCount: a.editCount,
    revisionOf: a.revisionOf,
    supersededBy: a.supersededBy,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/** H-01: the REGISTER view — no payload at all. Detail is where disclosure happens. */
export function toApprovalSummaryDto(a: Approval): ApprovalSummaryDto {
  return {
    approvalId: a.approvalId,
    operationType: a.operationType,
    targetPersonId: a.targetPersonId,
    targetId: a.targetId,
    reason: a.reason,
    status: a.status,
    submittedBy: a.submittedBy,
    submittedAt: a.submittedAt,
    reviewedBy: a.reviewedBy,
    reviewedAt: a.reviewedAt,
    rejectionReason: a.rejectionReason,
    executedAt: a.executedAt,
    executionError: a.executionError,
    version: a.version,
    editCount: a.editCount,
    revisionOf: a.revisionOf,
    supersededBy: a.supersededBy,
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
