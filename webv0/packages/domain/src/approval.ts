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
import type { ApprovalStatus } from './lifecycle';

export const OPERATION_TYPES = ['AddPerson'] as const;
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

export const approvalPayloadSchema = z.discriminatedUnion('operationType', [addPersonPayloadSchema]);
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
