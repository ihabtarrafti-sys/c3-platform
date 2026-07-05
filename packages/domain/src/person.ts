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
  readonly notes: string | null;
  readonly isActive: boolean;
  /** Optimistic-concurrency token (monotonic integer). */
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
    notes: trimmedOptional(2000),
  })
  .strict();

export type AddPersonInput = z.infer<typeof addPersonInputSchema>;
