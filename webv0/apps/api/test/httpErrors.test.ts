/**
 * httpErrors.test.ts — the MODULE_READ_ONLY wire mapping (read-guard verdict
 * hardening 6): a dedicated code mapped to 403 — a permission-class licensing
 * denial, never the retryable 409 conflict class; registered in STATUS_BY_CODE
 * so it can never silently degrade to the ?? 400 fallback.
 */
import { describe, expect, it } from 'vitest';
import { ModuleReadOnlyError } from '@c3web/domain';
import { mapError } from '../src/httpErrors';

describe('mapError — MODULE_READ_ONLY', () => {
  it('maps to 403 with the dedicated code (never 409, never the 400 fallback)', () => {
    const mapped = mapError(new ModuleReadOnlyError('comms'));
    expect(mapped.status).toBe(403);
    expect(mapped.code).toBe('MODULE_READ_ONLY');
    expect(mapped.details).toEqual({ moduleKey: 'comms' });
  });
});
