/**
 * queries.ts — tenant-scoped, role-gated read use-cases. Reads are authorized
 * server-side (never trust the client) and run under the actor's tenant
 * context with RLS as defense in depth.
 */
import {
  type Actor,
  type Approval,
  type ApprovalEvent,
  type ApprovalStatus,
  type AuditEvent,
  type Credential,
  type Member,
  type Person,
  NotFoundError,
} from '@c3web/domain';
import { assertReadMembers, assertReadPeople, assertViewApprovals } from '@c3web/authz';
import type { Persistence } from '../ports';

export function listPeople(p: Persistence, actor: Actor): Promise<Person[]> {
  assertReadPeople(actor);
  return p.reads.forActor(actor).listPeople();
}

/** Sprint 35: tenant-scoped member directory (owner/operations only). */
export function listMembers(p: Persistence, actor: Actor): Promise<Member[]> {
  assertReadMembers(actor);
  return p.reads.forActor(actor).listMembers();
}

// ── Sprint 36: credentials (people-adjacent operational reads — same gate). ──
export function listCredentials(p: Persistence, actor: Actor): Promise<Credential[]> {
  assertReadPeople(actor);
  return p.reads.forActor(actor).listCredentials();
}

export function listCredentialsForPerson(p: Persistence, actor: Actor, personId: string): Promise<Credential[]> {
  assertReadPeople(actor);
  return p.reads.forActor(actor).listCredentialsForPerson(personId);
}

export async function getCredential(p: Persistence, actor: Actor, credentialId: string): Promise<Credential> {
  assertReadPeople(actor);
  const credential = await p.reads.forActor(actor).getCredentialById(credentialId);
  if (!credential) throw new NotFoundError('Credential', credentialId);
  return credential;
}

export async function getPerson(p: Persistence, actor: Actor, personId: string): Promise<Person> {
  assertReadPeople(actor);
  const person = await p.reads.forActor(actor).getPersonById(personId);
  if (!person) throw new NotFoundError('Person', personId);
  return person;
}

export function listApprovals(
  p: Persistence,
  actor: Actor,
  filter?: { statuses?: ApprovalStatus[] },
): Promise<Approval[]> {
  assertViewApprovals(actor);
  return p.reads.forActor(actor).listApprovals(filter);
}

export async function getApproval(p: Persistence, actor: Actor, approvalId: string): Promise<Approval> {
  assertViewApprovals(actor);
  const approval = await p.reads.forActor(actor).getApprovalById(approvalId);
  if (!approval) throw new NotFoundError('Approval', approvalId);
  return approval;
}

export async function listApprovalEvents(p: Persistence, actor: Actor, approvalId: string): Promise<ApprovalEvent[]> {
  assertViewApprovals(actor);
  // Ensure the approval is visible in this tenant before returning its history.
  const approval = await p.reads.forActor(actor).getApprovalById(approvalId);
  if (!approval) throw new NotFoundError('Approval', approvalId);
  return p.reads.forActor(actor).listApprovalEvents(approvalId);
}

export function listAuditEvents(
  p: Persistence,
  actor: Actor,
  entityType: string,
  entityId: string,
): Promise<AuditEvent[]> {
  assertViewApprovals(actor);
  return p.reads.forActor(actor).listAuditEventsForEntity(entityType, entityId);
}
