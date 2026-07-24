/**
 * logger.test.ts — the request-URL censor. Two secrets ride in URLs and must
 * never reach the logs: the intake capability token (M-09, a bearer-equivalent
 * secret) and the S3 search `q` term (PII — a person's name or id; HEARTH-001
 * invariant 9). The censor masks both; ordinary URLs — including the staff
 * intake subpaths — stay intact.
 *
 * This is the enforcing test: a future sensitive GET param cannot silently
 * reopen the leak without a masking rule AND a case here.
 */
import { describe, expect, it } from 'vitest';
import { maskIntakeToken, maskSearchQuery, loggerOptions } from '../src/logger';
import type { Env } from '../src/env';

describe('M-09: intake capability token never reaches the logs', () => {
  it('masks the token segment in the public intake URL, preserving the query', () => {
    expect(maskIntakeToken('/api/v1/intake/public/CC5D32DBsecrettoken')).toBe('/api/v1/intake/public/[REDACTED]');
    expect(maskIntakeToken('/api/v1/intake/public/abc123?foo=1')).toBe('/api/v1/intake/public/[REDACTED]?foo=1');
  });

  it('never over-masks — staff intake subpaths and other routes are untouched', () => {
    expect(maskIntakeToken('/api/v1/intake/links')).toBe('/api/v1/intake/links');
    expect(maskIntakeToken('/api/v1/intake/submissions/abc/uploads/xyz')).toBe('/api/v1/intake/submissions/abc/uploads/xyz');
    expect(maskIntakeToken('/api/v1/people/PER-0001')).toBe('/api/v1/people/PER-0001');
  });
});

describe('the search `q` term (PII) never reaches the logs', () => {
  it('masks the q value, keeping the path and other params', () => {
    expect(maskSearchQuery('/api/v1/search?q=Jordan%20Reyes')).toBe('/api/v1/search?q=[REDACTED]');
    expect(maskSearchQuery('/api/v1/search?q=PER-0001')).toBe('/api/v1/search?q=[REDACTED]');
  });

  it('masks q wherever it sits and stops at the next real delimiter', () => {
    // The term is percent-encoded, so a raw & cannot appear inside it.
    expect(maskSearchQuery('/api/v1/search?q=ali%26co&page=2')).toBe('/api/v1/search?q=[REDACTED]&page=2');
    expect(maskSearchQuery('/api/v1/search?scope=people&q=secret%20name')).toBe(
      '/api/v1/search?scope=people&q=[REDACTED]',
    );
  });

  it('leaves URLs without a q param untouched (incl. a param merely ending in q)', () => {
    expect(maskSearchQuery('/api/v1/people/PER-0001')).toBe('/api/v1/people/PER-0001');
    expect(maskSearchQuery('/api/v1/missions?stage=Active')).toBe('/api/v1/missions?stage=Active');
    expect(maskSearchQuery('/api/v1/x?faq=open')).toBe('/api/v1/x?faq=open');
  });
});

describe('the redact censor composes both maskers and still redacts headers', () => {
  it('masks req.url intake tokens AND search terms, and redacts auth/cookie', () => {
    const opts = loggerOptions({ nodeEnv: 'production', logLevel: 'info' } as unknown as Env);
    const censor = (opts.redact as { censor: (v: unknown, p: string[]) => unknown }).censor;
    expect(censor('/api/v1/intake/public/SECRET', ['req', 'url'])).toBe('/api/v1/intake/public/[REDACTED]');
    expect(censor('/api/v1/search?q=Jordan%20Reyes', ['req', 'url'])).toBe('/api/v1/search?q=[REDACTED]');
    expect(censor('Bearer abc.def', ['req', 'headers', 'authorization'])).toBe('[REDACTED]');
    expect(censor('sid=xyz', ['req', 'headers', 'cookie'])).toBe('[REDACTED]');
  });
});
