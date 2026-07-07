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
 * member user id (backfilled at execution for ProvisionMember).
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

export const approvalPayloadSchema = z.discriminatedUnion('operationType', [
  addPersonPayloadSchema,
  provisionMemberPayloadSchema,
  changeRolePayloadSchema,
  deactivateMemberPayloadSchema,
  reactivateMemberPayloadSchema,
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
