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
  APPROVAL_STATUSES,
  C3_ROLES,
  OPERATION_TYPES,
  addCredentialInputSchema,
  addPersonInputSchema,
  approvalPayloadSchema,
  changeRolePayloadSchema,
  deactivateCredentialInputSchema,
  deactivateMemberPayloadSchema,
  provisionMemberPayloadSchema,
  reactivateMemberPayloadSchema,
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
