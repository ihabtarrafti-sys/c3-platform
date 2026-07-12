/**
 * logger.test.ts — HARDEN-3 M-09. The guest capability token rides in the
 * intake public URL path; the logger must mask it (a bearer-equivalent secret)
 * while leaving ordinary URLs — including the staff intake subpaths — intact.
 */
import { describe, expect, it } from 'vitest';
import { maskIntakeToken, loggerOptions } from '../src/logger';
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

  it('the redact censor masks req.url tokens and still redacts auth/cookie', () => {
    const opts = loggerOptions({ nodeEnv: 'production', logLevel: 'info' } as unknown as Env);
    const censor = (opts.redact as { censor: (v: unknown, p: string[]) => unknown }).censor;
    expect(censor('/api/v1/intake/public/SECRET', ['req', 'url'])).toBe('/api/v1/intake/public/[REDACTED]');
    expect(censor('Bearer abc.def', ['req', 'headers', 'authorization'])).toBe('[REDACTED]');
    expect(censor('sid=xyz', ['req', 'headers', 'cookie'])).toBe('[REDACTED]');
  });
});
