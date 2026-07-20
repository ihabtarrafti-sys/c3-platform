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
  DOCUMENT_OWNER_TYPES,
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
  addBeneficiaryInputSchema,
  updateBeneficiaryInputSchema,
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
  COMMENT_SUBJECT_TYPES,
  postCommentInputSchema,
  CALENDAR_KINDS,
  SUBSCRIPTION_CADENCES,
  SAVED_VIEW_REGISTERS,
  SAVED_VIEW_NAME_MAX,
  SUBSCRIPTION_STATUSES,
  subscriptionCreateInputSchema,
  subscriptionUpdateInputSchema,
  DEPARTURE_STATUSES,
  DEPARTURE_ITEM_KINDS,
  initiateDepartureInputSchema,
  completeDepartureInputSchema,
  INTAKE_KINDS,
  INTAKE_LINK_STATUSES,
  INTAKE_SUBMISSION_STATUSES,
  createIntakeLinkInputSchema,
  onboardingIntakePayloadSchema,
  RECYCLE_KINDS,
  restoreRecycleInputSchema,
  setParticipantPerDiemInputSchema,
  setPerDiemPresetsInputSchema,
  teamCreateInputSchema,
  teamMemberInputSchema,
  teamUpdateInputSchema,
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
  // S11 identity-material (visible to all; GOVERNED to change):
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  otherNationalities: z.array(z.string()),
  // S11 operational:
  position: z.string().nullable(),
  dateOfJoining: z.string().nullable(),
  // S11 PII tier — STRUCTURALLY OMITTED without canViewPersonPII:
  dateOfBirth: z.string().nullable().optional(),
  // HARDEN-3: a face is PII — presence of a headshot (and its cache-buster) is
  // PII-tier too, so a non-PII reader never learns a photo exists.
  photoUpdatedAt: z.string().nullable().optional(),
  addressLine1: z.string().nullable().optional(),
  addressLine2: z.string().nullable().optional(),
  addressCity: z.string().nullable().optional(),
  addressCountry: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  isActive: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PersonDto = z.infer<typeof personSchema>;

export const peopleListSchema = z.object({ people: z.array(personSchema) });

// ── approval ────────────────────────────────────────────────────────────────
// HARDEN-0 (H-01): the wire payload is a ROLE-PROJECTED view of the immutable
// domain payload — fields beyond the caller's PII/financial standing are
// omitted. The response schema is therefore structural (record), while the
// full domain union type stays exported for the web's rendering narrowing
// (cast once at the page boundary; absent keys are the projection working).
export const approvalSummarySchema = z.object({
  approvalId: z.string(),
  operationType: operationTypeSchema,
  targetPersonId: z.string(),
  targetId: z.string().nullable(),
  reason: z.string().nullable(),
  status: approvalStatusSchema,
  submittedBy: z.string(),
  submittedAt: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  executedAt: z.string().nullable(),
  executionError: z.string().nullable(),
  version: z.number().int(),
  // Track B1: the corrections record + revision links.
  editCount: z.number().int(),
  revisionOf: z.string().nullable(),
  supersededBy: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ApprovalSummaryDto = z.infer<typeof approvalSummarySchema>;

export const approvalSchema = approvalSummarySchema.extend({
  payload: z.record(z.unknown()),
});
export type ApprovalDto = z.infer<typeof approvalSchema>;
/** The FULL domain payload union — for web-side narrowing after the one cast. */
export type ApprovalPayloadDto = z.infer<typeof approvalPayloadSchema>;

// H-01: the register is payload-free — disclosure happens on the detail view.
export const approvalsListSchema = z.object({ approvals: z.array(approvalSummarySchema) });

// Track B1: request corrections — edit-before-review + revise-and-resubmit.
export const editApprovalBodySchema = z
  .object({ expectedVersion: z.number().int().min(0), input: z.record(z.unknown()) })
  .strict();
export const reviseApprovalBodySchema = z
  .object({ expectedVersion: z.number().int().min(0), input: z.record(z.unknown()), reason: z.string().trim().max(1000).nullish() })
  .strict();
export const reviseApprovalResponseSchema = z.object({ approval: approvalSchema, superseded: z.string() });

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
  // S12: typed taxonomy + issuing country (visible to all).
  kind: z.enum(['Passport', 'NationalID', 'Visa', 'License', 'Other']),
  issuingCountry: z.string().nullable(),
  // S12 PII tier — STRUCTURALLY OMITTED without canViewPersonPII:
  documentNumber: z.string().nullable().optional(),
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

// ── S12: credential facts (governed) + details (direct) + beneficiaries ─────
export const submitCredentialFactsRequestSchema = z
  .object({
    patch: z
      .object({
        kind: z.enum(['Passport', 'NationalID', 'Visa', 'License', 'Other']).optional(),
        documentNumber: z.string().max(120).nullable().optional(),
        issuingCountry: z.string().max(120).nullable().optional(),
        issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      })
      .strict(),
    reason: z.string().max(500).optional(),
  })
  .strict();

export const updateCredentialDetailsRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    patch: z
      .object({
        credentialType: z.string().min(1).max(120).optional(),
        issuer: z.string().max(160).nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
      })
      .strict(),
  })
  .strict();

export const beneficiarySchema = z.object({
  beneficiaryId: z.string(),
  // 0035 payee anchor: exactly one seat set; freelancer/vendor dormant.
  personId: z.string().nullable(),
  freelancerId: z.string().nullable(),
  vendorId: z.string().nullable(),
  label: z.string(),
  bankName: z.string(),
  bankCountry: z.string(),
  currency: z.string(),
  paymentType: z.string().nullable(),
  registeredWithEntityId: z.string().nullable(),
  status: z.enum(['Draft', 'Registered', 'Retired']),
  statusDate: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BeneficiaryDto = z.infer<typeof beneficiarySchema>;
export const beneficiariesListSchema = z.object({ beneficiaries: z.array(beneficiarySchema) });

export const submitAddBeneficiaryRequestSchema = z
  .object({ input: addBeneficiaryInputSchema, reason: z.string().max(500).optional() })
  .strict();
export const submitUpdateBeneficiaryRequestSchema = z
  .object({
    patch: updateBeneficiaryInputSchema.shape.patch,
    reason: z.string().max(500).optional(),
  })
  .strict();
export const submitRetireBeneficiaryRequestSchema = z
  .object({ reason: z.string().min(1).max(500) })
  .strict();

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
  teamId: z.string().nullable(),
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
  /** HARDEN-2 M-03: concurrency token — per-diem writes must echo it back. */
  version: z.number().int(),
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
    /** HARDEN-2 M-03: the participant version the caller read — stale = 409. */
    expectedVersion: z.number().int().min(0),
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
  /** HARDEN-2 M-03: concurrency token — budget writes must echo it back. */
  version: z.number().int(),
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

// ── /api/v2 P&L (R4 L-02) ────────────────────────────────────────────────────
// Every potentially-unbounded aggregate is a TAGGED amount: exact, or unavailable
// WITH ITS REASON (overflow / missing_rate / open_ended) — never one overloaded
// null, never a silently-rounded number. v1 stays frozen; the web reads THIS.
export const pnlUnavailableReasonSchema = z.enum(['overflow', 'missing_rate', 'open_ended']);
export const pnlAmountSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), amountMinor: z.number().int() }),
  z.object({ status: z.literal('unavailable'), reason: pnlUnavailableReasonSchema }),
]);
export type PnlAmountDto = z.infer<typeof pnlAmountSchema>;
export const missionPnlV2Schema = z.object({
  perCurrency: z.array(z.object({ currency: currencyCodeSchema, income: pnlAmountSchema, expense: pnlAmountSchema })),
  perDiem: z.object({
    openEnded: z.boolean(),
    entries: z.array(
      z.object({
        personId: z.string(),
        personName: z.string(),
        amountMinor: z.number().int(),
        currency: currencyCodeSchema,
        days: z.number().int().nullable(),
        total: pnlAmountSchema,
      }),
    ),
  }),
  perCategory: z.array(
    z.object({
      direction: z.enum(MISSION_LINE_DIRECTIONS),
      category: z.string(),
      actual: z.array(z.object({ currency: currencyCodeSchema, amount: pnlAmountSchema })),
      budget: z.array(z.object({ currency: currencyCodeSchema, amount: pnlAmountSchema })),
      actualUsd: pnlAmountSchema,
      budgetUsd: pnlAmountSchema,
      varianceUsd: pnlAmountSchema,
    }),
  ),
  settlement: z.object({ outstandingIncomeCount: z.number().int(), incomeComplete: z.boolean() }),
  blended: z.object({ income: pnlAmountSchema, expense: pnlAmountSchema, profit: pnlAmountSchema }),
  missingRates: z.array(currencyCodeSchema),
});
export type MissionPnlV2Dto = z.infer<typeof missionPnlV2Schema>;
export const missionPnlV2ResponseSchema = z.object({
  lines: z.array(missionLineSchema),
  budgets: z.array(missionBudgetSchema),
  pnl: missionPnlV2Schema,
});

// ── import/export (S5): staging returns the batch approval; errors ride the
//    structured envelope (422 IMPORT_INVALID with details.rows). Exports and
//    templates are text/csv streams, not JSON.
export const IMPORT_DOMAINS = ['people', 'credentials', 'agreements'] as const;
export const importDomainParamSchema = z.object({ domain: z.enum(IMPORT_DOMAINS) });
export const exportDomainParamSchema = z.object({ domain: z.enum([...IMPORT_DOMAINS, 'audit']) });

// ── documents (S4): metadata on the wire; bytes stream separately ────────────
export const documentSchema = z.object({
  documentId: z.string(),
  ownerType: z.enum(DOCUMENT_OWNER_TYPES),
  ownerId: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  sha256: z.string(),
  label: z.string().nullable(),
  uploadedBy: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
});
export type DocumentDto = z.infer<typeof documentSchema>;
export const documentsListSchema = z.object({ documents: z.array(documentSchema) });
export const documentResponseSchema = z.object({ document: documentSchema });
export const documentIdParamSchema = z.object({ documentId: z.string().regex(/^DOC-\d{4,}$/) });
export const documentsQuerySchema = z.object({
  ownerType: z.enum(DOCUMENT_OWNER_TYPES),
  // Regenerated from the owner-type→prefix map. Fixes the live bug: INV/CLM were
  // missing while the ownerType enum accepts them, so the Claim documents section
  // (ClaimDetailPage) 400'd. MSG/OBL (Comms) pass schema then the route refuses
  // the server-owned types (documents.ts §D) — still fail-closed.
  ownerId: z.string().regex(/^(AGR|MSN|PER|CRED|ENT|INV|CLM|MSG|OBL)-\d{4,}$/),
});
export const documentRemoveBodySchema = z.object({ expectedVersion: z.number().int().min(0) }).strict();

// ── global search (S3 → S3.1): role-aware, identity fields only ──────────────
export const SEARCH_RESULT_KINDS = [
  'person',
  'mission',
  'agreement',
  'entity',
  'credential',
  'journey',
  'kit',
  'apparel',
  'approval',
  'team',
  'invoice',
  'claim',
  'distribution',
  'document',
  'term',
  'line',
  'beneficiary',
] as const;
export const searchQuerySchema = z.object({ q: z.string().max(80) });
export const searchResultsSchema = z.object({
  results: z.array(
    z.object({
      kind: z.enum(SEARCH_RESULT_KINDS),
      id: z.string(),
      title: z.string(),
      subtitle: z.string().nullable(),
      /** S3.1: the owning record's id for child hits (term→AGR, line→MSN, document→"Type:ID"). */
      parentId: z.string().nullable(),
    }),
  ),
});
export type SearchResultsDto = z.infer<typeof searchResultsSchema>;

// ── teams (S7): divisions/departments, roster, per-team P&L + ROI% ───────────
export const TEAM_KINDS = ['GameDivision', 'Department'] as const;
export const teamSchema = z.object({
  teamId: z.string(),
  name: z.string(),
  code: z.string(),
  kind: z.enum(TEAM_KINDS),
  gameTitle: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TeamDto = z.infer<typeof teamSchema>;
export const teamsListSchema = z.object({ teams: z.array(teamSchema) });
export const teamResponseSchema = z.object({ team: teamSchema });
export const teamMembershipSchema = z.object({
  teamId: z.string(),
  personId: z.string(),
  personName: z.string(),
  role: z.string(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type TeamMembershipDto = z.infer<typeof teamMembershipSchema>;
export const teamMembersListSchema = z.object({ members: z.array(teamMembershipSchema) });
export const teamFinanceSchema = z.object({
  finance: z.object({
    missions: z.array(
      z.object({
        missionId: z.string(),
        name: z.string(),
        code: z.string().nullable(),
        financeStage: z.string(),
        isActive: z.boolean(),
        blended: z.object({ incomeUsdMinor: z.number().int(), expenseUsdMinor: z.number().int(), profitUsdMinor: z.number().int() }).nullable(),
        missingRates: z.array(z.string()),
      }),
    ),
    totals: z.object({ incomeUsdMinor: z.number().int(), expenseUsdMinor: z.number().int(), profitUsdMinor: z.number().int() }).nullable(),
    unblendableMissions: z.array(z.string()),
    roiBps: z.number().int().nullable(),
  }),
});
export { teamCreateInputSchema, teamUpdateInputSchema, teamMemberInputSchema };
export type TeamFinanceResponse = z.infer<typeof teamFinanceSchema>;
export const teamIdParamSchema = z.object({ teamId: z.string().regex(/^TEAM-\d{4,}$/) });
export const teamMemberRemoveParamSchema = z.object({
  teamId: z.string().regex(/^TEAM-\d{4,}$/),
  personId: z.string().regex(/^PER-\d{4,}$/),
});
export const flipVersionBodySchema = z.object({ expectedVersion: z.number().int().min(0) }).strict();

// ── people v2 (S11): governed identity/lifecycle + direct operational ────────
const personIdentityPatchSchema = z
  .object({
    fullName: z.string().min(1).max(200).optional(),
    firstName: z.string().max(120).nullable().optional(),
    lastName: z.string().max(120).nullable().optional(),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    nationality: z.string().max(120).nullable().optional(),
    otherNationalities: z.array(z.string().min(1).max(120)).max(8).optional(),
  })
  .strict();
export const submitPersonIdentityRequestSchema = z
  .object({ patch: personIdentityPatchSchema, reason: z.string().max(500).optional() })
  .strict();
export const personLifecycleRequestSchema = z.object({ reason: z.string().min(1).max(500) }).strict();
export const updatePersonOperationalRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    patch: z
      .object({
        ign: z.string().max(120).nullable().optional(),
        primaryRole: z.string().max(120).nullable().optional(),
        personnelCode: z.string().max(60).nullable().optional(),
        currentTeam: z.string().max(120).nullable().optional(),
        currentGameTitle: z.string().max(120).nullable().optional(),
        primaryDepartment: z.string().max(120).nullable().optional(),
        entityId: z.string().nullable().optional(),
        notes: z.string().max(2000).nullable().optional(),
        position: z.string().max(120).nullable().optional(),
        dateOfJoining: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        addressLine1: z.string().max(200).nullable().optional(),
        addressLine2: z.string().max(200).nullable().optional(),
        addressCity: z.string().max(120).nullable().optional(),
        addressCountry: z.string().max(120).nullable().optional(),
        phone: z.string().max(60).nullable().optional(),
        email: z.string().email().max(200).nullable().optional(),
      })
      .strict(),
  })
  .strict();

// ── delegations (Tier 0.5): owner-granted approver standing ──────────────────
export const delegationSchema = z.object({
  delegationId: z.string(),
  granteeIdentity: z.string(),
  grantedBy: z.string(),
  startsOn: z.string(),
  endsOn: z.string(),
  reason: z.string(),
  revokedAt: z.string().nullable(),
  revokedBy: z.string().nullable(),
  revokeReason: z.string().nullable(),
  state: z.enum(['Scheduled', 'Active', 'Expired', 'Revoked']),
  version: z.number().int(),
  createdAt: z.string(),
});
export type DelegationDto = z.infer<typeof delegationSchema>;
export const delegationsListSchema = z.object({ delegations: z.array(delegationSchema) });
export const delegationResponseSchema = z.object({ delegation: delegationSchema });
export const createDelegationRequestSchema = z
  .object({
    granteeIdentity: z.string().min(3),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reason: z.string().min(1).max(500),
  })
  .strict();
export const revokeDelegationRequestSchema = z
  .object({ expectedVersion: z.number().int().min(0), reason: z.string().min(1).max(500) })
  .strict();

// ── backup status (Tier 0.5): the Settings tile ──────────────────────────────
export const backupStatusSchema = z.object({
  configured: z.boolean(),
  healthy: z.boolean().nullable(),
  lastSuccessUtc: z.string().nullable(),
  ageHours: z.number().int().nullable(),
  reason: z.string().nullable(),
});

// ── per-diem presets (HARDEN-2: the S2 rider) — Settings-editable quick-picks ─
export const perDiemPresetDtoSchema = z.object({ amountMinor: z.number().int().positive(), currency: currencyCodeSchema });
export const perDiemPresetsResponseSchema = z.object({
  presets: z.array(perDiemPresetDtoSchema),
  /** Null while the tenant is on the code-side defaults (no row yet). */
  version: z.number().int().nullable(),
});
export { setPerDiemPresetsInputSchema };
export type PerDiemPresetsDto = z.infer<typeof perDiemPresetsResponseSchema>;

// ── recycle bin (Track B2): cross-domain soft-removed register + restore ─────
export const recycleItemSchema = z.object({
  kind: z.enum(RECYCLE_KINDS),
  id: z.string(),
  label: z.string(),
  sublabel: z.string().nullable(),
  parentId: z.string().nullable(),
  removedAt: z.string(),
  removedBy: z.string().nullable(),
  version: z.number().int(),
  restoreClass: z.enum(['governed', 'direct', 'recordPage']),
});
export type RecycleItemDto = z.infer<typeof recycleItemSchema>;
export const recycleListSchema = z.object({ items: z.array(recycleItemSchema) });
export { restoreRecycleInputSchema };
export const restoreRecycleResponseSchema = z.object({
  outcome: z.enum(['restored', 'approval-submitted']),
  kind: z.enum(RECYCLE_KINDS),
  id: z.string(),
  approvalId: z.string().nullable(),
});

// ── activity feed (Track B3): the org journal over the audit stream ──────────
export const activityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(120).optional(),
});
export const activityItemSchema = z.object({
  id: z.string(),
  at: z.string(),
  actor: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  headline: z.string(),
});
export type ActivityItemDto = z.infer<typeof activityItemSchema>;
export const activityFeedSchema = z.object({
  items: z.array(activityItemSchema),
  nextCursor: z.string().nullable(),
});

// ── comments (Track B4): contextual discussion + @mentions on records ────────
export { postCommentInputSchema };
export const commentsQuerySchema = z.object({ subjectType: z.enum(COMMENT_SUBJECT_TYPES), subjectId: z.string().min(1).max(40) });
export const commentSchema = z.object({
  id: z.string(),
  subjectType: z.enum(COMMENT_SUBJECT_TYPES),
  subjectId: z.string(),
  author: z.string(),
  body: z.string(),
  mentions: z.array(z.string()),
  createdAt: z.string(),
});
export type CommentDto = z.infer<typeof commentSchema>;
export const commentsListSchema = z.object({ comments: z.array(commentSchema) });
export const commentResponseSchema = z.object({ comment: commentSchema });

// ── ops calendar / timeline (Track B): the forward horizon ───────────────────
export const calendarItemSchema = z.object({
  kind: z.enum(CALENDAR_KINDS),
  id: z.string(),
  date: z.string(),
  daysUntil: z.number(),
  title: z.string(),
  subtitle: z.string().nullable(),
  route: z.string(),
});
export type CalendarItemDto = z.infer<typeof calendarItemSchema>;
export const calendarResponseSchema = z.object({ items: z.array(calendarItemSchema), horizonDays: z.number(), todayIso: z.string() });
export const calendarQuerySchema = z.object({ horizon: z.coerce.number().int().min(7).max(365).optional().default(90) });

// ── recurring subscriptions (Track B): the org's recurring costs ─────────────
export { subscriptionCreateInputSchema, subscriptionUpdateInputSchema };
export const subscriptionSchema = z.object({
  subscriptionId: z.string(),
  name: z.string(),
  vendorName: z.string(),
  amountMinor: z.number(),
  currency: z.string(),
  cadence: z.enum(SUBSCRIPTION_CADENCES),
  category: z.string().nullable(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  startedOn: z.string(),
  nextRenewalOn: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SubscriptionDto = z.infer<typeof subscriptionSchema>;
export const subscriptionsListSchema = z.object({ subscriptions: z.array(subscriptionSchema) });
export const subscriptionResponseSchema = z.object({ subscription: subscriptionSchema });
export const subscriptionIdParamSchema = z.object({ subscriptionId: z.string().regex(/^SUB-\d{4,}$/) });

// ── saved views (Track B): personal filter/sort/search presets ───────────────
export const savedViewSchema = z.object({
  id: z.string(),
  register: z.enum(SAVED_VIEW_REGISTERS),
  name: z.string(),
  // Opaque web-owned blob — the API never interprets it.
  state: z.unknown(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SavedViewDto = z.infer<typeof savedViewSchema>;
export const savedViewsListSchema = z.object({ views: z.array(savedViewSchema) });
export const savedViewResponseSchema = z.object({ view: savedViewSchema });
export const savedViewsQuerySchema = z.object({ register: z.enum(SAVED_VIEW_REGISTERS) });
export const savedViewIdParamSchema = z.object({ id: z.string().uuid() });
export const savedViewCreateBodySchema = z.object({
  register: z.enum(SAVED_VIEW_REGISTERS),
  name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX),
  state: z.record(z.string(), z.unknown()),
});
export const savedViewUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(SAVED_VIEW_NAME_MAX).optional(),
    state: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((v) => v.name !== undefined || v.state !== undefined, 'Nothing to update.');

// ── departure workflow (Track B): offboarding ────────────────────────────────
export { initiateDepartureInputSchema, completeDepartureInputSchema };
export const departureSchema = z.object({
  departureId: z.string(),
  personId: z.string(),
  reason: z.string(),
  status: z.enum(DEPARTURE_STATUSES),
  initiatedBy: z.string(),
  initiatedOn: z.string(),
  completedOn: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type DepartureDto = z.infer<typeof departureSchema>;
export const departureOpenItemSchema = z.object({ kind: z.enum(DEPARTURE_ITEM_KINDS), id: z.string(), label: z.string(), route: z.string() });
export const departureWithReadinessSchema = z.object({ departure: departureSchema, personName: z.string(), openItems: z.array(departureOpenItemSchema) });
export type DepartureWithReadinessDto = z.infer<typeof departureWithReadinessSchema>;
export const departuresListSchema = z.object({ departures: z.array(departureWithReadinessSchema) });
export const departureResponseSchema = z.object({ departure: departureSchema });
export const completeDepartureResponseSchema = z.object({ departure: departureSchema, deactivationApprovalId: z.string().nullable() });
export const departureIdParamSchema = z.object({ departureId: z.string().regex(/^DEP-\d{4,}$/) });
export const cancelDepartureInputSchema = z.object({ expectedVersion: z.number().int().min(0), note: z.string().trim().max(2000).nullish() }).strict();

// ── guest intake (Track B6): tokenized sandbox submissions ───────────────────
export { createIntakeLinkInputSchema, onboardingIntakePayloadSchema };
/** Upload metadata EXPOSED to staff — the internal storageKey is never sent. */
export const intakeUploadDtoSchema = z.object({
  uploadId: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number(),
  sha256: z.string(),
});
export const intakeLinkSchema = z.object({
  id: z.string(),
  kind: z.enum(INTAKE_KINDS),
  label: z.string().nullable(),
  createdBy: z.string(),
  createdAt: z.string(),
  expiresAt: z.string(),
  maxUses: z.number(),
  usedCount: z.number(),
  status: z.enum(INTAKE_LINK_STATUSES),
  consumedAt: z.string().nullable(),
});
export type IntakeLinkDto = z.infer<typeof intakeLinkSchema>;
export const intakeSubmissionSchema = z.object({
  id: z.string(),
  linkId: z.string().nullable(),
  kind: z.enum(INTAKE_KINDS),
  payload: z.record(z.unknown()).nullable(),
  uploads: z.array(intakeUploadDtoSchema),
  status: z.enum(INTAKE_SUBMISSION_STATUSES),
  submittedAt: z.string(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  promotedApprovalId: z.string().nullable(),
  promotedPersonId: z.string().nullable(),
  decisionNote: z.string().nullable(),
});
export type IntakeSubmissionDto = z.infer<typeof intakeSubmissionSchema>;

export const intakeLinksListSchema = z.object({ links: z.array(intakeLinkSchema) });
/** Mint response — the raw token is returned ONCE (never stored/returned again). */
export const createIntakeLinkResponseSchema = z.object({ link: intakeLinkSchema, token: z.string() });
export const intakeLinkResponseSchema = z.object({ link: intakeLinkSchema });
export const intakeSubmissionsListSchema = z.object({ submissions: z.array(intakeSubmissionSchema) });
export const intakeSubmissionResponseSchema = z.object({ submission: intakeSubmissionSchema });
export const promoteSubmissionResponseSchema = z.object({ approval: approvalSchema, submission: intakeSubmissionSchema });
/** Staff decision body (promote/reject) — an optional note. */
export const intakeDecisionInputSchema = z.object({ decisionNote: z.string().trim().max(2000).nullish() }).strict();
/** Attach a promoted submission's quarantined files to the created person. */
export const intakeAttachInputSchema = z.object({ uploadIds: z.array(z.string()).min(1).max(20) }).strict();
export const intakeAttachResponseSchema = z.object({ attachedCount: z.number(), personId: z.string() });

/** Public: non-consuming peek for the form load (no tenant, minimal). */
export const intakePeekResponseSchema = z.object({
  kind: z.enum(INTAKE_KINDS),
  open: z.boolean(),
  status: z.string(),
  expiresAt: z.string(),
});
/** Public: submit acknowledgement — an opaque reference, no tenant/PII echoed. */
export const intakeSubmitResponseSchema = z.object({ ok: z.literal(true), reference: z.string() });
export const intakeTokenParamSchema = z.object({ token: z.string().min(20).max(200) });
export const intakeLinkIdParamSchema = z.object({ linkId: z.string().uuid() });
export const intakeSubmissionIdParamSchema = z.object({ submissionId: z.string().uuid() });
export const intakeUploadParamSchema = z.object({ submissionId: z.string().uuid(), uploadId: z.string() });

// ── notifications (S10): the L2 inbox ────────────────────────────────────────
export const notificationSchema = z.object({
  signalKey: z.string(),
  kind: z.string(),
  title: z.string(),
  link: z.string(),
  emittedAt: z.string(),
  readAt: z.string().nullable(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;
export const notificationsInboxSchema = z.object({ notifications: z.array(notificationSchema), unreadCount: z.number().int() });
export const markNotificationReadRequestSchema = z.object({ signalKey: z.string().min(1) }).strict();
export const okResponseSchema = z.object({ ok: z.literal(true) });

// ── claims (S9): the Finance Intelligence Hub as a record ────────────────────
export const CLAIM_STATUSES = ['Submitted', 'InReview', 'Approved', 'Rejected', 'Paid'] as const;
export const claimSchema = z.object({
  claimId: z.string(),
  submittedBy: z.string(),
  personId: z.string().nullable(),
  missionId: z.string().nullable(),
  category: z.string(),
  description: z.string(),
  amountMinor: z.number().int(),
  currency: z.enum(CURRENCY_CODES),
  expenseOn: z.string(),
  status: z.enum(CLAIM_STATUSES),
  reviewedBy: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  paidOn: z.string().nullable(),
  paymentSourceLabel: z.string().nullable(),
  refNo: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
});
export type ClaimDto = z.infer<typeof claimSchema>;
export const claimsListSchema = z.object({ claims: z.array(claimSchema) });
export const claimResponseSchema = z.object({ claim: claimSchema });
export const submitClaimRequestSchema = z
  .object({
    category: z.string().min(1),
    description: z.string().trim().min(1).max(500),
    amountMinor: z.number().int().positive(),
    currency: z.enum(CURRENCY_CODES),
    expenseOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    personId: z.string().regex(/^PER-\d{4,}$/).nullish(),
    missionId: z.string().regex(/^MSN-\d{4,}$/).nullish(),
  })
  .strict();
export const decideClaimRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    decision: z.enum(['beginReview', 'approve', 'reject']),
    reason: z.string().max(500).nullish(),
  })
  .strict();
export const payClaimRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    paymentSourceLabel: z.string().trim().min(1).max(60),
    refNo: z.string().max(60).nullish(),
  })
  .strict();
export const claimIdParamSchema = z.object({ claimId: z.string().regex(/^CLM-\d{4,}$/) });

// ── distributions (S8): org cut + shares == pool EXACTLY; payout list ────────
export const distributionShareSchema = z.object({
  distributionId: z.string(),
  personId: z.string(),
  personName: z.string(),
  shareBps: z.number().int(),
  amountMinor: z.number().int(),
  payoutStatus: z.enum(['Pending', 'Paid']),
  paidOn: z.string().nullable(),
  paymentSourceLabel: z.string().nullable(),
  refNo: z.string().nullable(),
  version: z.number().int(),
});
export type DistributionShareDto = z.infer<typeof distributionShareSchema>;
export const distributionSchema = z.object({
  distributionId: z.string(),
  missionId: z.string(),
  lineId: z.string(),
  poolMinor: z.number().int(),
  currency: z.enum(CURRENCY_CODES),
  orgShareBps: z.number().int(),
  orgCutMinor: z.number().int(),
  status: z.enum(['Live', 'Revoked']),
  revokedReason: z.string().nullable(),
  notes: z.string().nullable(),
  createdBy: z.string(),
  version: z.number().int(),
  createdAt: z.string(),
});
export type DistributionDto = z.infer<typeof distributionSchema>;
export const distributionViewSchema = z.object({ distribution: distributionSchema, shares: z.array(distributionShareSchema) });
export const distributionsListSchema = z.object({ distributions: z.array(distributionViewSchema) });
export const distributionSeedSchema = z.object({
  rows: z.array(z.object({ personId: z.string(), personName: z.string(), suggestedBps: z.number().int().nullable(), sourceTermId: z.string().nullable() })),
});
export const createDistributionRequestSchema = z
  .object({
    missionId: z.string().regex(/^MSN-\d{4,}$/),
    lineId: z.string().regex(/^PNL-\d{4,}$/),
    orgShareBps: z.number().int().min(0).max(10000),
    shares: z.array(z.object({ personId: z.string().regex(/^PER-\d{4,}$/), shareBps: z.number().int().min(1).max(10000) }).strict()).max(100),
    notes: z.string().max(2000).nullish(),
  })
  .strict();
export const revokeDistributionRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(500), expectedVersion: z.number().int().min(0) })
  .strict();
export const markPayoutRequestSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    paid: z.boolean(),
    paymentSourceLabel: z.string().max(60).nullish(),
    refNo: z.string().max(60).nullish(),
  })
  .strict();
export const distributionIdParamSchema = z.object({ distributionId: z.string().regex(/^DIST-\d{4,}$/) });
export const payoutParamSchema = z.object({
  distributionId: z.string().regex(/^DIST-\d{4,}$/),
  personId: z.string().regex(/^PER-\d{4,}$/),
});

// ── invoices (S6): per-entity series, one income line each, VAT, PDF ─────────
export const INVOICE_STATUSES = ['Issued', 'Voided'] as const;
export const invoiceSchema = z.object({
  invoiceId: z.string(),
  invoiceNumber: z.string(),
  entityId: z.string(),
  missionId: z.string(),
  lineId: z.string(),
  billedToName: z.string(),
  billedToDetails: z.string().nullable(),
  incomeCategory: z.string(),
  description: z.string().nullable(),
  currency: z.enum(CURRENCY_CODES),
  subtotalMinor: z.number().int(),
  vatRateBps: z.number().int(),
  vatMinor: z.number().int(),
  totalMinor: z.number().int(),
  status: z.enum(INVOICE_STATUSES),
  issuedOn: z.string(),
  issuedBy: z.string(),
  voidedReason: z.string().nullable(),
  documentId: z.string().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type InvoiceDto = z.infer<typeof invoiceSchema>;
export const invoiceResponseSchema = z.object({ invoice: invoiceSchema });
export const invoicesListSchema = z.object({ invoices: z.array(invoiceSchema) });
export const issueInvoiceRequestSchema = z
  .object({
    missionId: z.string().regex(/^MSN-\d{4,}$/),
    lineId: z.string().regex(/^PNL-\d{4,}$/),
    entityId: z.string().regex(/^ENT-\d{4,}$/),
    billedToName: z.string().trim().min(1).max(200),
    billedToDetails: z.string().max(600).nullish(),
    vatRateBps: z.number().int().min(0).max(10000),
    description: z.string().max(300).nullish(),
  })
  .strict();
export const voidInvoiceRequestSchema = z
  .object({ reason: z.string().trim().min(1).max(500), expectedVersion: z.number().int().min(0) })
  .strict();
export const invoiceIdParamSchema = z.object({ invoiceId: z.string().regex(/^INV-\d{4,}$/) });

// ── data quality (S5 riders): duplicate detection + the review report ────────
const dqPersonRefSchema = z.object({ personId: z.string(), fullName: z.string() });
export const dataQualityReportSchema = z.object({
  report: z.object({
    duplicatePeople: z.array(
      z.object({
        reason: z.enum(['fullName', 'ign', 'personnelCode']),
        value: z.string(),
        people: z.array(z.object({ personId: z.string(), fullName: z.string(), isActive: z.boolean() })),
      }),
    ),
    peopleMissingNationality: z.array(dqPersonRefSchema),
    peopleMissingRole: z.array(dqPersonRefSchema),
    peopleMissingPersonnelCode: z.array(dqPersonRefSchema),
    activeCredentialsPastExpiry: z.array(
      z.object({ credentialId: z.string(), personId: z.string(), credentialType: z.string(), expiresOn: z.string().nullable() }),
    ),
    credentialsWithoutExpiry: z.array(
      z.object({ credentialId: z.string(), personId: z.string(), credentialType: z.string(), expiresOn: z.string().nullable() }),
    ),
    activeAgreementsPastEnd: z.array(z.object({ agreementId: z.string(), agreementType: z.string(), anchor: z.string(), endsOn: z.string() })),
    activeAgreementsWithoutCode: z.array(z.object({ agreementId: z.string(), agreementType: z.string(), anchor: z.string(), endsOn: z.string() })),
  }),
});
export type DataQualityReportDto = z.infer<typeof dataQualityReportSchema>;

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
// Track B: FX auto-fetch result — the refreshed list + which currencies moved.
export const fxRefreshResponseSchema = z.object({
  rates: z.array(fxRateSchema),
  refreshed: z.array(z.string()),
  skipped: z.array(z.string()),
  source: z.string(),
  asOf: z.string(),
});
export type FxRefreshResponse = z.infer<typeof fxRefreshResponseSchema>;
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
  kind: z.enum(['MissionReadiness', 'CredentialExpiry', 'AgreementWindow', 'ApprovalStale', 'ExecutionFailedRecovery', 'OwnerWedge', 'JourneyStalled', 'IncomeNotInvoiced', 'PaymentOutstanding', 'TeamUnstaffed', 'PayoutsOutstanding', 'ClaimsAwaitingReview', 'DelegationActive', 'RejectedAwaitingRevision', 'DepartureIncomplete', 'ClaimsAwaitingPayment']),
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
  canManageIntake: z.boolean(),
  canManageSubscriptions: z.boolean(),
  canReadAgreements: z.boolean(),
  canViewFinancials: z.boolean(),
  canViewPerDiem: z.boolean(),
  canSubmitClaim: z.boolean(),
  canReadClaims: z.boolean(),
  canDecideClaim: z.boolean(),
  canManageDelegations: z.boolean(),
  canViewSituation: z.boolean(),
  canViewPersonPII: z.boolean(),
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
export const beneficiaryIdParamSchema = z.object({ beneficiaryId: z.string().regex(/^BEN-\d{4,}$/) });
export const credentialResponseSchema = z.object({ credential: credentialSchema });
export const credentialIdParamSchema = z.object({ credentialId: z.string().regex(/^CRED-\d{4,}$/) });
export const journeyIdParamSchema = z.object({ journeyId: z.string().regex(/^JRN-\d{4,}$/) });
