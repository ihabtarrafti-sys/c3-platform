/**
 * cspVerifier.test.ts — the release verifier's matching logic, with the negative
 * controls that were missing (`CR-018`).
 *
 * ⛔ WHY THIS IS HIGH AND NOT COSMETIC. `verifyServedCsp.mts` is ACCEPTED RELEASE
 * EVIDENCE: its `exit 0` was used to certify the 2026-08-02 production deploy and
 * reported to the owner as proof. A verifier that passes against a policy it
 * should reject is not a weak test — **it is a false certificate**, and the thing
 * it certifies is the boundary that keeps production from talking to staging.
 *
 * ⚖️ THE MISSING HALF WAS ALWAYS THE NEGATIVE ONE. Every check in that script
 * asked "does the served policy look right?" and none asked "would a WRONG policy
 * be caught?" *A verifier with no negative control is an assertion about the one
 * environment it happened to be run against.*
 */
import { describe, expect, it } from 'vitest';
import { buildCsp, connectSrcTokens, permitsOrigin } from '../scripts/csp.mjs';

const API = 'https://api.c3hq.org';
const STAGING_API = 'https://api.staging.c3hq.org';

describe('⛔ exact source tokens — never substring containment', () => {
  it('accepts the API origin when it is a genuine source token', () => {
    expect(permitsOrigin(connectSrcTokens(buildCsp(API)), API)).toBe(true);
  });

  it('⛔ REJECTS an attacker-suffixed origin that a substring match would accept', () => {
    // THE FINDING, AS A TEST. `connect.includes('https://api.c3hq.org')` is TRUE
    // for a policy permitting `https://api.c3hq.org.evil.invalid` — a domain an
    // attacker can register, whose prefix is exactly our origin. Substring
    // matching cannot distinguish "this origin" from "something starting with it".
    const hostile = `default-src 'self'; connect-src 'self' https://api.c3hq.org.evil.invalid`;
    const tokens = connectSrcTokens(hostile);

    expect(tokens, 'the directive is present and parsed').not.toBeNull();
    expect(hostile.includes(API), 'a substring check WOULD have passed this').toBe(true);
    expect(permitsOrigin(tokens, API), 'exact token equality must refuse it').toBe(false);
  });

  it('⛔ rejects a prefix of a token, and a token that merely contains the origin', () => {
    for (const hostile of [
      `connect-src 'self' https://api.c3hq.org.evil.invalid`,
      `connect-src 'self' https://evil.invalid/https://api.c3hq.org`,
      `connect-src 'self' https://api.c3hq.orgx`,
    ]) {
      expect(permitsOrigin(connectSrcTokens(hostile), API), hostile).toBe(false);
    }
  });
});

describe('⛔ an ABSENT directive is not a passing negative', () => {
  it('returns null rather than an empty list, so absence is distinguishable', () => {
    // The old inverse check read `!connect?.includes(other)`, and `!undefined` is
    // `true` — so **"connect-src does NOT permit the foreign API" passed when
    // there was no connect-src at all.** A policy that permits everything
    // satisfied a check that it permits nothing foreign.
    expect(connectSrcTokens(`default-src 'self'; script-src 'self'`)).toBeNull();
  });

  it('⛔ permitsOrigin is FALSE for an absent directive — in both directions', () => {
    // False for the expected API means the positive check fails loudly (correct:
    // no policy is not a good policy). The script additionally requires
    // `tokens !== null` before trusting the negation, so the foreign-API check
    // cannot be satisfied by absence either.
    expect(permitsOrigin(null, API)).toBe(false);
    expect(permitsOrigin(null, STAGING_API)).toBe(false);
  });

  it('distinguishes a present-but-empty directive from an absent one', () => {
    expect(connectSrcTokens(`connect-src`)).toEqual([]);
    expect(connectSrcTokens(`connect-src `)).toEqual([]);
  });
});

describe('the environment boundary the verifier exists to hold', () => {
  it('a production policy permits production and REFUSES staging', () => {
    const tokens = connectSrcTokens(buildCsp(API));
    expect(permitsOrigin(tokens, API)).toBe(true);
    expect(permitsOrigin(tokens, STAGING_API), 'this is the P0 that shipped').toBe(false);
  });

  it('a staging policy permits staging and REFUSES production', () => {
    const tokens = connectSrcTokens(buildCsp(STAGING_API));
    expect(permitsOrigin(tokens, STAGING_API)).toBe(true);
    expect(permitsOrigin(tokens, API)).toBe(false);
  });

  it('⛳ WHY substring matching survived this long: these two origins do not overlap', () => {
    // I first wrote this asserting the staging policy CONTAINS the production
    // string, and it does not — `staging.` is inserted mid-host, so neither
    // origin is a substring of the other. The test corrected me.
    //
    // ⚖️ That is exactly why the defect went unnoticed: against the only two
    // origins anyone ever ran this on, substring and exact matching agree. **The
    // check was never wrong in practice, only wrong in principle — and a control
    // that is right by coincidence fails the day the coincidence ends**, which
    // for a suffix match is the day someone registers the suffix.
    expect(STAGING_API.includes(API)).toBe(false);
    expect(API.includes(STAGING_API)).toBe(false);

    // …while the attacker-suffixed origin DOES overlap, which is the case the
    // real environments could never have exposed.
    expect(`${API}.evil.invalid`.includes(API)).toBe(true);
  });
});
