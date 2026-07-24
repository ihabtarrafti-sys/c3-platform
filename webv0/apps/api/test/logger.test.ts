/**
 * logger.test.ts — the request-URL censor. Two bearer-equivalent / PII
 * secrets ride in URLs and must never reach the logs: the intake capability
 * token (M-09) and the S3 search `q` term (a person's name or id;
 * HEARTH-001 invariant 9). The censor masks both; benign URLs pass untouched.
 *
 * This is the enforcing test — a future sensitive GET param cannot silently
 * reopen the leak without a masking rule and a case here.
 */
import { describe, expect, it } from 'vitest';
import { maskIntakeToken, maskSearchQuery } from '../src/logger';

describe('maskSearchQuery — the search term never reaches the logs', () => {
  it('masks the q value, keeping the path and other params', () => {
    expect(maskSearchQuery('/api/v1/search?q=Jordan%20Reyes')).toBe('/api/v1/search?q=[REDACTED]');
    expect(maskSearchQuery('/api/v1/search?q=PER-0001')).toBe('/api/v1/search?q=[REDACTED]');
  });

  it('masks q wherever it sits and stops at the next real delimiter', () => {
    // q first, another param after: the encoded term cannot contain a raw &.
    expect(maskSearchQuery('/api/v1/search?q=ali%26co&page=2')).toBe('/api/v1/search?q=[REDACTED]&page=2');
    // q not first.
    expect(maskSearchQuery('/api/v1/search?scope=people&q=secret%20name')).toBe(
      '/api/v1/search?scope=people&q=[REDACTED]',
    );
  });

  it('leaves URLs without a q param untouched', () => {
    expect(maskSearchQuery('/api/v1/people/PER-0001')).toBe('/api/v1/people/PER-0001');
    expect(maskSearchQuery('/api/v1/missions?stage=Active')).toBe('/api/v1/missions?stage=Active');
    // a param that merely ends in "q" must not be masked.
    expect(maskSearchQuery('/api/v1/x?faq=open')).toBe('/api/v1/x?faq=open');
  });
});

describe('the censor composes both maskers', () => {
  it('masks the intake token and the search term independently', () => {
    expect(maskIntakeToken('/api/v1/intake/public/abc123')).toBe('/api/v1/intake/public/[REDACTED]');
    // Composed as the loggerOptions censor applies them (search on intake-masked url).
    const both = maskSearchQuery(maskIntakeToken('/api/v1/search?q=name'));
    expect(both).toBe('/api/v1/search?q=[REDACTED]');
  });
});
