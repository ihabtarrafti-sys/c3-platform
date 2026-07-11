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
  ForbiddenError,
  NotFoundError,
  type PostCommentInput,
  postCommentInputSchema,
  subjectRoute,
} from '@c3web/domain';
import { assertReadAgreements, assertReadPeople, canReviewApproval, canSubmitApproval } from '@c3web/authz';
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
      if (!canSubmitApproval(actor.role) && !canReviewApproval(actor.role)) {
        throw new ForbiddenError('Your role cannot see approvals.', { subjectId });
      }
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

  return p.writes.transaction(actor, async (tx) => {
    const comment = await tx.insertComment({
      subjectType: parsed.subjectType,
      subjectId: parsed.subjectId,
      author: actor.identity,
      body: parsed.body,
      mentions,
    });

    // Fan out to the S10 bell — one row per mentioned member (deduped by the
    // notification unique key). Best-effort: a mention that isn't a member
    // simply lands no row (the insert is tenant-RLS'd; a stranger has no
    // notification surface anyway).
    const link = subjectRoute(parsed.subjectType, parsed.subjectId);
    const title = `${actor.identity} mentioned you on ${parsed.subjectType} ${parsed.subjectId}`;
    for (const identity of mentions) {
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
