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
import {
  addPersonInputSchema,
  updatePersonIdentityInputSchema,
  deactivatePersonInputSchema,
  reactivatePersonInputSchema,
} from './person';
import { updateCredentialFactsInputSchema } from './credential';
import { addBeneficiaryInputSchema, updateBeneficiaryInputSchema, retireBeneficiaryInputSchema } from './beneficiary';
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
import { importBatchInputSchema } from './importExport';
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
  // S5: one governed approval per VALIDATED import file — ops stages the
  // batch, the owner executes it (requester ≠ approver at batch scale).
  'ImportBatch',
  // S11: identity-material person facts + lifecycle are governed (owner-
  // ratified C2); operational person facts stay direct-audited.
  'UpdatePersonIdentity',
  'DeactivatePerson',
  'ReactivatePerson',
  // S12: credential compliance facts + the beneficiary registry are governed.
  'UpdateCredentialFacts',
  'AddBeneficiary',
  'UpdateBeneficiary',
  'RetireBeneficiary',
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

export const importBatchPayloadSchema = z
  .object({ operationType: z.literal('ImportBatch'), input: importBatchInputSchema })
  .strict();
export type ImportBatchApprovalPayload = z.infer<typeof importBatchPayloadSchema>;

// S11: governed person mutations — the payload snapshots INTENT at submission;
// the current record is re-read and validated at execute time.
export const updatePersonIdentityPayloadSchema = z
  .object({ operationType: z.literal('UpdatePersonIdentity'), input: updatePersonIdentityInputSchema })
  .strict();
export type UpdatePersonIdentityApprovalPayload = z.infer<typeof updatePersonIdentityPayloadSchema>;

export const deactivatePersonPayloadSchema = z
  .object({ operationType: z.literal('DeactivatePerson'), input: deactivatePersonInputSchema })
  .strict();
export type DeactivatePersonApprovalPayload = z.infer<typeof deactivatePersonPayloadSchema>;

export const reactivatePersonPayloadSchema = z
  .object({ operationType: z.literal('ReactivatePerson'), input: reactivatePersonInputSchema })
  .strict();
export type ReactivatePersonApprovalPayload = z.infer<typeof reactivatePersonPayloadSchema>;

// S12: credential facts + beneficiary registry payloads.
export const updateCredentialFactsPayloadSchema = z
  .object({ operationType: z.literal('UpdateCredentialFacts'), input: updateCredentialFactsInputSchema })
  .strict();
export type UpdateCredentialFactsApprovalPayload = z.infer<typeof updateCredentialFactsPayloadSchema>;

export const addBeneficiaryPayloadSchema = z
  .object({ operationType: z.literal('AddBeneficiary'), input: addBeneficiaryInputSchema })
  .strict();
export type AddBeneficiaryApprovalPayload = z.infer<typeof addBeneficiaryPayloadSchema>;

export const updateBeneficiaryPayloadSchema = z
  .object({ operationType: z.literal('UpdateBeneficiary'), input: updateBeneficiaryInputSchema })
  .strict();
export type UpdateBeneficiaryApprovalPayload = z.infer<typeof updateBeneficiaryPayloadSchema>;

export const retireBeneficiaryPayloadSchema = z
  .object({ operationType: z.literal('RetireBeneficiary'), input: retireBeneficiaryInputSchema })
  .strict();
export type RetireBeneficiaryApprovalPayload = z.infer<typeof retireBeneficiaryPayloadSchema>;

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
  importBatchPayloadSchema,
  updatePersonIdentityPayloadSchema,
  deactivatePersonPayloadSchema,
  reactivatePersonPayloadSchema,
  updateCredentialFactsPayloadSchema,
  addBeneficiaryPayloadSchema,
  updateBeneficiaryPayloadSchema,
  retireBeneficiaryPayloadSchema,
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
  /** Track B1: how many pre-review edits this request took (the "Edited ×N" badge). */
  readonly editCount: number;
  /** Track B1: the request this one revises (APR-XXXX), set at submission only. */
  readonly revisionOf: string | null;
  /** Track B1: the request that superseded this one (APR-XXXX), write-once. */
  readonly supersededBy: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Parse/validate an unknown value as a governed approval payload. */
export function parseApprovalPayload(value: unknown): ApprovalPayload {
  return approvalPayloadSchema.parse(value);
}

// ── Track B1: request corrections ────────────────────────────────────────────
// "Polish freely until review starts — every change on the record; after
// that, frozen; corrections are new requests."

/**
 * Ops whose requests cannot be edited/revised through the corrections lanes.
 * ImportBatch payloads are whole staged FILES — the correction is re-staging.
 */
export const CORRECTIONS_EXCLUDED_OPS = ['ImportBatch'] as const satisfies readonly OperationType[];

/**
 * Per-op TARGET-IDENTIFYING input keys: an EDIT must keep these byte-equal —
 * the one-open-request-per-target guards ran at submission, and a retargeting
 * edit would dodge them. Changing the target = withdraw or revise.
 * (A completeness test asserts every OperationType appears here or in the
 * exclusion list.)
 */
export const EDIT_TARGET_KEYS: Readonly<Record<Exclude<OperationType, (typeof CORRECTIONS_EXCLUDED_OPS)[number]>, readonly string[]>> = {
  AddPerson: [],
  ProvisionMember: ['email'],
  ChangeRole: ['targetUserId', 'email'],
  DeactivateMember: ['targetUserId', 'email'],
  ReactivateMember: ['targetUserId', 'email'],
  AddCredential: ['personId'],
  DeactivateCredential: ['credentialId'],
  InitiateJourney: ['personId'],
  AddMissionParticipant: ['missionId', 'personId'],
  RemoveMissionParticipant: ['missionId', 'personId'],
  AddAgreement: ['personId', 'entityId'],
  RenewAgreement: ['agreementId'],
  TerminateAgreement: ['agreementId'],
  AddAgreementTerm: ['agreementId'],
  UpdateAgreementTerm: ['termId'],
  RemoveAgreementTerm: ['termId'],
  UpdatePersonIdentity: ['personId'],
  DeactivatePerson: ['personId'],
  ReactivatePerson: ['personId'],
  UpdateCredentialFacts: ['credentialId'],
  AddBeneficiary: ['personId'],
  UpdateBeneficiary: ['beneficiaryId'],
  RetireBeneficiary: ['beneficiaryId'],
};

/** Statuses a request may be REVISED from (fresh linked request). Approved
 * belongs to the reviewers, ExecutionFailed to the owner's re-execute lane,
 * Executed is done. */
export const REVISABLE_STATUSES: readonly ApprovalStatus[] = ['Submitted', 'InReview', 'Rejected', 'Withdrawn'];

const approvalIdField = z.string().regex(/^APR-\d{4,}$/);

/** Edit-before-review: replace the payload INPUT of your own Submitted request. */
export const editApprovalInputSchema = z
  .object({
    approvalId: approvalIdField,
    expectedVersion: z.number().int().min(0),
    /** The op's input shape — revalidated through approvalPayloadSchema. */
    input: z.unknown(),
  })
  .strict();
export type EditApprovalInput = z.infer<typeof editApprovalInputSchema>;

/** Revise & resubmit: withdraw-if-open + fresh linked request via the op's REAL submit. */
export const reviseApprovalInputSchema = z
  .object({
    approvalId: approvalIdField,
    expectedVersion: z.number().int().min(0),
    input: z.unknown(),
    reason: z.string().trim().max(1000).nullish(),
  })
  .strict();
export type ReviseApprovalInput = z.infer<typeof reviseApprovalInputSchema>;

/** The field names whose values differ between two op inputs (sorted; for the record). */
export function changedInputFields(before: unknown, after: unknown): string[] {
  const a = (before ?? {}) as Record<string, unknown>;
  const b = (after ?? {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}
