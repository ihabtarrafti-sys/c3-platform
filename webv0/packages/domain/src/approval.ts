/**
 * approval.ts — the Approval domain entity and typed governed-operation
 * payloads (ADR-013). Extracted from the frozen approvalPayloads.ts +
 * IApprovalsService, with SharePoint coupling removed.
 *
 * Phase 1 implements the AddPerson operation only; the union is intentionally
 * open for the remaining governed operations (AddCredential, InitiateJourney,
 * participant membership, …) in later phases.
 */

import { z } from 'zod';
import { addPersonInputSchema } from './person';
import { addCredentialInputSchema, deactivateCredentialInputSchema } from './credential';
import { initiateJourneyInputSchema } from './journey';
import { addMissionParticipantInputSchema, removeMissionParticipantInputSchema } from './mission';
import { addAgreementInputSchema, renewAgreementInputSchema, terminateAgreementInputSchema } from './agreement';
import {
  submitAddAgreementTermInputSchema,
  submitUpdateAgreementTermInputSchema,
  submitRemoveAgreementTermInputSchema,
} from './agreementTerm';
import {
  changeRoleInputSchema,
  deactivateMemberInputSchema,
  provisionMemberInputSchema,
  reactivateMemberInputSchema,
} from './member';
import type { ApprovalStatus } from './lifecycle';

export const OPERATION_TYPES = [
  'AddPerson',
  // Sprint 35 tenant-admin (A-8 Phase 2): governed access administration.
  'ProvisionMember',
  'ChangeRole',
  'DeactivateMember',
  'ReactivateMember',
  // Sprint 36: the Credentials domain.
  'AddCredential',
  'DeactivateCredential',
  // Sprint 37: the Journeys domain (transitions are direct-audited, not governed).
  'InitiateJourney',
  // Sprint 39: mission participant membership (the mission SHELL is
  // direct-audited and never enters the pipeline).
  'AddMissionParticipant',
  'RemoveMissionParticipant',
  // Sprint 41: agreements (contracts, NDAs, addendums, …) — the MATERIAL
  // lifecycle is governed (creation, term renewal, termination);
  // non-material edits are direct-audited.
  'AddAgreement',
  'RenewAgreement',
  'TerminateAgreement',
  // Finance S3.5: agreement financial TERMS are material money — every change
  // (add / edit / remove, all kinds) is dual-controlled through the pipeline.
  'AddAgreementTerm',
  'UpdateAgreementTerm',
  'RemoveAgreementTerm',
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

/**
 * The immutable payload captured at submission time. It is a SNAPSHOT of
 * intent — persisted verbatim and never mutated after submission.
 */
export const addPersonPayloadSchema = z
  .object({
    operationType: z.literal('AddPerson'),
    input: addPersonInputSchema,
  })
  .strict();

export type AddPersonApprovalPayload = z.infer<typeof addPersonPayloadSchema>;

/**
 * Member-operation payloads (Sprint 35). For these, Approval.targetPersonId
 * carries the MEMBER_OP_TARGET sentinel and Approval.targetId carries the
 * target member user id at submission (null for ProvisionMember — targetId is
 * write-once, so the created user id is recorded in the execution event +
 * audit trail instead).
 */
export const provisionMemberPayloadSchema = z
  .object({ operationType: z.literal('ProvisionMember'), input: provisionMemberInputSchema })
  .strict();
export type ProvisionMemberApprovalPayload = z.infer<typeof provisionMemberPayloadSchema>;

export const changeRolePayloadSchema = z
  .object({ operationType: z.literal('ChangeRole'), input: changeRoleInputSchema })
  .strict();
export type ChangeRoleApprovalPayload = z.infer<typeof changeRolePayloadSchema>;

export const deactivateMemberPayloadSchema = z
  .object({ operationType: z.literal('DeactivateMember'), input: deactivateMemberInputSchema })
  .strict();
export type DeactivateMemberApprovalPayload = z.infer<typeof deactivateMemberPayloadSchema>;

export const reactivateMemberPayloadSchema = z
  .object({ operationType: z.literal('ReactivateMember'), input: reactivateMemberInputSchema })
  .strict();
export type ReactivateMemberApprovalPayload = z.infer<typeof reactivateMemberPayloadSchema>;

/**
 * Credential payloads (Sprint 36). Approval.targetPersonId carries the OWNING
 * person's PER-XXXX for both operations (the column's natural fit); the
 * created CRED id is recorded in the execution event + audit (targetId is
 * write-once and stays the credential id for DeactivateCredential, null for
 * AddCredential until known-at-execute).
 */
export const addCredentialPayloadSchema = z
  .object({ operationType: z.literal('AddCredential'), input: addCredentialInputSchema })
  .strict();
export type AddCredentialApprovalPayload = z.infer<typeof addCredentialPayloadSchema>;

export const deactivateCredentialPayloadSchema = z
  .object({ operationType: z.literal('DeactivateCredential'), input: deactivateCredentialInputSchema })
  .strict();
export type DeactivateCredentialApprovalPayload = z.infer<typeof deactivateCredentialPayloadSchema>;

/** InitiateJourney payload (Sprint 37): targetPersonId = the owning person. */
export const initiateJourneyPayloadSchema = z
  .object({ operationType: z.literal('InitiateJourney'), input: initiateJourneyInputSchema })
  .strict();
export type InitiateJourneyApprovalPayload = z.infer<typeof initiateJourneyPayloadSchema>;

/**
 * Mission participant payloads (Sprint 39). Both targets are known at
 * submission: targetPersonId carries the participant's PER-XXXX and targetId
 * carries the mission's MSN-XXXX. The duplicate-participant guards run at
 * submit (friendly) and at execute (authoritative, in-transaction).
 */
export const addMissionParticipantPayloadSchema = z
  .object({ operationType: z.literal('AddMissionParticipant'), input: addMissionParticipantInputSchema })
  .strict();
export type AddMissionParticipantApprovalPayload = z.infer<typeof addMissionParticipantPayloadSchema>;

export const removeMissionParticipantPayloadSchema = z
  .object({ operationType: z.literal('RemoveMissionParticipant'), input: removeMissionParticipantInputSchema })
  .strict();
export type RemoveMissionParticipantApprovalPayload = z.infer<typeof removeMissionParticipantPayloadSchema>;

/**
 * Agreement payloads (Sprint 41). targetPersonId carries the owning person's
 * PER id (AddAgreement) or the agreement's owner as recorded at submit
 * (Renew/Terminate); targetId carries the AGR id for Renew/Terminate and is
 * null for AddAgreement until execution allocates it.
 */
export const addAgreementPayloadSchema = z
  .object({ operationType: z.literal('AddAgreement'), input: addAgreementInputSchema })
  .strict();
export type AddAgreementApprovalPayload = z.infer<typeof addAgreementPayloadSchema>;

export const renewAgreementPayloadSchema = z
  .object({ operationType: z.literal('RenewAgreement'), input: renewAgreementInputSchema })
  .strict();
export type RenewAgreementApprovalPayload = z.infer<typeof renewAgreementPayloadSchema>;

export const terminateAgreementPayloadSchema = z
  .object({ operationType: z.literal('TerminateAgreement'), input: terminateAgreementInputSchema })
  .strict();
export type TerminateAgreementApprovalPayload = z.infer<typeof terminateAgreementPayloadSchema>;

/**
 * Agreement financial-term payloads (Sprint 3.5). targetPersonId carries the
 * owning person; targetId carries the AGR id (Add) or the TRM id (Update/Remove).
 * The snapshot holds the full intended value set; the shape is re-validated at
 * execute (assertTermShape) as the authoritative check.
 */
export const addAgreementTermPayloadSchema = z
  .object({ operationType: z.literal('AddAgreementTerm'), input: submitAddAgreementTermInputSchema })
  .strict();
export type AddAgreementTermApprovalPayload = z.infer<typeof addAgreementTermPayloadSchema>;

export const updateAgreementTermPayloadSchema = z
  .object({ operationType: z.literal('UpdateAgreementTerm'), input: submitUpdateAgreementTermInputSchema })
  .strict();
export type UpdateAgreementTermApprovalPayload = z.infer<typeof updateAgreementTermPayloadSchema>;

export const removeAgreementTermPayloadSchema = z
  .object({ operationType: z.literal('RemoveAgreementTerm'), input: submitRemoveAgreementTermInputSchema })
  .strict();
export type RemoveAgreementTermApprovalPayload = z.infer<typeof removeAgreementTermPayloadSchema>;

export const approvalPayloadSchema = z.discriminatedUnion('operationType', [
  addPersonPayloadSchema,
  provisionMemberPayloadSchema,
  changeRolePayloadSchema,
  deactivateMemberPayloadSchema,
  reactivateMemberPayloadSchema,
  addCredentialPayloadSchema,
  deactivateCredentialPayloadSchema,
  initiateJourneyPayloadSchema,
  addMissionParticipantPayloadSchema,
  removeMissionParticipantPayloadSchema,
  addAgreementPayloadSchema,
  renewAgreementPayloadSchema,
  terminateAgreementPayloadSchema,
  addAgreementTermPayloadSchema,
  updateAgreementTermPayloadSchema,
  removeAgreementTermPayloadSchema,
]);
export type ApprovalPayload = z.infer<typeof approvalPayloadSchema>;

/** An Approval as the domain reasons about it (surrogate UUID lives in persistence). */
export interface Approval {
  /** Canonical business identity, e.g. "APR-0001". */
  readonly approvalId: string;
  readonly tenantId: string;
  readonly operationType: OperationType;
  /** Canonical target person; "PENDING-ADDPERSON" until AddPerson executes. */
  readonly targetPersonId: string;
  /** Optional opaque secondary target reference. */
  readonly targetId: string | null;
  readonly reason: string | null;
  readonly status: ApprovalStatus;
  /** Immutable snapshot of intent. */
  readonly payload: ApprovalPayload;
  readonly submittedBy: string;
  readonly submittedAt: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly rejectionReason: string | null;
  readonly executedAt: string | null;
  readonly executionError: string | null;
  /** Optimistic-concurrency token (monotonic integer). */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Parse/validate an unknown value as a governed approval payload. */
export function parseApprovalPayload(value: unknown): ApprovalPayload {
  return approvalPayloadSchema.parse(value);
}
