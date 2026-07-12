/**
 * intake.ts — Track B6: guest intake (tokenized sandbox submissions).
 *
 * A staff member mints a single-purpose, expiring capability LINK and sends it
 * to a guest (a new joiner). The guest opens it — no account, no login — fills
 * an onboarding form, optionally attaches files, and submits. The answers land
 * in a SANDBOX (`intake_submission`), never in live data. A staff reviewer then
 * VERIFIES the sandbox row and PROMOTES it through the existing AddPerson
 * governed pipeline (under the reviewer's own identity), or REJECTS it (the
 * payload is scrubbed and any quarantined files are deleted — wipe-on-reject).
 *
 * This module is the PURE core: the kinds, the statuses, the wire schemas, and
 * the onboarding → AddPerson mapping. All cryptography (token minting + hashing)
 * is server-only and lives in apps/api — the web bundle imports this module, so
 * nothing here may touch node:crypto.
 */
import { z } from 'zod';
import { addPersonInputSchema, type AddPersonInput } from './person';

/** The intake doors. V1 ships onboarding; the shape is an extensible enum. */
export const INTAKE_KINDS = ['Onboarding'] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

/** A link's lifecycle. Consumed = uses exhausted; Revoked = staff killed it. */
export const INTAKE_LINK_STATUSES = ['Active', 'Consumed', 'Revoked', 'Expired'] as const;
export type IntakeLinkStatus = (typeof INTAKE_LINK_STATUSES)[number];

/** A sandbox submission's lifecycle. */
export const INTAKE_SUBMISSION_STATUSES = ['Pending', 'Promoted', 'Rejected'] as const;
export type IntakeSubmissionStatus = (typeof INTAKE_SUBMISSION_STATUSES)[number];

/** The staff-facing view of a mint link (the raw token is NEVER stored/returned after mint). */
export interface IntakeLink {
  readonly id: string;
  readonly kind: IntakeKind;
  readonly label: string | null;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly maxUses: number;
  readonly usedCount: number;
  readonly status: IntakeLinkStatus;
  readonly consumedAt: string | null;
}

/** One quarantined file carried by a submission (bytes live under storageKey). */
export interface IntakeUpload {
  readonly uploadId: string;
  readonly fileName: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly storageKey: string;
}

/** A sandbox submission. `payload` is null once scrubbed (wipe-on-reject). */
export interface IntakeSubmission {
  readonly id: string;
  readonly linkId: string | null;
  readonly kind: IntakeKind;
  readonly payload: Record<string, unknown> | null;
  readonly uploads: readonly IntakeUpload[];
  readonly status: IntakeSubmissionStatus;
  readonly submittedAt: string;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  readonly promotedApprovalId: string | null;
  readonly promotedPersonId: string | null;
  readonly decisionNote: string | null;
}

// ── link minting (staff) ─────────────────────────────────────────────────────
const HOURS_MAX = 24 * 30; // 30 days
export const createIntakeLinkInputSchema = z
  .object({
    kind: z.enum(INTAKE_KINDS),
    /** A staff note so the sandbox is legible ("LoL support tryout — Ahmad"). */
    label: z.string().trim().max(120).nullish(),
    /** Link lifetime; defaults to a week, capped at 30 days. */
    expiresInHours: z.number().int().min(1).max(HOURS_MAX).default(24 * 7),
  })
  .strict();
export type CreateIntakeLinkInput = z.infer<typeof createIntakeLinkInputSchema>;

// ── the onboarding door — the guest's answers ────────────────────────────────
const shortText = z.string().trim().max(200);
const optionalShort = shortText.nullish();

/**
 * The new-joiner's self-submitted details. The operational fields map straight
 * onto AddPerson; the identity/contact/sizes fields are CAPTURED and summarised
 * into the approval's notes (they become the person's data via the governed S11
 * identity update after creation — never a quiet write from a public form).
 */
export const onboardingIntakePayloadSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Your full name is required.').max(200),
    // operational (mapped onto AddPerson directly)
    ign: optionalShort,
    nationality: optionalShort,
    primaryRole: optionalShort,
    currentTeam: optionalShort,
    currentGameTitle: optionalShort,
    primaryDepartment: optionalShort,
    // identity/contact (captured → summarised into notes at promote)
    dateOfBirth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
      .nullish(),
    phone: optionalShort,
    email: z.string().trim().email('Enter a valid email.').max(200).nullish(),
    addressLine1: optionalShort,
    addressCity: optionalShort,
    addressCountry: optionalShort,
    // sizes (captured → notes; sizes→kit automation is a follow-up)
    apparelSize: optionalShort,
    shoeSize: optionalShort,
    // the guest's own free note
    note: z.string().trim().max(2000).nullish(),
  })
  .strict();
export type OnboardingIntakePayload = z.infer<typeof onboardingIntakePayloadSchema>;

/** Parse a stored/opaque payload against its kind (defensive at every boundary). */
export function parseIntakePayload(kind: IntakeKind, payload: unknown): OnboardingIntakePayload {
  // Only one kind today; the switch is where new doors slot in.
  switch (kind) {
    case 'Onboarding':
      return onboardingIntakePayloadSchema.parse(payload);
  }
}

/**
 * Compose the AddPerson input + a legible context note from an onboarding
 * submission. The operational fields ride AddPerson; everything else is folded
 * into notes so the APPROVER sees the whole picture (and nothing a public form
 * typed silently overwrites a governed field). Pure — used at promote time.
 */
export function onboardingToAddPerson(payload: OnboardingIntakePayload): AddPersonInput {
  const clean = (v: string | null | undefined): string | null => {
    const t = (v ?? '').trim();
    return t ? t : null;
  };
  // H-02: `notes` is emitted to every canReadPeople role, so it carries ONLY
  // non-PII context (sizes, the joiner's own note). DOB / email / phone / address
  // are PII — they ride the gated AddPerson columns below, never notes.
  const contextLines: string[] = [];
  const add = (label: string, v: string | null | undefined) => {
    const c = clean(v);
    if (c) contextLines.push(`${label}: ${c}`);
  };
  add('Apparel size', payload.apparelSize);
  add('Shoe size', payload.shoeSize);
  add('Note from joiner', payload.note);

  const context = (
    contextLines.length ? `Self-submitted via guest intake —\n${contextLines.join('\n')}` : 'Self-submitted via guest intake.'
  ).slice(0, 2000); // AddPerson.notes is capped at 2000

  const input = {
    fullName: payload.fullName.trim(),
    ign: clean(payload.ign) ?? undefined,
    nationality: clean(payload.nationality) ?? undefined,
    primaryRole: clean(payload.primaryRole) ?? undefined,
    currentTeam: clean(payload.currentTeam) ?? undefined,
    currentGameTitle: clean(payload.currentGameTitle) ?? undefined,
    primaryDepartment: clean(payload.primaryDepartment) ?? undefined,
    // PII → gated columns (H-02).
    dateOfBirth: clean(payload.dateOfBirth) ?? undefined,
    email: clean(payload.email) ?? undefined,
    phone: clean(payload.phone) ?? undefined,
    addressLine1: clean(payload.addressLine1) ?? undefined,
    addressCity: clean(payload.addressCity) ?? undefined,
    addressCountry: clean(payload.addressCountry) ?? undefined,
    notes: context,
  };
  // Validate through the real AddPerson schema so promote never builds an
  // invalid request (the submit path validates again — this fails fast/clear).
  return addPersonInputSchema.parse(input);
}

/** The public route a guest link opens at (SPA — the web app resolves the token). */
export function intakeGuestRoute(token: string): string {
  return `/intake/${token}`;
}
