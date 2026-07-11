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

  it('onboardingToAddPerson maps operational fields and folds contact/sizes into notes', () => {
    const input = onboardingToAddPerson(
      onboardingIntakePayloadSchema.parse({
        fullName: '  Ahmad Speed  ',
        ign: 'SpeedLoL',
        nationality: 'KW',
        primaryRole: 'Support',
        email: 'ahmad@x.com',
        dateOfBirth: '1999-05-20',
        apparelSize: 'L',
        addressCity: 'Kuwait City',
      }),
    );
    expect(input.fullName).toBe('Ahmad Speed');
    expect(input.ign).toBe('SpeedLoL');
    expect(input.primaryRole).toBe('Support');
    // Contact/sizes are NOT AddPerson fields — they ride the notes so the approver sees them.
    expect(input.notes).toContain('Email: ahmad@x.com');
    expect(input.notes).toContain('Date of birth: 1999-05-20');
    expect(input.notes).toContain('Apparel size: L');
    expect(input.notes).toContain('Kuwait City');
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
