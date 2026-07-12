/**
 * credential.ts — the Credential domain entity and its governed-operation
 * input contracts (Sprint 36; design: docs/design/S36-credentials-domain.md).
 *
 * A Credential belongs to exactly one Person (PER-XXXX within the tenant) and
 * carries PLAIN calendar dates as ISO `YYYY-MM-DD` strings end-to-end — no
 * timestamps, no timezone math (the CP date-swap lesson, baked in at the type
 * boundary). The schema rejects impossible dates and expiry ≤ issue.
 */

import { z } from 'zod';

/** S12: the typed taxonomy — `credentialType` stays as the display label. */
export const CREDENTIAL_KINDS = ['Passport', 'NationalID', 'Visa', 'License', 'Other'] as const;
export type CredentialKind = (typeof CREDENTIAL_KINDS)[number];

/** A Credential as the domain reasons about it (surrogate UUID lives in persistence). */
export interface Credential {
  /** Canonical business identity, e.g. "CRED-0001". */
  readonly credentialId: string;
  readonly tenantId: string;
  /** The owning person's canonical id (PER-XXXX). */
  readonly personId: string;
  readonly credentialType: string;
  /** S12 typed taxonomy (legacy rows default 'Other'). */
  readonly kind: CredentialKind;
  readonly issuer: string | null;
  /** S12, PII tier (owner/ops/hr; structural omission elsewhere). */
  readonly documentNumber: string | null;
  readonly issuingCountry: string | null;
  /** ISO calendar date, YYYY-MM-DD. */
  readonly issuedOn: string;
  /** ISO calendar date or null = non-expiring. */
  readonly expiresOn: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
  /** Optimistic-concurrency token (monotonic integer). */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Strictly-valid ISO calendar date: shape AND a real day (rejects 2026-02-30). Shared by date-bearing domains (Credentials, Journeys). */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the ISO date format YYYY-MM-DD')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d!));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
  }, 'Not a real calendar date');

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

/**
 * AddCredential input — the fields an operator provides when requesting a new
 * credential for an existing person. Expiry, when present, must be strictly
 * after issue (plain string comparison is correct for ISO dates).
 */
export const addCredentialInputSchema = z
  .object({
    personId: z.string().regex(/^PER-\d{4,}$/, 'personId must be a canonical PER id'),
    credentialType: z.string().trim().min(1, 'Credential type is required').max(120),
    // S12: typed taxonomy + PII document facts, optional at creation.
    kind: z.enum(CREDENTIAL_KINDS).optional().default('Other'),
    documentNumber: trimmedOptional(120),
    issuingCountry: trimmedOptional(120),
    issuer: trimmedOptional(160),
    issuedOn: isoDateSchema,
    expiresOn: isoDateSchema.nullish().transform((v) => v ?? null),
    notes: trimmedOptional(2000),
  })
  .strict()
  .refine((v) => v.expiresOn === null || v.expiresOn > v.issuedOn, {
    message: 'Expiry must be after the issue date',
    path: ['expiresOn'],
  });

export type AddCredentialInput = z.infer<typeof addCredentialInputSchema>;

/** DeactivateCredential input — target credential + person snapshot for display. */
export const deactivateCredentialInputSchema = z
  .object({
    credentialId: z.string().regex(/^CRED-\d{4,}$/, 'credentialId must be a canonical CRED id'),
    personId: z.string().regex(/^PER-\d{4,}$/),
  })
  .strict();

export type DeactivateCredentialInput = z.infer<typeof deactivateCredentialInputSchema>;

/**
 * ReactivateCredential (HARDEN-3 recycle door, GOVERNED — symmetric with
 * DeactivateCredential): restoring a soft-removed credential submits an approval.
 * Reason is mandatory (a compliance record's return is a governed act); the
 * owning person is derived from the credential at submit/execute.
 */
export const reactivateCredentialInputSchema = z
  .object({
    credentialId: z.string().regex(/^CRED-\d{4,}$/, 'credentialId must be a canonical CRED id'),
    reason: z.string().trim().min(1, 'A reason is required to restore a credential.').max(500),
  })
  .strict();

export type ReactivateCredentialInput = z.infer<typeof reactivateCredentialInputSchema>;

/**
 * Derived display status (read-side only; no scheduler). "Expires soon" =
 * within `soonDays` calendar days of `today` (ISO date string comparison).
 */
export type CredentialDerivedStatus = 'Inactive' | 'Expired' | 'ExpiresSoon' | 'Active';

/**
 * UpdateCredentialFacts (S12, GOVERNED — the credential-edit spec law): the
 * dates, document number, issuing country and kind are compliance facts the
 * readiness engine depends on — a quiet edit could fake a visa. Sparse patch;
 * at least one key; snapshot at submission, re-read + validated at execute.
 */
export const updateCredentialFactsInputSchema = z
  .object({
    credentialId: z.string().regex(/^CRED-\d{4,}$/),
    patch: z
      .object({
        kind: z.enum(CREDENTIAL_KINDS).optional(),
        documentNumber: trimmedOptional(120).optional(),
        issuingCountry: trimmedOptional(120).optional(),
        issuedOn: isoDateSchema.optional(),
        expiresOn: isoDateSchema.nullable().optional(),
      })
      .strict()
      .refine((p) => Object.keys(p).length > 0, { message: 'The facts patch must change at least one field.' }),
  })
  .strict();
export type UpdateCredentialFactsInput = z.infer<typeof updateCredentialFactsInputSchema>;

/** S12 direct-audited detail patch: issuer / notes / display label move fast. */
export const updateCredentialDetailsSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    patch: z
      .object({
        credentialType: z.string().trim().min(1).max(120).optional(),
        issuer: trimmedOptional(160).optional(),
        notes: trimmedOptional(2000).optional(),
      })
      .strict()
      .refine((p) => Object.keys(p).length > 0, { message: 'The details patch must change at least one field.' }),
  })
  .strict();
export type UpdateCredentialDetailsInput = z.infer<typeof updateCredentialDetailsSchema>;

export function credentialStatusOn(c: Pick<Credential, 'isActive' | 'expiresOn'>, todayIso: string, soonDays = 30): CredentialDerivedStatus {
  if (!c.isActive) return 'Inactive';
  if (c.expiresOn === null) return 'Active';
  if (c.expiresOn < todayIso) return 'Expired';
  const [y, m, d] = todayIso.split('-').map(Number);
  const horizon = new Date(Date.UTC(y!, m! - 1, d! + soonDays)).toISOString().slice(0, 10);
  return c.expiresOn <= horizon ? 'ExpiresSoon' : 'Active';
}
