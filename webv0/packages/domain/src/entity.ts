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

/** Create contract (direct-audited). */
export const entityCreateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
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
    jurisdiction: z.string().trim().min(1).max(160).optional(),
    registrationId: trimmedOptional(120).optional(),
    localCurrency: currencyCodeSchema.optional(),
  })
  .strict()
  .refine(
    (v) => ['name', 'jurisdiction', 'registrationId', 'localCurrency'].some((k) => k in v && v[k as keyof typeof v] !== undefined),
    { message: 'An update must change at least one field' },
  );
export type EntityUpdateInput = z.infer<typeof entityUpdateInputSchema>;
