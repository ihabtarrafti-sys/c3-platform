/**
 * rotationAgreement.test.ts — rotation must agree with the store the consumers
 * read, and the refusal must name the store.
 *
 * ⛔ THE INCIDENT THIS ENCODES (2026-08-05): the 0105 migration run rotated
 * `c3_auth` and `c3_backup` in Postgres while Railway's `DATABASE_AUTH_URL` and
 * the cron's `DATABASE_URL` kept the old values. Production sign-in failed with
 * the generic signature (`/health` green throughout) and the 22:05Z backup run
 * failed password auth. Third credential incident from this seam.
 *
 * ⚖️ The classifier is pure so every refusal branch is exercised without a
 * database — the branch nobody exercises is the one that misleads.
 */
import { describe, expect, it } from 'vitest';
import {
  CONSUMER_STORES,
  classifyRotationAgreement,
  describeRotationRefusal,
  type RotationAgreement,
} from '../src/migrate';

const NEW_PW = 'new-rotation-secret-0123456789';
const url = (role: string, pw: string) => `postgres://${role}:${encodeURIComponent(pw)}@db.example:5432/c3web`;

describe('⛔ agreement is classified before anything is touched', () => {
  it('agrees when the consumer string carries the same role and the NEW password', () => {
    expect(classifyRotationAgreement(url('c3_auth', NEW_PW), 'c3_auth', NEW_PW)).toEqual({ kind: 'agreed' });
  });

  it('⛔ THE INCIDENT CASE: the consumer string still carries the OLD password', () => {
    // Rotating here strands the consumer the moment the ALTER lands. This is the
    // exact state the 0105 run executed from.
    expect(classifyRotationAgreement(url('c3_auth', 'old-password-9876543210'), 'c3_auth', NEW_PW)).toEqual({
      kind: 'password-disagrees',
    });
  });

  it('refuses an ABSENT consumer string — unverifiable is not verified', () => {
    expect(classifyRotationAgreement(undefined, 'c3_auth', NEW_PW)).toEqual({ kind: 'no-consumer-string' });
    expect(classifyRotationAgreement('', 'c3_auth', NEW_PW)).toEqual({ kind: 'no-consumer-string' });
    expect(classifyRotationAgreement('   ', 'c3_auth', NEW_PW)).toEqual({ kind: 'no-consumer-string' });
  });

  it('refuses a consumer string naming a DIFFERENT role — wrong subject, not wrong value', () => {
    expect(classifyRotationAgreement(url('c3_app', NEW_PW), 'c3_auth', NEW_PW)).toEqual({
      kind: 'role-mismatch',
      urlRole: 'c3_app',
    });
  });

  it('refuses an unparseable string rather than guessing at it', () => {
    expect(classifyRotationAgreement('NOT A URL', 'c3_auth', NEW_PW)).toEqual({ kind: 'unparseable' });
  });

  it('compares the DECODED password — percent-encoding is transport, not identity', () => {
    const spicy = 'p@ss/word:with#chars 0123456789';
    expect(classifyRotationAgreement(url('c3_auth', spicy), 'c3_auth', spicy)).toEqual({ kind: 'agreed' });
  });
});

describe('⚖️ the refusal names the store, and never the secret', () => {
  const refusals: RotationAgreement[] = [
    { kind: 'no-consumer-string' },
    { kind: 'unparseable' },
    { kind: 'role-mismatch', urlRole: 'c3_app' },
    { kind: 'password-disagrees' },
  ];

  it('every refusal names the LOCAL variable and the PLATFORM store', () => {
    // "Update your config" reproduces the incident; the map must be in the
    // message, not in someone's head.
    for (const agreement of refusals) {
      const line = describeRotationRefusal('c3_auth', CONSUMER_STORES.auth, agreement);
      expect(line, agreement.kind).toContain('DATABASE_AUTH_URL');
      expect(line, agreement.kind).toContain('Railway service c3-api');
    }
  });

  it('the backup store points at the CRON service — a different service, same variable name', () => {
    const line = describeRotationRefusal('c3_backup', CONSUMER_STORES.backup, { kind: 'no-consumer-string' });
    expect(line).toContain('Railway service c3-backup-cron, variable DATABASE_URL');
    expect(line).toContain('DATABASE_BACKUP_URL'); // the LOCAL proof var differs from the platform one
  });

  it('⛔ no refusal text ever carries a password', () => {
    for (const agreement of refusals) {
      const line = describeRotationRefusal('c3_auth', CONSUMER_STORES.auth, agreement);
      expect(line).not.toContain(NEW_PW);
      expect(line).not.toMatch(/password\s*[:=]\s*\S/i);
    }
  });

  it('⛳ the agreed case is not a refusal — the classifier can pass', () => {
    // Positive control (LAW 29): a map from every input to "refused" would
    // satisfy each assertion above.
    expect(describeRotationRefusal('c3_auth', CONSUMER_STORES.auth, { kind: 'agreed' })).not.toContain('REFUSED');
  });
});
