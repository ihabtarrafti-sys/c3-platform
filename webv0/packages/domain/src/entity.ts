/**
 * entity.ts — the Entity domain (S48, owner-adopted 2026-07-10). An Entity is
 * one of the TENANT COMPANY'S own legal operating entities, per jurisdiction
 * (e.g. a UAE licensed company, a KSA licensed company). People are assigned to
 * the one entity they signed with; agreements sit under an entity. NOT external
 * clubs/sponsors — those would be a separate domain if ever wanted.
 *
 * Direct-but-audited CRUD (the mission-shell pattern): create / update (partial
 * patch) / deactivate execute immediately for owner/operations, version-guarded,
 * with the audit event committed in the same transaction.
 *
 * Finance specifics (banking, per-diem, money) are DELIBERATELY out of scope
 * here — designed later in the "make C3 whole" finance session. Account numbers
 * and payment credentials are never stored (hard security line).
 */

import { z } from 'zod';
import { currencyCodeSchema, type CurrencyCode } from './money';

/** An Entity as the domain reasons about it (surrogate UUID lives in persistence). */
export interface Entity {
  /** Canonical business identity, e.g. "ENT-0001". */
  readonly entityId: string;
  readonly tenantId: string;
  readonly name: string;
  /**
   * S2 rider: the entity's short CODE (e.g. "GKA", "GKEC") — client-typed or
   * accepted from C3's suggestion. Unique per tenant when present; feeds the
   * per-entity invoice series later ({CODE}-INV-YYYY-NNN). Uppercase 2–8 chars.
   */
  readonly code: string | null;
  /** Free-text jurisdiction, e.g. "United Arab Emirates" or "KSA · Riyadh". */
  readonly jurisdiction: string;
  /** Optional trade licence / registration number. */
  readonly registrationId: string | null;
  /** The entity's local/base currency (Finance S1) — the default for money under it. */
  readonly localCurrency: CurrencyCode;
  readonly isActive: boolean;
  /** Optimistic-concurrency token (the ETag-parity guard). */
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

/** The canonical entity id field, reused where an entity is referenced. */
export const entityIdField = z.string().regex(/^ENT-\d{4,}$/, 'entityId must be a canonical ENT id');
/** Optional entity reference (person "signed with", agreement "under entity"). */
export const entityIdOptional = entityIdField.nullish().transform((v) => v ?? null);

/** Optional short code: 2–8 chars, letters/digits, stored uppercase. */
const entityCodeOptional = z
  .string()
  .trim()
  .transform((v) => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9]{2,8}$/, 'Code must be 2–8 letters or digits'))
  .nullish()
  .transform((v) => (v === undefined || v === null || v === '' ? null : v));

/**
 * Suggest a code from the entity's name: initials of up to three words,
 * padded from the first word's consonants ("Geekay UAE" → "GU" → "GKU"-ish is
 * overkill; initials suffice). Purely a UI convenience — always editable.
 */
export function suggestEntityCode(name: string): string {
  const words = name.trim().toUpperCase().split(/\s+/).filter(Boolean);
  const initials = words.map((w) => w.replace(/[^A-Z0-9]/g, '').charAt(0)).join('');
  const base = initials.length >= 2 ? initials : (words[0] ?? '').replace(/[^A-Z0-9]/g, '');
  return base.slice(0, 8);
}

/** Create contract (direct-audited). */
export const entityCreateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    code: entityCodeOptional,
    jurisdiction: z.string().trim().min(1, 'Jurisdiction is required').max(160),
    registrationId: trimmedOptional(120),
    localCurrency: currencyCodeSchema,
  })
  .strict();
export type EntityCreateInput = z.infer<typeof entityCreateInputSchema>;

/** Update contract — a PARTIAL patch plus the mandatory expected version. */
export const entityUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    name: z.string().trim().min(1).max(200).optional(),
    code: entityCodeOptional.optional(),
    jurisdiction: z.string().trim().min(1).max(160).optional(),
    registrationId: trimmedOptional(120).optional(),
    localCurrency: currencyCodeSchema.optional(),
  })
  .strict()
  .refine(
    (v) => ['name', 'code', 'jurisdiction', 'registrationId', 'localCurrency'].some((k) => k in v && v[k as keyof typeof v] !== undefined),
    { message: 'An update must change at least one field' },
  );
export type EntityUpdateInput = z.infer<typeof entityUpdateInputSchema>;
