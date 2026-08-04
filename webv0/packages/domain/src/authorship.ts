import { z } from 'zod';

/** D-009: every record has exactly one explicit authorship class. */
export const RECORD_AUTHORSHIP_KINDS = ['person', 'system', 'ai_assisted'] as const;

/** A named, accountable human author. */
export const personRecordAuthorshipSchema = z
  .object({
    kind: z.literal('person'),
    userId: z.string(),
    label: z.string().nullable(),
  })
  .strict();

/** A deterministic, reproducible event carrying the rule that produced it. */
export const systemRecordAuthorshipSchema = z
  .object({
    kind: z.literal('system'),
    rule: z.string().trim().min(1),
  })
  .strict();

/** AI-assisted output governed by HEARTH-001 and awaiting human ratification. */
export const aiAssistedRecordAuthorshipSchema = z
  .object({
    kind: z.literal('ai_assisted'),
    provenance: z.literal('HEARTH-001'),
    humanRatification: z.literal('pending'),
  })
  .strict();

export const recordAuthorshipSchema = z.discriminatedUnion('kind', [
  personRecordAuthorshipSchema,
  systemRecordAuthorshipSchema,
  aiAssistedRecordAuthorshipSchema,
]);

export type PersonRecordAuthorship = z.infer<typeof personRecordAuthorshipSchema>;
export type SystemRecordAuthorship = z.infer<typeof systemRecordAuthorshipSchema>;
export type AiAssistedRecordAuthorship = z.infer<typeof aiAssistedRecordAuthorshipSchema>;
export type RecordAuthorship = z.infer<typeof recordAuthorshipSchema>;
