/**
 * document.ts — the Document domain (S4, Track A; design:
 * docs/design/S4-documents-and-files.md).
 *
 * A Document is REGISTERED EVIDENCE attached to an operational record: the
 * signed contract PDF on an agreement, a receipt or an organizer statement on
 * a mission, a passport scan on a person. C3 holds the METADATA (this module)
 * and the bytes live in PRIVATE object storage under a tenant-scoped key that
 * is never user-controlled. Nothing is ever served publicly; every byte goes
 * through the API under the OWNING record's read gate (an agreement's PDF
 * needs canReadAgreements — the same truthful boundary as the register).
 *
 * Direct-but-audited (evidence RECORDS facts): owner/operations attach and
 * soft-remove; the audit lands on the OWNER record's trail (an agreement's
 * history shows "Document attached"). Removal is a soft flip — the bytes are
 * retained but unreachable through the API (the no-DELETE data-plane law).
 * A server-side SHA-256 is stored at attach time: download integrity is
 * verifiable forever.
 */

import { z } from 'zod';

/** What a document may attach to. V1 UI mounts Agreement/Mission/Person. */
export const DOCUMENT_OWNER_TYPES = ['Agreement', 'Mission', 'Person', 'Credential', 'Entity', 'Invoice', 'Claim'] as const;
export type DocumentOwnerType = (typeof DOCUMENT_OWNER_TYPES)[number];

/** Server-enforced upload ceiling (bytes). */
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

/**
 * The content-type allowlist — the org's real paper: PDFs, images (receipts,
 * scans), spreadsheets/docs, plain text. Anything else is refused at upload.
 */
export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
  'text/plain',
] as const;

export function isAllowedDocumentContentType(v: string): boolean {
  return (DOCUMENT_CONTENT_TYPES as readonly string[]).includes(v);
}

/**
 * HARDEN-2 M-07: the declared content type must MATCH THE BYTES — a caller's
 * multipart MIME label is an assertion, not evidence. Binary formats prove
 * themselves by magic bytes (PDF/PNG/JPEG/WEBP; OOXML = a PK ZIP container);
 * the text types (csv/plain) must NOT look binary: no known binary signature
 * and no NUL byte in the first KiB. A mislabeled body is an upload refusal —
 * it never becomes registered evidence.
 */
export function documentBytesMatchDeclaredType(contentType: string, bytes: Uint8Array): boolean {
  const startsWith = (sig: number[], offset = 0): boolean =>
    bytes.length >= offset + sig.length && sig.every((b, i) => bytes[offset + i] === b);
  const isPdf = () => startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-
  const isPng = () => startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const isJpeg = () => startsWith([0xff, 0xd8, 0xff]);
  const isWebp = () => startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8); // RIFF….WEBP
  const isZip = () => startsWith([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04 (OOXML container)

  switch (contentType) {
    case 'application/pdf':
      return isPdf();
    case 'image/png':
      return isPng();
    case 'image/jpeg':
      return isJpeg();
    case 'image/webp':
      return isWebp();
    case 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
      return isZip();
    case 'text/csv':
    case 'text/plain': {
      if (isPdf() || isPng() || isJpeg() || isWebp() || isZip()) return false;
      const head = bytes.subarray(0, 1024);
      return !head.includes(0);
    }
    default:
      return false; // not on the allowlist ⇒ never byte-lawful either
  }
}

/** A Document as the domain reasons about it (bytes live in object storage). */
export interface C3Document {
  /** Canonical business identity, e.g. "DOC-0001". */
  readonly documentId: string;
  readonly tenantId: string;
  readonly ownerType: DocumentOwnerType;
  /** The owning record's canonical business id (AGR-0001, MSN-0001, PER-0001…). */
  readonly ownerId: string;
  /** Original filename as uploaded (display only — never a storage path). */
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  /** Server-computed at attach time; integrity is verifiable forever. */
  readonly sha256: string;
  /** Optional human label, e.g. "Signed copy", "Invoice from organizer". */
  readonly label: string | null;
  /** Opaque tenant-scoped storage key — server-generated, never user input. */
  readonly storageKey: string;
  readonly uploadedBy: string;
  readonly isActive: boolean;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const ownerIdField = z
  .string()
  .regex(/^(AGR|MSN|PER|CRED|ENT|INV|CLM)-\d{4,}$/, 'ownerId must be a canonical business id');

/** The attach metadata the API supplies after receiving + hashing the bytes. */
export const documentAttachInputSchema = z
  .object({
    ownerType: z.enum(DOCUMENT_OWNER_TYPES),
    ownerId: ownerIdField,
    fileName: z.string().trim().min(1).max(255),
    contentType: z.string().refine(isAllowedDocumentContentType, 'This file type is not allowed.'),
    sizeBytes: z.number().int().positive().max(DOCUMENT_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    storageKey: z.string().min(1).max(300),
    label: z
      .string()
      .trim()
      .max(200)
      .transform((v) => (v === '' ? null : v))
      .nullish()
      .transform((v) => v ?? null),
  })
  .strict()
  .refine(
    (v) =>
      (v.ownerType === 'Agreement' && v.ownerId.startsWith('AGR-')) ||
      (v.ownerType === 'Mission' && v.ownerId.startsWith('MSN-')) ||
      (v.ownerType === 'Person' && v.ownerId.startsWith('PER-')) ||
      (v.ownerType === 'Credential' && v.ownerId.startsWith('CRED-')) ||
      (v.ownerType === 'Entity' && v.ownerId.startsWith('ENT-')) ||
      (v.ownerType === 'Invoice' && v.ownerId.startsWith('INV-')) ||
      (v.ownerType === 'Claim' && v.ownerId.startsWith('CLM-')),
    { message: 'The owner id does not match the owner type.', path: ['ownerId'] },
  );
export type DocumentAttachInput = z.infer<typeof documentAttachInputSchema>;
