/**
 * @c3web/api-contracts — the wire contract (zod). Isomorphic: the API validates
 * every request and response against these schemas AND generates the OpenAPI
 * document from them; the web app imports the inferred types. Depends only on
 * @c3web/domain + zod (browser-safe; no node/db/http).
 *
 * The internal tenantId is deliberately NOT exposed on the wire.
 */
import { z } from 'zod';
import {
  AGREEMENT_STATUSES,
  AGREEMENT_TERM_KINDS,
  APPROVAL_STATUSES,
  C3_ROLES,
  CURRENCY_CODES,
  JOURNEY_STATUSES,
  EQUIPMENT_STATUSES,
  EQUIPMENT_TRANSITIONS,
  JOURNEY_TRANSITIONS,
  MISSION_FINANCE_STAGES,
  MISSION_LINE_DIRECTIONS,
  OPERATION_TYPES,
  PAYMENT_STATUSES,
  currencyCodeSchema,
  setFxRateInputSchema,
  addAgreementInputSchema,
  addCredentialInputSchema,
  addMissionParticipantInputSchema,
  addPersonInputSchema,
  submitAddAgreementTermInputSchema,
  submitUpdateAgreementTermInputSchema,
  submitRemoveAgreementTermInputSchema,
  agreementUpdateInputSchema,
  approvalPayloadSchema,
  changeRolePayloadSchema,
  deactivateCredentialInputSchema,
  deactivateMemberPayloadSchema,
  entityCreateInputSchema,
  entityUpdateInputSchema,
  equipmentCreateInputSchema,
  equipmentUpdateInputSchema,
  initiateJourneyInputSchema,
  journeyTransitionRequestSchema,
  missionCreateInputSchema,
  missionFinanceStageInputSchema,
  missionLineCreateInputSchema,
  missionLinePaymentInputSchema,
  missionLineUpdateInputSchema,
  missionUpdateInputSchema,
  setMissionBudgetInputSchema,
  provisionMemberPayloadSchema,
  reactivateMemberPayloadSchema,
  removeMissionParticipantInputSchema,
  renewAgreementInputSchema,
  setParticipantPerDiemInputSchema,
  terminateAgreementInputSchema,
} from '@c3web/domain';

export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);
export const roleSchema = z.enum(C3_ROLES);
export const operationTypeSchema = z.enum(OPERATION_TYPES);

// ── errors ──────────────────────────────────────────────────────────────────
export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
  correlationId: z.string(),
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

// ── person ──────────────────────────────────────────────────────────────────
export const personSchema = z.object({
  personId: z.string(),
  fullName: z.string(),
  ign: z.string().nullable(),
  nationality: z.string().nullable(),
  primaryRole: z.string().nullable(),
  personnelCode: z.string().nullable(),
  currentTeam: z.string().nullable(),
  currentGameTitle: z.string().nullable(),
  primaryDepartment: z.string().nullable(),
  entityId: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonDto = z.infer<typeof personSchema>;

export const peopleListSchema = z.object({ people: z.array(personSchema) });

// ── approval ────────────────────────────────────────────────────────────────
export const approvalSchema = z.object({
  approvalId: z.string(),
  operationType: operationTypeSchema,
  targetPersonId: z.string(),
  targetId: z.string().nullable(),
  reason: z.string().nullable(),
  status: approvalStatusSchema,
  payload: approvalPayloadSchema,
  submittedBy: z.string(),
  submittedAt: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  executedAt: z.string().nullable(),
  executionError: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApprovalDto = z.infer<typeof approvalSchema>;

export const approvalsListSchema = z.object({ approvals: z.array(approvalSchema) });

export const approvalEventSchema = z.object({
  approvalId: z.string(),
  fromStatus: approvalStatusSchema.nullable(),
  toStatus: approvalStatusSchema,
  actor: z.string(),
  at: z.string(),
  note: z.string().nullable(),
});
export const approvalEventsListSchema = z.object({ events: z.array(approvalEventSchema) });

export const auditEventSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  actor: z.string(),
  at: z.string(),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
});
export const auditEventsListSchema = z.object({ events: z.array(auditEventSchema) });

// ── members (Sprint 35 tenant-admin) ────────────────────────────────────────
export const memberSchema = z.object({
  userId: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  role: roleSchema,
  isActive: z.boolean(),
  createdAt: z.string(),
});
export type MemberDto = z.infer<typeof memberSchema>;
export const membersListSchema = z.object({ members: z.array(memberSchema) });

/** The four governed member operations (AddPerson has its own submit route). */
export const memberChangePayloadSchema = z.discriminatedUnion('operationType', [
  provisionMemberPayloadSchema,
  changeRolePayloadSchema,
  deactivateMemberPayloadSchema,
  reactivateMemberPayloadSchema,
]);
export const submitMemberChangeRequestSchema = z.object({
  payload: memberChangePayloadSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitMemberChangeRequest = z.infer<typeof submitMemberChangeRequestSchema>;

// ── credentials (Sprint 36) ─────────────────────────────────────────────────
export const credentialSchema = z.object({
  credentialId: z.string(),
  personId: z.string(),
  credentialType: z.string(),
  issuer: z.string().nullable(),
  issuedOn: z.string(), // plain ISO date, YYYY-MM-DD
  expiresOn: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type CredentialDto = z.infer<typeof credentialSchema>;
export const credentialsListSchema = z.object({ credentials: z.array(credentialSchema) });

export const submitAddCredentialRequestSchema = z.object({
  input: addCredentialInputSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitAddCredentialRequest = z.infer<typeof submitAddCredentialRequestSchema>;

export const submitDeactivateCredentialRequestSchema = z.object({
  input: deactivateCredentialInputSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitDeactivateCredentialRequest = z.infer<typeof submitDeactivateCredentialRequestSchema>;

// ── journeys (Sprint 37) ────────────────────────────────────────────────────
export const journeySchema = z.object({
  journeyId: z.string(),
  personId: z.string(),
  journeyType: z.string(),
  title: z.string().nullable(),
  startedOn: z.string(), // plain ISO date
  endedOn: z.string().nullable(),
  status: z.enum(JOURNEY_STATUSES),
  notes: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type JourneyDto = z.infer<typeof journeySchema>;
export const journeysListSchema = z.object({ journeys: z.array(journeySchema) });
export const journeyResponseSchema = z.object({ journey: journeySchema });

export const submitInitiateJourneyRequestSchema = z.object({
  input: initiateJourneyInputSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitInitiateJourneyRequest = z.infer<typeof submitInitiateJourneyRequestSchema>;

/** Body of a direct transition (expectedVersion + optional/mandatory reason). */
export { journeyTransitionRequestSchema };
export const journeyTransitionParamSchema = z.object({
  journeyId: z.string().regex(/^JRN-\d{4,}$/),
  action: z.enum(JOURNEY_TRANSITIONS),
});

// ── equipment (Sprint 38) ───────────────────────────────────────────────────
const equipmentBaseSchema = {
  name: z.string(),
  category: z.string(),
  size: z.string().nullable(),
  assignedPersonId: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(EQUIPMENT_STATUSES),
  isActive: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
};
export const kitSchema = z.object({ kitId: z.string(), ...equipmentBaseSchema });
export type KitDto = z.infer<typeof kitSchema>;
export const kitListSchema = z.object({ kit: z.array(kitSchema) });
export const kitResponseSchema = z.object({ kit: kitSchema });
export const apparelSchema = z.object({ apparelId: z.string(), ...equipmentBaseSchema });
export type ApparelDto = z.infer<typeof apparelSchema>;
export const apparelListSchema = z.object({ apparel: z.array(apparelSchema) });
export const apparelResponseSchema = z.object({ apparel: apparelSchema });

/** The domain schemas ARE the wire schemas — one validator, no drift. */
export { equipmentCreateInputSchema, equipmentUpdateInputSchema };
export const kitIdParamSchema = z.object({ kitId: z.string().regex(/^KIT-\d{4,}$/) });
export const apparelIdParamSchema = z.object({ apparelId: z.string().regex(/^APL-\d{4,}$/) });
// D-7: fulfillment status transitions (action in the URL, version in the body).
export const kitTransitionParamSchema = z.object({
  kitId: z.string().regex(/^KIT-\d{4,}$/),
  action: z.enum(EQUIPMENT_TRANSITIONS),
});
export const apparelTransitionParamSchema = z.object({
  apparelId: z.string().regex(/^APL-\d{4,}$/),
  action: z.enum(EQUIPMENT_TRANSITIONS),
});

// ── missions (Sprint 39) ────────────────────────────────────────────────────
export const missionSchema = z.object({
  missionId: z.string(),
  name: z.string(),
  // S2: tournament code (the org's join key), organizer, city, finance stage.
  code: z.string().nullable(),
  organizer: z.string().nullable(),
  city: z.string().nullable(),
  gameTitle: z.string().nullable(),
  startsOn: z.string(), // plain ISO date, YYYY-MM-DD
  endsOn: z.string().nullable(),
  notes: z.string().nullable(),
  financeStage: z.enum(MISSION_FINANCE_STAGES),
  isActive: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MissionDto = z.infer<typeof missionSchema>;
export const missionsListSchema = z.object({ missions: z.array(missionSchema) });
export const missionResponseSchema = z.object({ mission: missionSchema });

export const missionParticipantSchema = z.object({
  missionId: z.string(),
  personId: z.string(),
  personName: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  // Finance S2: per-diem is OMITTED entirely for roles without canViewPerDiem
  // (absence, not masking) — hence optional on the wire.
  perDiemAmountMinor: z.number().int().nullable().optional(),
  perDiemCurrency: currencyCodeSchema.nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MissionParticipantDto = z.infer<typeof missionParticipantSchema>;
export const missionParticipantsListSchema = z.object({ participants: z.array(missionParticipantSchema) });
export const missionParticipantResponseSchema = z.object({ participant: missionParticipantSchema });

// Finance S2: per-diem set/clear (ids in the URL, rate in the body).
export { setParticipantPerDiemInputSchema };
export const missionParticipantParamSchema = z.object({
  missionId: z.string().regex(/^MSN-\d{4,}$/),
  personId: z.string().regex(/^PER-\d{4,}$/),
});
export const participantPerDiemBodySchema = z
  .object({
    perDiemAmountMinor: z.number().int().min(0).nullable(),
    perDiemCurrency: currencyCodeSchema.nullable(),
  })
  .strict();

/** The domain schemas ARE the wire schemas — one validator, no drift. */
export { missionCreateInputSchema, missionUpdateInputSchema };
export const missionIdParamSchema = z.object({ missionId: z.string().regex(/^MSN-\d{4,}$/) });

// ── mission P&L (Finance S4): income/expense lines + the derived P&L ─────────
// The whole surface is served ONLY to canViewFinancials roles (section-level
// denial — the endpoint 403s for legal/hr/visitor).
export const missionLineSchema = z.object({
  lineId: z.string(),
  missionId: z.string(),
  direction: z.enum(MISSION_LINE_DIRECTIONS),
  category: z.string(),
  label: z.string(),
  amountMinor: z.number().int(),
  currency: currencyCodeSchema,
  // S2: income payment tracking (null on expense lines).
  paymentStatus: z.enum(PAYMENT_STATUSES).nullable(),
  receivedAmountMinor: z.number().int().nullable(),
  receivedUsdPerUnit: z.number().nullable(),
  paymentSourceLabel: z.string().nullable(),
  refNo: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MissionLineDto = z.infer<typeof missionLineSchema>;
export const missionLineResponseSchema = z.object({ line: missionLineSchema });
export { missionLineCreateInputSchema, missionLineUpdateInputSchema, missionLinePaymentInputSchema, setMissionBudgetInputSchema, missionFinanceStageInputSchema };
export const missionLineParamSchema = z.object({
  missionId: z.string().regex(/^MSN-\d{4,}$/),
  lineId: z.string().regex(/^PNL-\d{4,}$/),
});
/** Soft removal carries the expected version (version-guarded). */
export const missionLineRemoveBodySchema = z.object({ expectedVersion: z.number().int().min(0) }).strict();

export const missionBudgetSchema = z.object({
  missionId: z.string(),
  direction: z.enum(MISSION_LINE_DIRECTIONS),
  category: z.string(),
  currency: currencyCodeSchema,
  amountMinor: z.number().int(),
  updatedAt: z.string(),
});
export type MissionBudgetDto = z.infer<typeof missionBudgetSchema>;
/** Set/clear returns the cell or null (cleared). */
export const missionBudgetResponseSchema = z.object({ budget: missionBudgetSchema.nullable() });

/** The derived P&L — honest by construction: blended is NULL when a rate is missing. */
export const missionPnlSchema = z.object({
  perCurrency: z.array(
    z.object({ currency: currencyCodeSchema, incomeMinor: z.number().int(), expenseMinor: z.number().int() }),
  ),
  perDiem: z.object({
    entries: z.array(
      z.object({
        personId: z.string(),
        personName: z.string(),
        amountMinor: z.number().int(),
        currency: currencyCodeSchema,
        days: z.number().int().nullable(),
        totalMinor: z.number().int().nullable(),
      }),
    ),
    openEnded: z.boolean(),
  }),
  // S2: budget-vs-actual per (direction, category); USD figures null when unblendable.
  perCategory: z.array(
    z.object({
      direction: z.enum(MISSION_LINE_DIRECTIONS),
      category: z.string(),
      actual: z.array(z.object({ currency: currencyCodeSchema, amountMinor: z.number().int() })),
      budget: z.array(z.object({ currency: currencyCodeSchema, amountMinor: z.number().int() })),
      actualUsdMinor: z.number().int().nullable(),
      budgetUsdMinor: z.number().int().nullable(),
      varianceUsdMinor: z.number().int().nullable(),
    }),
  ),
  settlement: z.object({ outstandingIncomeCount: z.number().int(), incomeComplete: z.boolean() }),
  blended: z
    .object({ incomeUsdMinor: z.number().int(), expenseUsdMinor: z.number().int(), profitUsdMinor: z.number().int() })
    .nullable(),
  missingRates: z.array(currencyCodeSchema),
});
export type MissionPnlDto = z.infer<typeof missionPnlSchema>;
export const missionPnlResponseSchema = z.object({
  lines: z.array(missionLineSchema),
  budgets: z.array(missionBudgetSchema),
  pnl: missionPnlSchema,
});

/** S2: the all-missions finance dashboard row. */
export const missionFinanceSummarySchema = z.object({
  missions: z.array(
    z.object({
      missionId: z.string(),
      name: z.string(),
      code: z.string().nullable(),
      organizer: z.string().nullable(),
      financeStage: z.enum(MISSION_FINANCE_STAGES),
      isActive: z.boolean(),
      startsOn: z.string(),
      endsOn: z.string().nullable(),
      outstandingIncomeCount: z.number().int(),
      blended: z
        .object({ incomeUsdMinor: z.number().int(), expenseUsdMinor: z.number().int(), profitUsdMinor: z.number().int() })
        .nullable(),
      missingRates: z.array(currencyCodeSchema),
    }),
  ),
});
export type MissionFinanceSummaryDto = z.infer<typeof missionFinanceSummarySchema>;

export const submitAddMissionParticipantRequestSchema = z.object({
  input: addMissionParticipantInputSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitAddMissionParticipantRequest = z.infer<typeof submitAddMissionParticipantRequestSchema>;

export const submitRemoveMissionParticipantRequestSchema = z.object({
  input: removeMissionParticipantInputSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitRemoveMissionParticipantRequest = z.infer<typeof submitRemoveMissionParticipantRequestSchema>;

// ── agreements (Sprint 41) ──────────────────────────────────────────────────
/**
 * valueUsdCents is OPTIONAL on the wire: the server OMITS the field entirely
 * for roles without canViewFinancials (structural absence — a null would
 * falsely read as "no value recorded").
 */
export const agreementSchema = z.object({
  agreementId: z.string(),
  // Null = entity-level agreement (no owning person; entityId is the anchor).
  personId: z.string().nullable(),
  entityId: z.string().nullable(),
  agreementCode: z.string().nullable(),
  agreementType: z.string(),
  linkedAgreementId: z.string().nullable(),
  startsOn: z.string(), // plain ISO date, YYYY-MM-DD
  endsOn: z.string(),
  valueUsdCents: z.number().int().nullable().optional(),
  notes: z.string().nullable(),
  status: z.enum(AGREEMENT_STATUSES),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgreementDto = z.infer<typeof agreementSchema>;
export const agreementsListSchema = z.object({ agreements: z.array(agreementSchema) });
export const agreementResponseSchema = z.object({ agreement: agreementSchema });
export const agreementIdParamSchema = z.object({ agreementId: z.string().regex(/^AGR-\d{4,}$/) });

// ── agreement financial terms (Finance S3) ───────────────────────────────────
/**
 * A term is either MONETARY (amountMinor + currency, percentBps null) or a
 * PERCENT share (percentBps set, amount/currency null) — the server only ever
 * serves these to canViewFinancials roles (the whole terms endpoint is gated).
 */
export const agreementTermSchema = z.object({
  termId: z.string(),
  agreementId: z.string(),
  kind: z.enum(AGREEMENT_TERM_KINDS),
  amountMinor: z.number().int().nullable(),
  currency: currencyCodeSchema.nullable(),
  percentBps: z.number().int().nullable(),
  label: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AgreementTermDto = z.infer<typeof agreementTermSchema>;
export const agreementTermsListSchema = z.object({ terms: z.array(agreementTermSchema) });

// Governed term changes (Finance S3.5): each is a submit that yields an approval.
export const submitAddAgreementTermRequestSchema = z.object({ input: submitAddAgreementTermInputSchema, reason: z.string().max(500).optional() });
export type SubmitAddAgreementTermRequest = z.infer<typeof submitAddAgreementTermRequestSchema>;
export const submitUpdateAgreementTermRequestSchema = z.object({ input: submitUpdateAgreementTermInputSchema, reason: z.string().max(500).optional() });
export type SubmitUpdateAgreementTermRequest = z.infer<typeof submitUpdateAgreementTermRequestSchema>;
export const submitRemoveAgreementTermRequestSchema = z.object({ input: submitRemoveAgreementTermInputSchema, reason: z.string().max(500).optional() });
export type SubmitRemoveAgreementTermRequest = z.infer<typeof submitRemoveAgreementTermRequestSchema>;

// ── entities (S48): the tenant's legal operating entities ─────────────────────
export const entitySchema = z.object({
  entityId: z.string(),
  name: z.string(),
  code: z.string().nullable(),
  jurisdiction: z.string(),
  registrationId: z.string().nullable(),
  localCurrency: currencyCodeSchema,
  isActive: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type EntityDto = z.infer<typeof entitySchema>;
export const entitiesListSchema = z.object({ entities: z.array(entitySchema) });
export const entityResponseSchema = z.object({ entity: entitySchema });
export const entityIdParamSchema = z.object({ entityId: z.string().regex(/^ENT-\d{4,}$/) });
export { entityCreateInputSchema, entityUpdateInputSchema };

// ── FX rates (Finance S1): the org's editable rate per currency (value in USD) ──
export const fxRateSchema = z.object({
  currency: currencyCodeSchema,
  usdPerUnit: z.number(),
  updatedAt: z.string(),
});
export type FxRateDto = z.infer<typeof fxRateSchema>;
export const fxRatesListSchema = z.object({ rates: z.array(fxRateSchema) });
export const fxRateResponseSchema = z.object({ rate: fxRateSchema });
export { setFxRateInputSchema, currencyCodeSchema, CURRENCY_CODES };

/** The domain schema IS the wire schema for the direct patch — one validator, no drift. */
export { agreementUpdateInputSchema };

export const submitAddAgreementRequestSchema = z.object({
  input: addAgreementInputSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitAddAgreementRequest = z.infer<typeof submitAddAgreementRequestSchema>;

export const submitRenewAgreementRequestSchema = z.object({
  input: renewAgreementInputSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitRenewAgreementRequest = z.infer<typeof submitRenewAgreementRequestSchema>;

export const submitTerminateAgreementRequestSchema = z.object({
  input: terminateAgreementInputSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitTerminateAgreementRequest = z.infer<typeof submitTerminateAgreementRequestSchema>;

// ── the Situation Room (Sprint 43) ──────────────────────────────────────────
export const suggestedActionSchema = z.object({
  kind: z.enum([
    'AddCredential',
    'RenewAgreement',
    'ReviewApproval',
    'ResubmitOrExecute',
    'WithdrawOwnRequest',
    'ViewMission',
    'ViewPerson',
    'ViewAgreement',
    'ViewApproval',
    'ViewJourney',
  ]),
  personId: z.string().optional(),
  missionId: z.string().optional(),
  agreementId: z.string().optional(),
  approvalId: z.string().optional(),
  journeyId: z.string().optional(),
});
export const signalSchema = z.object({
  key: z.string(),
  kind: z.enum(['MissionReadiness', 'CredentialExpiry', 'AgreementWindow', 'ApprovalStale', 'ExecutionFailedRecovery', 'OwnerWedge', 'JourneyStalled']),
  headline: z.string(),
  reasons: z.array(z.string()),
  impact: z.number().int(),
  urgency: z.number().int(),
  score: z.number().int(),
  band: z.enum(['immediate', 'attention', 'watch', 'inMotion']),
  inMotion: z.boolean(),
  actions: z.array(suggestedActionSchema),
});
export type SignalDto = z.infer<typeof signalSchema>;
export const situationCountsSchema = z.object({
  activeMissions: z.number().int(),
  rosteredPlayers: z.number().int(),
  credentialsTracked: z.number().int(),
  liveAgreements: z.number().int(),
  openApprovals: z.number().int(),
});
export type SituationCountsDto = z.infer<typeof situationCountsSchema>;
export const situationResponseSchema = z.object({
  todayIso: z.string(),
  signals: z.array(signalSchema),
  checks: z.array(z.string()),
  /** S46 stat ribbon — counts from the same one-pass read as the signals. */
  counts: situationCountsSchema,
});
export type SituationResponse = z.infer<typeof situationResponseSchema>;

// ── the person hub (Sprint 42) ──────────────────────────────────────────────
export const personMissionMembershipSchema = z.object({
  missionId: z.string(),
  missionName: z.string(),
  missionIsActive: z.boolean(),
  role: z.string(),
  isActive: z.boolean(),
});
export type PersonMissionMembershipDto = z.infer<typeof personMissionMembershipSchema>;
export const personMissionsListSchema = z.object({ missions: z.array(personMissionMembershipSchema) });

// ── requests ────────────────────────────────────────────────────────────────
export const submitAddPersonRequestSchema = z.object({
  input: addPersonInputSchema,
  reason: z.string().max(500).optional(),
});
export type SubmitAddPersonRequest = z.infer<typeof submitAddPersonRequestSchema>;

/** Every mutation carries the record version it expects (optimistic concurrency). */
export const versionedRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
});
export type VersionedRequest = z.infer<typeof versionedRequestSchema>;

export const rejectRequestSchema = versionedRequestSchema.extend({
  reason: z.string().trim().min(1, 'A rejection reason is mandatory').max(1000),
});
export type RejectRequest = z.infer<typeof rejectRequestSchema>;

export const approvalResponseSchema = z.object({ approval: approvalSchema });
export const personResponseSchema = z.object({ person: personSchema });
export const executeResponseSchema = z.object({
  approval: approvalSchema,
  person: personSchema.nullable(),
  credential: credentialSchema.nullable(),
  journey: journeySchema.nullable(),
  participant: missionParticipantSchema.nullable(),
  agreement: agreementSchema.nullable(),
  idempotent: z.boolean(),
});

// ── identity / capabilities ─────────────────────────────────────────────────
export const capabilityViewSchema = z.object({
  canReadPeople: z.boolean(),
  canSubmitApproval: z.boolean(),
  canReviewApproval: z.boolean(),
  canExecuteApproval: z.boolean(),
  canReadMembers: z.boolean(),
  canSubmitMemberChange: z.boolean(),
  canOperateJourneys: z.boolean(),
  canManageKit: z.boolean(),
  canManageApparel: z.boolean(),
  canManageMissions: z.boolean(),
  canManageEntities: z.boolean(),
  canReadAgreements: z.boolean(),
  canViewFinancials: z.boolean(),
  canViewPerDiem: z.boolean(),
});
export const meResponseSchema = z.object({
  identity: z.string(),
  displayName: z.string(),
  role: roleSchema,
  tenantSlug: z.string(),
  capabilities: capabilityViewSchema,
});
export type MeResponse = z.infer<typeof meResponseSchema>;

// ── path params ─────────────────────────────────────────────────────────────
export const personIdParamSchema = z.object({ personId: z.string().regex(/^PER-\d{4,}$/) });
export const approvalIdParamSchema = z.object({ approvalId: z.string().regex(/^APR-\d{4,}$/) });
export const credentialIdParamSchema = z.object({ credentialId: z.string().regex(/^CRED-\d{4,}$/) });
export const journeyIdParamSchema = z.object({ journeyId: z.string().regex(/^JRN-\d{4,}$/) });
