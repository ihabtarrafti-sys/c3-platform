/**
 * roleSecretReporting.test.ts — the migrator must say whether it APPLIED the
 * secret it demanded.
 *
 * ⚖️ THE SEAM THIS CLOSES. `runMigrations` requires a password for every role
 * (`assertStrongSecret` refuses without one), then applies it only when the role
 * is ABSENT — an existing role's password changes only under the opt-in
 * `MIGRATE_ROTATE_ROLE_SECRETS=yes`. **And it reported which branch ran
 * nowhere.** The operator's only evidence was the input they supplied, so *"I
 * passed a password"* silently became *"the password is now that."*
 *
 * ⛔ THREE CREDENTIAL DISAGREEMENTS IN THIS ENVIRONMENT CAME FROM THAT GAP:
 * `c3_auth` — discovered by a TOTAL sign-in outage that `/health` and `/ready`
 * both reported healthy — and `c3_backup` twice, the second time recorded as
 * done on the strength of the input by the person who wrote the law against
 * exactly that.
 *
 * ⚖️ Same family as LAW 32: **the state, not the intention, is the thing worth
 * reporting.** A tool that takes a secret and stays silent about whether it used
 * it invites the error, and has now produced it twice.
 */
import { describe, expect, it } from 'vitest';
import { classifyRoleSecretOutcome, describeRoleSecretOutcome } from '../src/migrate';

describe('⛔ the outcome is OBSERVED, and every branch is named', () => {
  it('an absent role is CREATED with the supplied password', () => {
    expect(classifyRoleSecretOutcome(false, false)).toBe('created-with-password');
    expect(classifyRoleSecretOutcome(false, true)).toBe('created-with-password');
  });

  it('an existing role rotates ONLY under the explicit opt-in', () => {
    expect(classifyRoleSecretOutcome(true, true)).toBe('password-rotated');
  });

  it('⛔ THE BRANCH THAT PRODUCED ALL THREE DISAGREEMENTS: existing + no rotation', () => {
    // The password was demanded, supplied, and deliberately NOT applied. Nothing
    // said so, and the role kept a value nobody held.
    expect(classifyRoleSecretOutcome(true, false)).toBe('left-existing-password');
  });
});

describe('⚖️ the message states the CONSEQUENCE, not the branch', () => {
  it('the unapplied case says the secret was NOT applied, in those words', () => {
    // A reader skimming a migration log must not have to infer this. The line
    // has to be unmissable precisely because the run otherwise looks successful.
    const line = describeRoleSecretOutcome('c3_backup', 'left-existing-password');
    expect(line).toMatch(/NOT applied/);
    expect(line).toMatch(/LEFT UNCHANGED/);
    expect(line).toContain('c3_backup');
  });

  it('⛳ and it tells the operator what NOT to conclude', () => {
    // The error was a RECORD written on the strength of an input. The line
    // addresses that directly rather than only describing the mechanism.
    expect(describeRoleSecretOutcome('c3_backup', 'left-existing-password')).toMatch(
      /do not record this run as having set it/i,
    );
  });

  it('names the opt-in that would change it', () => {
    expect(describeRoleSecretOutcome('c3_auth', 'left-existing-password')).toMatch(
      /MIGRATE_ROTATE_ROLE_SECRETS=yes/,
    );
  });

  it('the applied cases are unambiguous too — CREATED and ROTATED say so', () => {
    expect(describeRoleSecretOutcome('c3_app', 'created-with-password')).toMatch(/CREATED with the supplied password/);
    expect(describeRoleSecretOutcome('c3_app', 'password-rotated')).toMatch(/ROTATED/);
  });

  it('⛔ no message leaks the secret itself', () => {
    // The line reports WHETHER a password was applied, never WHAT it was — a
    // migration log is not a credential store.
    for (const outcome of ['created-with-password', 'password-rotated', 'left-existing-password'] as const) {
      const line = describeRoleSecretOutcome('c3_app', outcome);
      expect(line).not.toMatch(/password\s*[:=]\s*\S/i);
    }
  });
});
