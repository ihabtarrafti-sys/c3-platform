import { describe, expect, it } from 'vitest';
import {
  INTAKE_KINDS,
  createIntakeLinkInputSchema,
  onboardingIntakePayloadSchema,
  onboardingToAddPerson,
  parseIntakePayload,
} from '../src/index';

describe('Track B6 — intake domain shapes', () => {
  it('createIntakeLinkInput defaults a week expiry and validates the kind + bounds', () => {
    const ok = createIntakeLinkInputSchema.parse({ kind: 'Onboarding' });
    expect(ok.expiresInHours).toBe(24 * 7);
    expect(INTAKE_KINDS).toContain(ok.kind);
    expect(createIntakeLinkInputSchema.safeParse({ kind: 'Nope' }).success).toBe(false);
    expect(createIntakeLinkInputSchema.safeParse({ kind: 'Onboarding', expiresInHours: 0 }).success).toBe(false);
    expect(createIntakeLinkInputSchema.safeParse({ kind: 'Onboarding', expiresInHours: 24 * 31 }).success).toBe(false);
  });

  it('the onboarding payload requires a full name, is strict, and validates email/date', () => {
    expect(onboardingIntakePayloadSchema.safeParse({ fullName: 'A' }).success).toBe(true);
    expect(onboardingIntakePayloadSchema.safeParse({}).success).toBe(false);
    expect(onboardingIntakePayloadSchema.safeParse({ fullName: 'A', surprise: 1 }).success).toBe(false);
    expect(onboardingIntakePayloadSchema.safeParse({ fullName: 'A', email: 'nope' }).success).toBe(false);
    expect(onboardingIntakePayloadSchema.safeParse({ fullName: 'A', dateOfBirth: '20-01-01' }).success).toBe(false);
  });

  it('onboardingToAddPerson routes PII to the gated fields (never notes) and folds only non-PII into notes (H-02)', () => {
    const input = onboardingToAddPerson(
      onboardingIntakePayloadSchema.parse({
        fullName: '  Ahmad Speed  ',
        ign: 'SpeedLoL',
        nationality: 'KW',
        primaryRole: 'Support',
        email: 'ahmad@x.com',
        dateOfBirth: '1999-05-20',
        phone: '+96599999999',
        apparelSize: 'L',
        addressCity: 'Kuwait City',
      }),
    );
    expect(input.fullName).toBe('Ahmad Speed');
    expect(input.ign).toBe('SpeedLoL');
    expect(input.primaryRole).toBe('Support');
    // H-02: PII rides the gated AddPerson columns, never notes.
    expect(input.email).toBe('ahmad@x.com');
    expect(input.dateOfBirth).toBe('1999-05-20');
    expect(input.phone).toBe('+96599999999');
    expect(input.addressCity).toBe('Kuwait City');
    // Non-PII context (sizes) legitimately stays in notes; PII never leaks there.
    expect(input.notes).toContain('Apparel size: L');
    for (const leak of ['Email:', 'Date of birth:', 'Phone:', 'Kuwait City', 'ahmad@x.com', '1999-05-20']) {
      expect(input.notes ?? '').not.toContain(leak);
    }
  });

  it('a bare submission still yields a valid AddPerson with a self-submitted note', () => {
    const input = onboardingToAddPerson(onboardingIntakePayloadSchema.parse({ fullName: 'Solo' }));
    expect(input.fullName).toBe('Solo');
    expect(input.notes).toContain('Self-submitted via guest intake');
  });

  it('the notes block never exceeds the AddPerson 2000-char cap', () => {
    const input = onboardingToAddPerson(onboardingIntakePayloadSchema.parse({ fullName: 'Verbose', note: 'x'.repeat(2000) }));
    expect((input.notes ?? '').length).toBeLessThanOrEqual(2000);
  });

  it('parseIntakePayload is authoritative for the kind', () => {
    expect(() => parseIntakePayload('Onboarding', { fullName: 'Ok' })).not.toThrow();
    expect(() => parseIntakePayload('Onboarding', { nope: true })).toThrow();
  });
});
