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

/** A Credential as the domain reasons about it (surrogate UUID lives in persistence). */
export interface Credential {
  /** Canonical business identity, e.g. "CRED-0001". */
  readonly credentialId: string;
  readonly tenantId: string;
  /** The owning person's canonical id (PER-XXXX). */
  readonly personId: string;
  readonly credentialType: string;
  readonly issuer: string | null;
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

/** Strictly-valid ISO calendar date: shape AND a real day (rejects 2026-02-30). */
const isoDate = z
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
    issuer: trimmedOptional(160),
    issuedOn: isoDate,
    expiresOn: isoDate.nullish().transform((v) => v ?? null),
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
 * Derived display status (read-side only; no scheduler). "Expires soon" =
 * within `soonDays` calendar days of `today` (ISO date string comparison).
 */
export type CredentialDerivedStatus = 'Inactive' | 'Expired' | 'ExpiresSoon' | 'Active';

export function credentialStatusOn(c: Pick<Credential, 'isActive' | 'expiresOn'>, todayIso: string, soonDays = 30): CredentialDerivedStatus {
  if (!c.isActive) return 'Inactive';
  if (c.expiresOn === null) return 'Active';
  if (c.expiresOn < todayIso) return 'Expired';
  const [y, m, d] = todayIso.split('-').map(Number);
  const horizon = new Date(Date.UTC(y!, m! - 1, d! + soonDays)).toISOString().slice(0, 10);
  return c.expiresOn <= horizon ? 'ExpiresSoon' : 'Active';
}
