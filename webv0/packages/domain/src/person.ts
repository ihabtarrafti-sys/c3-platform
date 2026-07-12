/**
 * person.ts — the Person domain entity and the AddPerson input contract.
 *
 * Extracted from `packages/c3/src/types/people.ts`, with SharePoint coupling
 * removed:
 *   - no numeric `Id` (the surrogate key is a persistence-layer UUID);
 *   - PersonID (PER-XXXX) is the canonical domain identity;
 *   - no SharePoint field-name assumptions, no list assumptions.
 */

import { z } from 'zod';
import { entityIdOptional } from './entity';

/** A Person as the domain reasons about it (surrogate UUID lives in persistence). */
export interface Person {
  /** Canonical business identity, e.g. "PER-0001". */
  readonly personId: string;
  readonly tenantId: string;
  readonly fullName: string;
  readonly ign: string | null;
  readonly nationality: string | null;
  readonly primaryRole: string | null;
  readonly personnelCode: string | null;
  readonly currentTeam: string | null;
  readonly currentGameTitle: string | null;
  readonly primaryDepartment: string | null;
  /** S48: the tenant legal entity this person signed with (one primary). */
  readonly entityId: string | null;
  readonly notes: string | null;
  // ── S11 People v2: the PIF field model ────────────────────────────────────
  // Identity-material (change ONLY through the governed pipeline):
  readonly firstName: string | null;
  readonly lastName: string | null;
  /** PII tier. YYYY-MM-DD. */
  readonly dateOfBirth: string | null;
  readonly otherNationalities: readonly string[];
  // PII contact block (operational to WRITE per C2; PII to READ per C1):
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly addressCity: string | null;
  readonly addressCountry: string | null;
  readonly phone: string | null;
  readonly email: string | null;
  // Operational:
  /** YYYY-MM-DD. */
  readonly dateOfJoining: string | null;
  readonly position: string | null;
  // ── Track B: the current headshot (bytes in private object storage) ───────
  /** Opaque tenant-scoped storage key — server-generated. Server-only (never
   *  leaves the API; the DTO exposes only photoUpdatedAt). Null = no photo. */
  readonly photoStorageKey: string | null;
  readonly photoContentType: string | null;
  /** Server-computed at set time — the serve route re-verifies before serving. */
  readonly photoSha256: string | null;
  /** ISO; presence = "has a photo", and doubles as the cache-buster. */
  readonly photoUpdatedAt: string | null;
  readonly isActive: boolean;
  /** Optimistic-concurrency token (monotonic integer). */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The PII tier (S11, owner-ratified C1): these Person fields are STRUCTURALLY
 * OMITTED from read models unless the caller holds canViewPersonPII
 * (owner/operations/hr) — absence, not masking (the S41 financials law).
 */
export const PERSON_PII_FIELDS = ['dateOfBirth', 'addressLine1', 'addressLine2', 'addressCity', 'addressCountry', 'phone', 'email'] as const;

/**
 * Person photo (Track B). A headshot is an IMAGE only — the document allowlist
 * is wider (PDFs, office docs); an avatar is png/jpeg/webp, hard-capped well
 * below the document ceiling. The bytes still prove themselves by magic
 * signature at upload (documentBytesMatchDeclaredType covers these three).
 */
export const PERSON_PHOTO_MAX_BYTES = 8 * 1024 * 1024;
export const PERSON_PHOTO_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export function isAllowedPersonPhotoContentType(v: string): boolean {
  return (PERSON_PHOTO_CONTENT_TYPES as readonly string[]).includes(v);
}

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .nullish()
  .transform((v) => v ?? null);

/**
 * The AddPerson input contract — the fields an operator provides when
 * requesting creation of a new Person. `fullName` is the only required field
 * (you cannot create a nameless person). Unknown keys are stripped.
 *
 * This schema is the SINGLE SOURCE of the AddPerson value shape; the wire
 * request envelope in @c3web/api-contracts composes it.
 */
export const addPersonInputSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required').max(200),
    ign: trimmedOptional(120),
    nationality: trimmedOptional(120),
    primaryRole: trimmedOptional(120),
    personnelCode: trimmedOptional(60),
    currentTeam: trimmedOptional(120),
    currentGameTitle: trimmedOptional(120),
    primaryDepartment: trimmedOptional(120),
    entityId: entityIdOptional,
    notes: trimmedOptional(2000),
    // S11 PII tier — captured at creation (e.g. guest-intake promote) and written
    // to the PII-gated columns. NEVER folded into `notes` (H-02): notes is emitted
    // to every canReadPeople role, so PII there would defeat structural omission.
    // The approval payload projector omits these unless the reader holds PII
    // standing (H-03). Absent on the direct AddPerson UI path.
    dateOfBirth: dateOnly.optional(),
    email: trimmedOptional(200),
    phone: trimmedOptional(60),
    addressLine1: trimmedOptional(200),
    addressLine2: trimmedOptional(200),
    addressCity: trimmedOptional(120),
    addressCountry: trimmedOptional(120),
  })
  .strict();

export type AddPersonInput = z.infer<typeof addPersonInputSchema>;
/** The AddPerson fields that carry PII (omitted from wire views without PII standing). */
export const ADD_PERSON_PII_FIELDS = ['dateOfBirth', 'email', 'phone', 'addressLine1', 'addressLine2', 'addressCity', 'addressCountry'] as const;


/**
 * UpdatePersonIdentity (S11, GOVERNED — owner-ratified C2): identity-material
 * facts are compliance facts; a quiet edit could fake an age or nationality.
 * The patch is a sparse set — only provided keys change; at least one is
 * required. The FIRST fill of an empty field is governed too (no side doors).
 */
export const updatePersonIdentityInputSchema = z
  .object({
    personId: z.string().regex(/^PER-\d{4,}$/),
    patch: z
      .object({
        fullName: z.string().trim().min(1).max(200).optional(),
        firstName: trimmedOptional(120).optional(),
        lastName: trimmedOptional(120).optional(),
        dateOfBirth: dateOnly.optional(),
        nationality: trimmedOptional(120).optional(),
        otherNationalities: z.array(z.string().trim().min(1).max(120)).max(8).optional(),
      })
      .strict()
      .refine((p) => Object.keys(p).length > 0, { message: 'The identity patch must change at least one field.' }),
  })
  .strict();
export type UpdatePersonIdentityInput = z.infer<typeof updatePersonIdentityInputSchema>;

/**
 * Operational update (S11, DIRECT-audited — owner-ratified C2): the facts that
 * move fast. Version-guarded (412 on stale); every change lands before/after
 * in the audit stream (PersonOperationalUpdated).
 */
export const updatePersonOperationalSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    patch: z
      .object({
        ign: trimmedOptional(120).optional(),
        primaryRole: trimmedOptional(120).optional(),
        personnelCode: trimmedOptional(60).optional(),
        currentTeam: trimmedOptional(120).optional(),
        currentGameTitle: trimmedOptional(120).optional(),
        primaryDepartment: trimmedOptional(120).optional(),
        entityId: entityIdOptional.optional(),
        notes: trimmedOptional(2000).optional(),
        position: trimmedOptional(120).optional(),
        dateOfJoining: dateOnly.optional(),
        addressLine1: trimmedOptional(200).optional(),
        addressLine2: trimmedOptional(200).optional(),
        addressCity: trimmedOptional(120).optional(),
        addressCountry: trimmedOptional(120).optional(),
        phone: trimmedOptional(60).optional(),
        email: z.string().trim().toLowerCase().email().max(200).nullish().transform((v) => v ?? null).optional(),
      })
      .strict()
      .refine((p) => Object.keys(p).length > 0, { message: 'The operational patch must change at least one field.' }),
  })
  .strict();
export type UpdatePersonOperationalInput = z.infer<typeof updatePersonOperationalSchema>;

/**
 * DeactivatePerson / ReactivatePerson (S11, GOVERNED): a person leaving is a
 * governance event, not an edit — reason mandatory; feeds the future
 * Departure workflow. No cascade: rosters/journeys/agreements keep their own
 * lifecycles and their own signals.
 */
export const deactivatePersonInputSchema = z
  .object({
    personId: z.string().regex(/^PER-\d{4,}$/),
    reason: z.string().trim().min(1, 'A reason is mandatory.').max(500),
  })
  .strict();
export type DeactivatePersonInput = z.infer<typeof deactivatePersonInputSchema>;

export const reactivatePersonInputSchema = deactivatePersonInputSchema;
export type ReactivatePersonInput = z.infer<typeof reactivatePersonInputSchema>;
