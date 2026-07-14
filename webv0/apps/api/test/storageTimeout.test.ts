import { describe, expect, it } from 'vitest';
import { R2_HTTP_HANDLER_OPTIONS } from '../src/storage';

describe('HARDEN-3.6 T5 — R2 request-timeout enforcement', () => {
  it('configures both the timeout and Smithy enforcement flag', () => {
    expect(R2_HTTP_HANDLER_OPTIONS).toMatchObject({
      connectionTimeout: 10_000,
      requestTimeout: 120_000,
      throwOnRequestTimeout: true,
    });
  });
});
