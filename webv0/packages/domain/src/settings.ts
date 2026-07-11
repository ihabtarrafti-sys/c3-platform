/**
 * settings.ts — HARDEN-2: the tenant settings kernel, and its first resident:
 * PER-DIEM PRESETS (the homeless S2 rider comes home). The decisions register
 * promised editable presets — the org's real config: 65 SAR / 100 SAR /
 * 25 USD — as quick-picks in the per-diem dialog.
 *
 * Settings are direct-audited, owner/operations-editable, VERSION-GUARDED
 * from birth (M-03: no new last-write-wins cells). Defaults live HERE in
 * code — an absent row means "the defaults", so the table stays empty until
 * an owner actually changes something.
 */
import { z } from 'zod';
import { amountMinorSchema, currencyCodeSchema, type CurrencyCode } from './money';

export const PER_DIEM_PRESETS_KEY = 'perDiemPresets';

export interface PerDiemPreset {
  /** DAILY rate in minor units of `currency`. */
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

/** The org's real config (GK-Core practice): 65 SAR / 100 SAR / 25 USD. */
export const DEFAULT_PER_DIEM_PRESETS: readonly PerDiemPreset[] = [
  { amountMinor: 6_500, currency: 'SAR' },
  { amountMinor: 10_000, currency: 'SAR' },
  { amountMinor: 2_500, currency: 'USD' },
];

export const perDiemPresetSchema = z
  .object({
    amountMinor: amountMinorSchema.refine((v) => v > 0, 'A preset must be a positive daily rate.'),
    currency: currencyCodeSchema,
  })
  .strict();

/** 1–8 presets; duplicates (same amount+currency) are refused. */
export const perDiemPresetsSchema = z
  .array(perDiemPresetSchema)
  .min(1)
  .max(8)
  .refine(
    (list) => new Set(list.map((p) => `${p.amountMinor}:${p.currency}`)).size === list.length,
    'Presets must be distinct.',
  );

export const setPerDiemPresetsInputSchema = z
  .object({
    presets: perDiemPresetsSchema,
    /** M-03: the setting version the caller read; null = "the defaults" (no row yet). */
    expectedVersion: z.number().int().min(0).nullable(),
  })
  .strict();
export type SetPerDiemPresetsInput = z.infer<typeof setPerDiemPresetsInputSchema>;

/** Parse a stored JSONB value back into presets — a corrupt row fails loudly. */
export function parsePerDiemPresets(value: unknown): PerDiemPreset[] {
  return perDiemPresetsSchema.parse(value) as PerDiemPreset[];
}
