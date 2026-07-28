/**
 * commentOps — Track B4: contextual comments + @mentions.
 *
 * Discussion kept ON the record, in C3. You may comment WHERE YOU CAN READ:
 * the per-subject gate mirrors that record's own read gate, and the record
 * must exist in your tenant. @mentions are an explicit member list; each
 * mentioned member (except yourself) gets an S10 notification row that links
 * back to the record. Comments are append-only.
 */
import {
  type Actor,
  type Comment,
  type CommentSubjectType,
  NotFoundError,
  type PostCommentInput,
  postCommentInputSchema,
  subjectRoute,
} from '@c3web/domain';
import { assertReadAgreements, assertReadPeople, canReadAgreements, canReadPeople, canReviewApproval, canSubmitApproval } from '@c3web/authz';
import { assertViewApprovalsEffective } from './queries';
import type { Persistence } from '../ports';

/** Gate + existence check per subject type — you comment where you can read. */
async function assertSubjectAccess(p: Persistence, actor: Actor, subjectType: CommentSubjectType, subjectId: string): Promise<void> {
  const reads = p.reads.forActor(actor);
  switch (subjectType) {
    case 'Person': {
      assertReadPeople(actor);
      if (!(await reads.getPersonById(subjectId))) throw new NotFoundError('Person', subjectId);
      return;
    }
    case 'Mission': {
      assertReadPeople(actor); // missions ride the baseline people read
      if (!(await reads.getMissionById(subjectId))) throw new NotFoundError('Mission', subjectId);
      return;
    }
    case 'Agreement': {
      assertReadAgreements(actor);
      if (!(await reads.getAgreementById(subjectId))) throw new NotFoundError('Agreement', subjectId);
      return;
    }
    case 'Approval': {
      // L-04: honor DELEGATION — a delegated approver who can decide the request
      // must be able to use its comment thread. Reuse the effective-standing helper
      // (role standing first; else an active-delegation lookup) rather than the
      // base submit/review capabilities alone.
      await assertViewApprovalsEffective(p, actor);
      if (!(await reads.getApprovalById(subjectId))) throw new NotFoundError('Approval', subjectId);
      return;
    }
  }
}

export async function listComments(p: Persistence, actor: Actor, subjectType: CommentSubjectType, subjectId: string): Promise<Comment[]> {
  await assertSubjectAccess(p, actor, subjectType, subjectId);
  return p.reads.forActor(actor).listCommentsForSubject(subjectType, subjectId);
}

export async function postComment(p: Persistence, actor: Actor, input: PostCommentInput): Promise<Comment> {
  const parsed = postCommentInputSchema.parse(input);
  await assertSubjectAccess(p, actor, parsed.subjectType, parsed.subjectId);

  // Distinct mentions, self dropped (you don't notify yourself).
  const me = actor.identity.trim().toLowerCase();
  const mentions = [...new Set(parsed.mentions.map((m) => m.trim()).filter((m) => m && m.toLowerCase() !== me))];

  // F13 (disclosure chapter): the mention notification NAMES its subject
  // ("… mentioned you on Approval APR-0001"), so the fan-out is itself a
  // disclosure surface — and unvalidated it was a probe/spam vector: any
  // commenter could land subject-naming rows on any string, including members
  // whose role cannot read the subject at all. Fan out ONLY to ACTIVE members
  // whose OWN standing can read the subject (delegation honoured for
  // approvals, same as the read path). The comment ROW keeps the full mention
  // list — the register is unchanged; only the bell is gated. RED-proven at
  // the wire in disclosure.test.ts.
  const members = await p.reads.forActor(actor).listMembers();
  const activeByEmail = new Map(members.filter((m) => m.isActive).map((m) => [m.email.toLowerCase(), m]));
  const today = new Date().toISOString().slice(0, 10);
  const recipients: string[] = [];
  for (const identity of mentions) {
    const member = activeByEmail.get(identity.toLowerCase());
    if (!member) continue;
    switch (parsed.subjectType) {
      case 'Person':
      case 'Mission':
        if (canReadPeople(member.role)) recipients.push(identity);
        break;
      case 'Agreement':
        if (canReadAgreements(member.role)) recipients.push(identity);
        break;
      case 'Approval': {
        const stands =
          canSubmitApproval(member.role) ||
          canReviewApproval(member.role) ||
          (await p.reads.forActor(actor).hasActiveDelegation(identity.toLowerCase(), today));
        if (stands) recipients.push(identity);
        break;
      }
    }
  }

  return p.writes.transaction(actor, async (tx) => {
    const comment = await tx.insertComment({
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      author: actor.identity,
      body: parsed.body,
      mentions,
    });

    // Fan out to the S10 bell — one row per VALIDATED recipient (deduped by
    // the notification unique key).
    const link = subjectRoute(parsed.subjectType, parsed.subjectId);
    const title = `${actor.identity} mentioned you on ${parsed.subjectType} ${parsed.subjectId}`;
    for (const identity of recipients) {
      await tx.insertNotification({
        userIdentity: identity,
        signalKey: `Mention:${comment.id}:${identity}`,
        kind: 'Mention',
        title,
        link,
      });
    }
    return comment;
  });
}
