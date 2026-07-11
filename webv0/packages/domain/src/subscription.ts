/**
 * subscription.ts — Track B: recurring subscriptions (a small register of the
 * org's recurring costs — SaaS tools, infra, office). Direct-but-audited CRUD
 * (the entity/mission-shell pattern): create / update (partial patch) / cancel /
 * reactivate execute immediately, version-guarded, audited in the same
 * transaction. Read is finance-gated (cost data); manage is owner/operations.
 *
 * V1 records the vendor as a NAME (free text). This is the first "vendor-shaped
 * domain", so it conceptually opens the S12 vendor beneficiary seat — but the
 * formal Vendor entity (VEN-XXXX) + vendor-beneficiary anchoring is a follow-up
 * (the payment-routing layer), not needed to TRACK a cost. The renewal date
 * feeds the ops calendar.
 *
 * Money: amounts are MINOR units (the M-02 exact-decimal law); the web converts
 * the typed decimal before submit. No payment credentials — labels/names only.
 */
import { z } from 'zod';
import { currencyCodeSchema, MAX_AMOUNT_MINOR, type CurrencyCode } from './money';

export const SUBSCRIPTION_CADENCES = ['Weekly', 'Monthly', 'Quarterly', 'Annual'] as const;
export type SubscriptionCadence = (typeof SUBSCRIPTION_CADENCES)[number];

export const SUBSCRIPTION_STATUSES = ['Active', 'Cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export interface Subscription {
  readonly subscriptionId: string; // SUB-XXXX
  readonly tenantId: string;
  readonly name: string;
  readonly vendorName: string;
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
  readonly cadence: SubscriptionCadence;
  readonly category: string | null;
  readonly status: SubscriptionStatus;
  readonly startedOn: string; // plain ISO YYYY-MM-DD
  readonly nextRenewalOn: string | null;
  readonly notes: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function formatSubscriptionId(seq: number): string {
  return `SUB-${String(seq).padStart(4, '0')}`;
}

const trimmedOptional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null);

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const dateOnlyOptional = dateOnly.nullish().transform((v) => v ?? null);
const amountMinorField = z.number().int('Amount must be whole minor units').min(0, 'Amount cannot be negative').max(MAX_AMOUNT_MINOR);

export const subscriptionCreateInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(200),
    vendorName: z.string().trim().min(1, 'Vendor is required').max(200),
    amountMinor: amountMinorField,
    currency: currencyCodeSchema,
    cadence: z.enum(SUBSCRIPTION_CADENCES),
    category: trimmedOptional(120),
    startedOn: dateOnly,
    nextRenewalOn: dateOnlyOptional,
    notes: trimmedOptional(2000),
  })
  .strict();
export type SubscriptionCreateInput = z.infer<typeof subscriptionCreateInputSchema>;

export const subscriptionUpdateInputSchema = z
  .object({
    expectedVersion: z.number().int().min(0),
    name: z.string().trim().min(1).max(200).optional(),
    vendorName: z.string().trim().min(1).max(200).optional(),
    amountMinor: amountMinorField.optional(),
    currency: currencyCodeSchema.optional(),
    cadence: z.enum(SUBSCRIPTION_CADENCES).optional(),
    category: trimmedOptional(120).optional(),
    startedOn: dateOnly.optional(),
    nextRenewalOn: dateOnlyOptional.optional(),
    notes: trimmedOptional(2000).optional(),
  })
  .strict()
  .refine(
    (v) => ['name', 'vendorName', 'amountMinor', 'currency', 'cadence', 'category', 'startedOn', 'nextRenewalOn', 'notes'].some((k) => k in v && v[k as keyof typeof v] !== undefined),
    { message: 'An update must change at least one field' },
  );
export type SubscriptionUpdateInput = z.infer<typeof subscriptionUpdateInputSchema>;
