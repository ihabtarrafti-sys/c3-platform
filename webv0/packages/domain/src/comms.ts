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

// ── The Obligation (the scar-killer): delivered ≠ accepted ≠ done ────────────

export const COMMS_OBLIGATION_STATES = ['Open', 'Delivered', 'Accepted', 'Done', 'Cancelled'] as const;
export type CommsObligationState = (typeof COMMS_OBLIGATION_STATES)[number];

/** A principal-or-external party: an account uuid, or an external label (with
 *  the acceptance variant ALWAYS carrying an internal uuid — the proxy). */
const partySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), userId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('external'), label: z.string().trim().min(1).max(200) }).strict(),
]);
const acceptanceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('account'), userId: z.string().uuid() }).strict(),
  // External authority: the label plus the INTERNAL proxy who records its word.
  z.object({ kind: z.literal('external'), label: z.string().trim().min(1).max(200), proxyUserId: z.string().uuid() }).strict(),
]);

export const createCommsObligationInputSchema = z
  .object({
    description: z.string().trim().min(1).max(2000),
    accountableUserId: z.string().uuid(),
    beneficiary: partySchema,
    acceptance: acceptanceSchema,
    dueAt: z.string().datetime({ offset: true }),
    evidenceRequirement: z.string().trim().min(1).max(1000),
    clientMutationId: z.string().uuid(),
  })
  .strict()
  // Separation of duties — the "delivered ≠ accepted" independence is
  // STRUCTURAL for internal acceptance: one's own authority may not accept
  // one's own delivery. The EXTERNAL-proxy overlap stays legal (the proxy only
  // transcribes an outside authority's word, under a mandatory attestation).
  .refine((v) => !(v.acceptance.kind === 'account' && v.acceptance.userId === v.accountableUserId), {
    message: 'An internal acceptance authority must be independent of the accountable owner.',
    path: ['acceptance'],
  });
export type CreateCommsObligationInput = z.infer<typeof createCommsObligationInputSchema>;

/** A state transition: optimistic version + idempotency + the act's words. */
export const commsObligationTransitionInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    clientMutationId: z.string().uuid(),
    /** accept (external authority): the mandatory attestation; reject/cancel/reopen: the reason. */
    note: z.string().trim().min(1).max(1000).optional(),
  })
  .strict();
export type CommsObligationTransitionInput = z.infer<typeof commsObligationTransitionInputSchema>;

export interface CommsObligationEventView {
  readonly eventType: string;
  readonly fromState: CommsObligationState | null;
  readonly toState: CommsObligationState;
  readonly actorUserId: string;
  readonly actorLabel: string | null;
  readonly reason: string | null;
  readonly attestation: string | null;
  readonly at: string;
}

export interface CommsEvidenceView {
  readonly documentId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly deliveredByUserId: string;
  readonly delivererLabel: string | null;
  readonly note: string | null;
  readonly deliveredAt: string;
}

export interface CommsObligationView {
  readonly obligationId: string;
  readonly threadId: string;
  readonly state: CommsObligationState;
  readonly description: string;
  readonly accountableUserId: string;
  readonly requesterUserId: string;
  readonly beneficiaryKind: 'account' | 'external';
  readonly beneficiaryUserId: string | null;
  readonly beneficiaryLabel: string | null;
  readonly acceptanceKind: 'account' | 'external';
  readonly acceptanceUserId: string;
  readonly acceptanceLabel: string | null;
  readonly dueAt: string;
  readonly evidenceRequirement: string;
  readonly version: number;
  readonly createdAt: string;
  readonly events: CommsObligationEventView[];
  readonly evidence: CommsEvidenceView[];
}

// ── Receipts: derived from the private cursor + the watermark (Battle #1) ────
// "read by X" ⇔ X's cursor covers the seq AND X's receipts are enabled AND the
// cursor movement happened at/after X's receipts_enabled_since — re-enabling
// never retroactively discloses reading done while receipts were off, and no
// per-read shared row is ever written.

/** One member's disclosed read position on a thread. */
export interface CommsReceipt {
  readonly userId: string;
  readonly lastReadSeq: number;
  readonly readAt: string;
}

/** The caller's own cursor (never subject to the disclosure watermark). */
export interface CommsCursor {
  readonly lastReadSeq: number;
  readonly readAt: string;
}

/** Advance the reader's OWN cursor to a seq they have on screen. */
export const advanceCommsCursorInputSchema = z
  .object({ seq: z.number().int().min(1) })
  .strict();
export type AdvanceCommsCursorInput = z.infer<typeof advanceCommsCursorInputSchema>;

/** The user's Comms preferences (missing row = both enabled — the lock ruling). */
export interface CommsPrefs {
  readonly receiptsEnabled: boolean;
  readonly presenceEnabled: boolean;
  /** null = no row yet (the code-side defaults) — the 0037 absent-row pattern. */
  readonly version: number | null;
}

/** Self-only, expected-version prefs write (the tenant_setting CAS shape). */
export const setCommsPrefsInputSchema = z
  .object({
    receiptsEnabled: z.boolean(),
    presenceEnabled: z.boolean(),
    expectedVersion: z.number().int().min(0).nullable(),
  })
  .strict();
export type SetCommsPrefsInput = z.infer<typeof setCommsPrefsInputSchema>;
