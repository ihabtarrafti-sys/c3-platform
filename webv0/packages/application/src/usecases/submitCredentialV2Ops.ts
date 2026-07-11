/**
 * submitCredentialV2Ops — S12: the governed mutations of credential compliance
 * facts and the beneficiary registry (spec laws 1+2, docs/design/S12).
 *
 * One open request per TARGET (credential / beneficiary / person-for-add) —
 * a second would race the first's snapshot. Payloads are snapshots of intent;
 * the current record is re-read and validated at execute time.
 */
import {
  type Actor,
  type AddBeneficiaryInput,
  type Approval,
  ConflictError,
  NotFoundError,
  type RetireBeneficiaryInput,
  type UpdateBeneficiaryInput,
  type UpdateCredentialFactsInput,
  addBeneficiaryInputSchema,
  formatApprovalId,
  retireBeneficiaryInputSchema,
  updateBeneficiaryInputSchema,
  updateCredentialFactsInputSchema,
} from '@c3web/domain';
import { assertSubmitApproval } from '@c3web/authz';
import type { Persistence } from '../ports';

const OPEN_STATUSES = ['Submitted', 'InReview', 'Approved', 'ExecutionFailed'] as const;

async function assertNoOpenOpOnTarget(p: Persistence, actor: Actor, ops: readonly string[], targetId: string): Promise<void> {
  const open = await p.reads.forActor(actor).listApprovals({ statuses: [...OPEN_STATUSES] });
  if (open.some((a) => ops.includes(a.operationType) && a.targetId === targetId)) {
    throw new ConflictError('An open request already exists for this record. Resolve it before submitting another.', { targetId });
  }
}

interface SubmitSpec {
  readonly op: 'UpdateCredentialFacts' | 'AddBeneficiary' | 'UpdateBeneficiary' | 'RetireBeneficiary';
  readonly targetPersonId: string;
  readonly targetId: string | null;
  readonly input: unknown;
  readonly note: string;
  readonly auditAfter: Record<string, unknown>;
}

async function submitOp(p: Persistence, actor: Actor, reasonRaw: string | null | undefined, spec: SubmitSpec): Promise<Approval> {
  const reason = reasonRaw?.trim() ? reasonRaw.trim() : null;
  return p.writes.transaction(actor, async (tx) => {
    const seq = await tx.allocateSequence('approval');
    const approvalId = formatApprovalId(seq);
    const approval = await tx.insertApproval({
      approvalId,
      operationType: spec.op,
      targetPersonId: spec.targetPersonId,
      targetId: spec.targetId,
      reason,
      payload: { operationType: spec.op, input: spec.input } as Approval['payload'],
      submittedBy: actor.identity,
    });
    await tx.appendApprovalEvent({ approvalId, fromStatus: null, toStatus: 'Submitted', actor: actor.identity, note: spec.note });
    await tx.appendAuditEvent({
      entityType: 'Approval',
      entityId: approvalId,
      action: 'ApprovalSubmitted',
      actor: actor.identity,
      before: null,
      after: { status: 'Submitted', operationType: spec.op, ...spec.auditAfter },
    });
    return approval;
  });
}

export async function submitUpdateCredentialFacts(
  p: Persistence,
  actor: Actor,
  command: { input: UpdateCredentialFactsInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = updateCredentialFactsInputSchema.parse(command.input);
  const current = await p.reads.forActor(actor).getCredentialById(input.credentialId);
  if (!current) throw new NotFoundError('Credential', input.credentialId);
  if (!current.isActive) throw new ConflictError('The credential is inactive — facts of a retired record do not change.', { credentialId: input.credentialId });
  await assertNoOpenOpOnTarget(p, actor, ['UpdateCredentialFacts', 'DeactivateCredential'], input.credentialId);
  return submitOp(p, actor, command.reason, {
    op: 'UpdateCredentialFacts',
    targetPersonId: current.personId, // a credential's owner is always a person
    targetId: input.credentialId,
    input,
    note: `UpdateCredentialFacts request submitted for ${input.credentialId} (${Object.keys(input.patch).join(', ')})`,
    auditAfter: { credentialId: input.credentialId, fields: Object.keys(input.patch) },
  });
}

export async function submitAddBeneficiary(
  p: Persistence,
  actor: Actor,
  command: { input: AddBeneficiaryInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = addBeneficiaryInputSchema.parse(command.input);
  const person = await p.reads.forActor(actor).getPersonById(input.personId);
  if (!person) throw new NotFoundError('Person', input.personId);
  // friendly duplicate-label refusal (the DB partial-unique is the hard law)
  const existing = await p.reads.forActor(actor).listBeneficiariesForPerson(input.personId);
  if (existing.some((b) => b.status !== 'Retired' && b.label.toLowerCase() === input.label.toLowerCase())) {
    throw new ConflictError(`'${input.label}' is already a live beneficiary label for ${input.personId}.`);
  }
  return submitOp(p, actor, command.reason, {
    op: 'AddBeneficiary',
    targetPersonId: input.personId,
    targetId: null,
    input,
    note: `AddBeneficiary request submitted: "${input.label}" (${input.bankName}, ${input.currency}) for ${input.personId}`,
    auditAfter: { personId: input.personId, label: input.label, bankName: input.bankName },
  });
}

export async function submitUpdateBeneficiary(
  p: Persistence,
  actor: Actor,
  command: { input: UpdateBeneficiaryInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = updateBeneficiaryInputSchema.parse(command.input);
  const current = await p.reads.forActor(actor).getBeneficiaryById(input.beneficiaryId);
  if (!current) throw new NotFoundError('Beneficiary', input.beneficiaryId);
  if (current.status === 'Retired') throw new ConflictError(`${input.beneficiaryId} is retired.`);
  await assertNoOpenOpOnTarget(p, actor, ['UpdateBeneficiary', 'RetireBeneficiary'], input.beneficiaryId);
  return submitOp(p, actor, command.reason, {
    op: 'UpdateBeneficiary',
    targetPersonId: current.personId ?? 'N/A-PAYEE', // dormant freelancer/vendor seats (0035)
    targetId: input.beneficiaryId,
    input,
    note: `UpdateBeneficiary request submitted for ${input.beneficiaryId} (${Object.keys(input.patch).join(', ')})`,
    auditAfter: { beneficiaryId: input.beneficiaryId, fields: Object.keys(input.patch) },
  });
}

export async function submitRetireBeneficiary(
  p: Persistence,
  actor: Actor,
  command: { input: RetireBeneficiaryInput; reason?: string | null },
): Promise<Approval> {
  assertSubmitApproval(actor);
  const input = retireBeneficiaryInputSchema.parse(command.input);
  const current = await p.reads.forActor(actor).getBeneficiaryById(input.beneficiaryId);
  if (!current) throw new NotFoundError('Beneficiary', input.beneficiaryId);
  if (current.status === 'Retired') throw new ConflictError(`${input.beneficiaryId} is already retired.`);
  await assertNoOpenOpOnTarget(p, actor, ['UpdateBeneficiary', 'RetireBeneficiary'], input.beneficiaryId);
  return submitOp(p, actor, command.reason ?? input.reason, {
    op: 'RetireBeneficiary',
    targetPersonId: current.personId ?? 'N/A-PAYEE', // dormant freelancer/vendor seats (0035)
    targetId: input.beneficiaryId,
    input,
    note: `RetireBeneficiary request submitted for ${input.beneficiaryId}: ${input.reason}`,
    auditAfter: { beneficiaryId: input.beneficiaryId, retireReason: input.reason },
  });
}
