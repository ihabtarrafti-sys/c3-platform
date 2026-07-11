/**
 * beneficiary.ts — S12: the Beneficiary registry.
 *
 * THE STANDING LAW (owner, absolute): C3 never stores account numbers,
 * IBANs, or card numbers — in any form, including "encrypted for later".
 * A beneficiary row NAMES a payment route (person, label, bank, currency,
 * which org entity's bank holds the registration); it can never EXECUTE
 * one. The zod schemas actively refuse long digit runs in every free-text
 * field so an account number cannot arrive by accident.
 *
 * Mutations are GOVERNED (spec law 2): payment-routing facts get dual
 * control. Lifecycle: Draft → Registered → Retired; Retired frees the
 * person+label pair (DB partial-unique). Rows are history, never deleted.
 */
import { z } from 'zod';

export const BENEFICIARY_STATUSES = ['Draft', 'Registered', 'Retired'] as const;
export type BeneficiaryStatus = (typeof BENEFICIARY_STATUSES)[number];

export interface Beneficiary {
  readonly tenantId: string;
  readonly beneficiaryId: string; // BEN-XXXX
  // The PAYEE anchor (0035): exactly one seat is set. Freelancer/vendor
  // seats are DORMANT until those domains land; the schema is ready today.
  readonly personId: string | null;
  readonly freelancerId: string | null;
  readonly vendorId: string | null;
  readonly label: string;
  readonly bankName: string;
  readonly bankCountry: string;
  readonly currency: string;
  readonly paymentType: string | null;
  readonly registeredWithEntityId: string | null;
  readonly status: BeneficiaryStatus;
  readonly statusDate: string | null; // YYYY-MM-DD
  readonly notes: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The law, mechanized: any 8+ digit run (ignoring spaces/dashes) or an
 * IBAN-shaped token is refused at the boundary. Real bank names, labels
 * and notes never need one.
 */
const NO_ACCOUNT_NUMBERS = (v: string): boolean => {
  const squashed = v.replace(/[\s-]/g, '');
  if (/\d{8,}/.test(squashed)) return false;
  if (/\b[A-Za-z]{2}\d{2}[A-Za-z0-9]{10,}\b/.test(squashed)) return false; // IBAN shape
  return true;
};
const LAW_MSG = 'Account numbers and IBANs may never be stored in C3 — use a label.';
const lawfulText = (max: number, required = true) =>
  required
    ? z.string().trim().min(1).max(max).refine(NO_ACCOUNT_NUMBERS, LAW_MSG)
    : z
        .string()
        .trim()
        .max(max)
        .refine(NO_ACCOUNT_NUMBERS, LAW_MSG)
        .transform((v) => (v === '' ? null : v))
        .nullish()
        .transform((v) => v ?? null);

export const addBeneficiaryInputSchema = z
  .object({
    personId: z.string().regex(/^PER-\d{4,}$/),
    label: lawfulText(80) as z.ZodType<string>,
    bankName: lawfulText(160) as z.ZodType<string>,
    bankCountry: lawfulText(120) as z.ZodType<string>,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'ISO 4217 code'),
    paymentType: lawfulText(80, false),
    registeredWithEntityId: z.string().regex(/^ENT-\d{4,}$/).nullish().transform((v) => v ?? null),
    notes: lawfulText(2000, false),
  })
  .strict();
export type AddBeneficiaryInput = z.infer<typeof addBeneficiaryInputSchema>;

export const updateBeneficiaryInputSchema = z
  .object({
    beneficiaryId: z.string().regex(/^BEN-\d{4,}$/),
    patch: z
      .object({
        label: (lawfulText(80) as z.ZodType<string>).optional(),
        bankName: (lawfulText(160) as z.ZodType<string>).optional(),
        bankCountry: (lawfulText(120) as z.ZodType<string>).optional(),
        currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).optional(),
        paymentType: lawfulText(80, false).optional(),
        registeredWithEntityId: z.string().regex(/^ENT-\d{4,}$/).nullable().optional(),
        status: z.enum(['Draft', 'Registered']).optional(), // Retired goes through RetireBeneficiary
        statusDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        notes: lawfulText(2000, false).optional(),
      })
      .strict()
      .refine((p) => Object.keys(p).length > 0, { message: 'The patch must change at least one field.' }),
  })
  .strict();
export type UpdateBeneficiaryInput = z.infer<typeof updateBeneficiaryInputSchema>;

export const retireBeneficiaryInputSchema = z
  .object({
    beneficiaryId: z.string().regex(/^BEN-\d{4,}$/),
    reason: z.string().trim().min(1, 'A reason is mandatory.').max(500),
  })
  .strict();
export type RetireBeneficiaryInput = z.infer<typeof retireBeneficiaryInputSchema>;
