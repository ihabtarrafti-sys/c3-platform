/**
 * personOps — S11 People v2: the DIRECT-audited operational update (owner-
 * ratified C2). Team, position, contacts, notes move fast: version-guarded,
 * every change lands before/after in the audit stream. Identity-material
 * fields and lifecycle are NOT reachable here — they belong to the pipeline
 * (submitPersonOps); the allowed-key gate below makes the split structural.
 */
import {
  type Actor,
  type Beneficiary,
  type Credential,
  updateCredentialDetailsSchema,
  type UpdateCredentialDetailsInput,
  ConcurrencyError,
  NotFoundError,
  type Person,
  updatePersonOperationalSchema,
  type UpdatePersonOperationalInput,
} from '@c3web/domain';
import { assertManageMissions, assertTenantMatch, assertViewFinancials } from '@c3web/authz';
import type { Persistence, PersonFieldsPatch, WriteTx } from '../ports';

export async function updatePersonOperational(
  p: Persistence,
  actor: Actor,
  personId: string,
  input: UpdatePersonOperationalInput,
): Promise<Person> {
  // Operational person facts ride the ops-standing gate (owner/operations) —
  // the same pair that runs rosters and missions day to day.
  assertManageMissions(actor);
  const parsed = updatePersonOperationalSchema.parse(input);

  return p.writes.transaction(actor, async (tx: WriteTx) => {
    const current = await tx.lockPerson(personId);
    if (!current) throw new NotFoundError('Person', personId);
    assertTenantMatch(actor.tenantId, current.tenantId);
    if (current.version !== parsed.expectedVersion) throw new ConcurrencyError('Person', personId);

    const patch: PersonFieldsPatch = parsed.patch;
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(parsed.patch) as Array<keyof typeof parsed.patch>) {
      before[key] = current[key as keyof Person] ?? null;
      after[key] = parsed.patch[key] ?? null;
    }

    const person = await tx.updatePersonFields(personId, parsed.expectedVersion, patch);
    if (!person) throw new ConcurrencyError('Person', personId);

    await tx.appendAuditEvent({
      entityType: 'Person',
      entityId: personId,
      action: 'PersonOperationalUpdated',
      actor: actor.identity,
      before,
      after,
    });
    return person;
  });
}

/**
 * S12 direct-audited credential DETAILS patch (spec law 1): issuer, notes and
 * the display label move fast; the compliance FACTS (dates, number, country,
 * kind) belong to the pipeline (submitUpdateCredentialFacts).
 */
export async function updateCredentialDetails(
  p: Persistence,
  actor: Actor,
  credentialId: string,
  input: UpdateCredentialDetailsInput,
): Promise<Credential> {
  assertManageMissions(actor); // ops-standing, same as operational person facts
  const parsed = updateCredentialDetailsSchema.parse(input);

  return p.writes.transaction(actor, async (tx: WriteTx) => {
    const current = await tx.lockCredential(credentialId);
    if (!current) throw new NotFoundError('Credential', credentialId);
    assertTenantMatch(actor.tenantId, current.tenantId);
    if (current.version !== parsed.expectedVersion) throw new ConcurrencyError('Credential', credentialId);

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of Object.keys(parsed.patch) as Array<keyof typeof parsed.patch>) {
      before[key] = current[key as keyof Credential] ?? null;
      after[key] = parsed.patch[key] ?? null;
    }

    const credential = await tx.updateCredentialFields(credentialId, parsed.expectedVersion, parsed.patch);
    if (!credential) throw new ConcurrencyError('Credential', credentialId);

    await tx.appendAuditEvent({
      entityType: 'Credential',
      entityId: credentialId,
      action: 'CredentialDetailsUpdated',
      actor: actor.identity,
      before,
      after,
    });
    return credential;
  });
}

/** S12: beneficiary reads — the registry is finance-gated (routing facts). */
export async function listBeneficiaries(p: Persistence, actor: Actor): Promise<Beneficiary[]> {
  assertViewFinancials(actor);
  return p.reads.forActor(actor).listBeneficiaries();
}

export async function listPersonBeneficiaries(p: Persistence, actor: Actor, personId: string): Promise<Beneficiary[]> {
  assertViewFinancials(actor);
  return p.reads.forActor(actor).listBeneficiariesForPerson(personId);
}
