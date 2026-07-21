/**
 * comms.ts — the Mission Comms slice's domain contracts.
 *
 * Comms is the licensed module built on the 0088–0095 spine: anchored mission
 * threads (readership = the mission's live gate), an immutable message spine
 * whose BODY lives in append-only revisions (revision 1 IS the post), "link,
 * never execute" object chips, and server-owned Comms documents. Every
 * principal is the stable app_user.id uuid (the binding graft), never email.
 *
 * Governance posture (owner-ruled, 2026-07-21): mission-thread content is
 * mission-visible — every role that can see the mission reads the thread and
 * its attachments, WIDER than the bytes' native finance/legal gate. A conscious
 * acceptance; the composer warns, and obligation-minting is operational-only.
 */

import { z } from 'zod';

/** The module key of the Comms license row (tenant_module_entitlement). */
export const COMMS_MODULE_KEY = 'comms';

/** Message body ceiling (untrusted plain text — constraint #5; comment's 4000 doubled). */
export const COMMS_MESSAGE_MAX_CHARS = 8000;

/** Keyset page size ceiling for thread reads. */
export const COMMS_MESSAGES_PAGE_MAX = 100;

/** 0091's comms_object_link target vocabulary — chips navigate, never execute. */
export const COMMS_LINK_TARGET_TYPES = ['Approval', 'Mission', 'Journey', 'Person', 'Credential', 'Document', 'Message', 'Obligation'] as const;
export type CommsLinkTargetType = (typeof COMMS_LINK_TARGET_TYPES)[number];

/** target_type → canonical business-id prefix (the chip's id must match its type). */
const LINK_PREFIX: Record<CommsLinkTargetType, string> = {
  Approval: 'APR',
  Mission: 'MSN',
  Journey: 'JRN',
  Person: 'PER',
  Credential: 'CRED',
  Document: 'DOC',
  Message: 'MSG',
  Obligation: 'OBL',
};

const commsLinkSchema = z
  .object({
    targetType: z.enum(COMMS_LINK_TARGET_TYPES),
    targetId: z.string().regex(/^[A-Z]{3,4}-\d{4,}$/, 'targetId must be a canonical business id'),
  })
  .strict()
  .refine((v) => v.targetId.startsWith(`${LINK_PREFIX[v.targetType]}-`), {
    message: 'The link target id does not match its target type.',
    path: ['targetId'],
  });
export type CommsLinkInput = z.infer<typeof commsLinkSchema>;

/** Post a message: untrusted plain-text body + optional chips + send idempotency. */
export const postCommsMessageInputSchema = z
  .object({
    body: z.string().trim().min(1, 'The message is empty.').max(COMMS_MESSAGE_MAX_CHARS),
    links: z.array(commsLinkSchema).max(10).default([]),
    clientMutationId: z.string().uuid(),
  })
  .strict();
export type PostCommsMessageInput = z.infer<typeof postCommsMessageInputSchema>;

/** The module entitlement row as the application reasons about it (0088). */
export interface ModuleEntitlement {
  readonly moduleKey: string;
  readonly state: 'active' | 'lapsed';
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
  readonly storageQuotaBytes: number | null;
  readonly version: number;
}

/** A Comms thread as the slice reads it (anchored-Mission in v1). */
export interface CommsThread {
  readonly threadId: string;
  readonly kind: 'anchored' | 'standing' | 'direct';
  readonly anchorType: string | null;
  readonly anchorId: string | null;
  readonly title: string | null;
  readonly status: 'active' | 'archived';
  readonly lastSeq: number;
  readonly lastMessageAt: string | null;
  readonly createdAt: string;
}

/** A rendered object-link chip (re-gated at every render — never executes). */
export interface CommsMessageLink {
  readonly targetType: CommsLinkTargetType;
  readonly targetId: string;
}

/** An attachment as projected into the thread (bytes served via the guarded content path). */
export interface CommsMessageAttachment {
  readonly documentId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
}

/** The thread read model: the message spine joined with its LATEST revision. */
export interface CommsMessageView {
  readonly messageId: string;
  readonly threadId: string;
  readonly seq: number;
  readonly authorUserId: string;
  readonly authorLabel: string | null;
  readonly body: string;
  readonly revisionNo: number;
  readonly links: CommsMessageLink[];
  readonly attachments: CommsMessageAttachment[];
  readonly createdAt: string;
}
