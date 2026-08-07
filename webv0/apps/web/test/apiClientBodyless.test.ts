/**
 * apiClientBodyless.test.ts — the header follows the body (owner-found, 2026-08-06).
 *
 * ⛔ THE DEFECT: the shared helper announced `content-type: application/json`
 * UNCONDITIONALLY while sending a body only when one existed. Every bodyless
 * mutating call announced JSON and sent nothing, and fastify refuses that shape
 * BEFORE the route runs. Six client calls were broken from the browser since
 * the helper was written (removePersonPhoto, removeSavedView, revokeIntakeLink,
 * retryInvoicePdf, refreshFxRates, removeFromRoom) — and no test tier could
 * see it: `app.inject` never runs this client. LAW 34, live in production.
 *
 * ⚖️ This test runs at the ONLY tier that can see the defect: the client
 * itself, with fetch captured. It asserts the SHAPE HANDED TO FETCH, not a
 * server's reaction — the defect lived entirely in that shape.
 */
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/api';

function harness() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const client = createApiClient({
    baseUrl: 'https://api.test',
    getToken: async () => 'tok-123',
    onUnauthorized: async () => {},
    fetchImpl: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });
  return { client, calls };
}

const headerNames = (init: RequestInit): string[] => Object.keys((init.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase());

describe('⛔ the header follows the body', () => {
  it('⛔ a BODYLESS mutating call sends NO content-type and NO body', async () => {
    const { client, calls } = harness();
    await client.refreshFxRates();
    expect(calls).toHaveLength(1);
    const { init } = calls[0]!;
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
    // The defect in one line: announcing JSON with nothing behind it.
    expect(headerNames(init)).not.toContain('content-type');
    // The auth header must survive the conditional spread.
    expect(headerNames(init)).toContain('authorization');
  });

  it('⛳ a BODIED call still announces JSON and carries the serialized body', async () => {
    // The positive control: the fix must not strip the header where a body
    // exists, or every governed write breaks in the opposite direction.
    const { client, calls } = harness();
    // The helper itself is the subject; any bodied call exercises it.
    await client.request('POST', '/api/v1/people', { fullName: 'Control Case' });
    const { init } = calls[0]!;
    expect(headerNames(init)).toContain('content-type');
    expect(typeof init.body).toBe('string');
    expect(JSON.parse(init.body as string).fullName).toBe('Control Case');
  });
});
