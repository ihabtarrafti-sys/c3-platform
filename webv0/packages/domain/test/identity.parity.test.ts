/**
 * Parity test: the extracted domain identity normalizer must agree with the
 * frozen reference implementation for all PROVIDER-NEUTRAL inputs (plain
 * emails, case/whitespace variants, malformed values). The one deliberate
 * divergence — SharePoint claim-prefix stripping — has moved to the auth
 * boundary, so a claims-format input is normalized by the reference but
 * rejected (null) by the domain. That divergence is asserted explicitly.
 */
import { describe, it, expect } from 'vitest';
import { canonicalizeIdentity as domainCanon, checkSelfReview } from '../src/identity';
// The frozen reference as an in-tree STATIC FIXTURE (verbatim copy of
// packages/c3/src/utils/identity.ts @ 0558a6c) so the webv0 npm root has no
// imports outside webv0/. See the fixture header for provenance.
import { canonicalizeIdentity as frozenCanon } from './fixtures/frozenIdentity.ref';

const PROVIDER_NEUTRAL = [
  'user@tenant.com',
  'User@Tenant.com',
  '  user@tenant.com  ',
  'USER@TENANT.COM',
  'a.b-c_d@sub.example.co.uk',
  '',
  '   ',
  'not-an-email',
  'two@@ats.com',
  'trailing@',
  '@leading.com',
  'no-at-symbol',
  null,
  undefined,
];

describe('identity parity (provider-neutral inputs)', () => {
  for (const input of PROVIDER_NEUTRAL) {
    it(`agrees with the frozen reference for ${JSON.stringify(input)}`, () => {
      expect(domainCanon(input)).toEqual(frozenCanon(input));
    });
  }
});

describe('deliberate divergence: SP claim prefix moved to the auth boundary', () => {
  const claims = 'i:0#.f|membership|user@tenant.com';
  it('frozen reference strips the SP claim prefix', () => {
    expect(frozenCanon(claims)).toBe('user@tenant.com');
  });
  it('domain rejects raw claims format (must be translated at the boundary first)', () => {
    expect(domainCanon(claims)).toBeNull();
  });
});

describe('self-review guard preserves fail-closed semantics', () => {
  it('blocks identical identities (case/whitespace insensitive)', () => {
    expect(checkSelfReview(' User@Tenant.com ', 'user@tenant.com')).toEqual({ blocked: true, reason: 'self' });
  });
  it('blocks when the reviewer is indeterminate', () => {
    expect(checkSelfReview('garbage', 'user@tenant.com')).toEqual({ blocked: true, reason: 'indeterminate-reviewer' });
  });
  it('blocks when the submitter is indeterminate', () => {
    expect(checkSelfReview('owner@tenant.com', '')).toEqual({ blocked: true, reason: 'indeterminate-submitter' });
  });
  it('allows two clean, different identities', () => {
    expect(checkSelfReview('owner@tenant.com', 'ops@tenant.com')).toEqual({ blocked: false });
  });
});
