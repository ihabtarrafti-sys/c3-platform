/**
 * delegationRevokeControl.test.ts — the SURFACE consumes the blocking
 * predicate, sealed at the source (the prodHeaders.test.ts precedent: when the
 * defect is "which expression gates the artifact", the artifact's source is the
 * only honest subject).
 *
 * ⛔ WHY A SOURCE SEAL AND NOT ONLY THE DOMAIN TEST: with today's four states,
 * `Active || Scheduled || Expired` is extensionally equal to `!== 'Revoked'` —
 * a string-patch would pass every value-level test until a fifth state ships,
 * which is exactly when it would fail silently in production. The seal pins the
 * INTENSION: the component derives the control from `isDelegationUnrevoked`,
 * and no hand-list of state names gates the Revoke control.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src', 'components', 'SettingsGovernanceSections.tsx'),
  'utf8',
);

describe('⛔ the Revoke control derives from the blocking predicate', () => {
  it('consumes isDelegationUnrevoked from the domain', () => {
    expect(source).toMatch(/import \{[^}]*isDelegationUnrevoked[^}]*\} from '@c3web\/domain'/);
    expect(source).toMatch(/isDelegationUnrevoked\(d\.state\)/);
  });

  it('⛔ no hand-list of state names gates the control (the defect, sealed shut)', () => {
    // The original: `(d.state === 'Active' || d.state === 'Scheduled')`. Any
    // return of a state-name list around the revoke gate — including the
    // tempting `|| d.state === 'Expired'` repair — re-splits the predicate.
    expect(source).not.toMatch(/d\.state === '(Active|Scheduled|Expired)'\s*(\|\||&&)/);
  });
});
