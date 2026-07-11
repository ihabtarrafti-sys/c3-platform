/**
 * comment.ts — Track B4: contextual comments + @mentions.
 *
 * A comment is a note attached to a record — discussion and clarification kept
 * ON the record, in C3, instead of scattering to chat. @mentions are an
 * EXPLICIT list the composer picks (not fragile @-text parsing); they fan out
 * to the S10 notification bell. Comments are append-only (part of the record's
 * history the moment they land).
 */
import { z } from 'zod';

export const COMMENT_SUBJECT_TYPES = ['Person', 'Mission', 'Agreement', 'Approval'] as const;
export type CommentSubjectType = (typeof COMMENT_SUBJECT_TYPES)[number];

export interface Comment {
  readonly id: string;
  readonly subjectType: CommentSubjectType;
  readonly subjectId: string;
  readonly author: string;
  readonly body: string;
  /** Authoritative @mention list (member identities). */
  readonly mentions: readonly string[];
  readonly createdAt: string;
}

const subjectIdField = z.string().trim().min(1).max(40);

export const postCommentInputSchema = z
  .object({
    subjectType: z.enum(COMMENT_SUBJECT_TYPES),
    subjectId: subjectIdField,
    body: z.string().trim().min(1, 'A comment cannot be empty.').max(4000),
    /** Member identities to notify; deduped, self-mention dropped in the use case. */
    mentions: z.array(z.string().trim().min(1).max(200)).max(50).optional().default([]),
  })
  .strict();
export type PostCommentInput = z.infer<typeof postCommentInputSchema>;

export const commentsQueryFor = z
  .object({ subjectType: z.enum(COMMENT_SUBJECT_TYPES), subjectId: subjectIdField })
  .strict();

/** The in-app route a subject lives at (for a mention notification's link). */
export function subjectRoute(subjectType: CommentSubjectType, subjectId: string): string {
  switch (subjectType) {
    case 'Person':
      return `/people/${subjectId}`;
    case 'Mission':
      return `/missions/${subjectId}`;
    case 'Agreement':
      return `/agreements/${subjectId}`;
    case 'Approval':
      return `/approvals/${subjectId}`;
  }
}
