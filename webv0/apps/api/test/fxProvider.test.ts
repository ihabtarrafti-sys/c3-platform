/**
 * fxProvider.test.ts — M-17: the FX source ENVELOPE is validated at the edge,
 * inside the driver, so a malformed provider response is a clean UPSTREAM failure
 * (the route wraps every throw here as 502) — never a silent success (rates:[])
 * or a fabricated "as of" from local now. The network is mocked; no real fetch.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Logger } from 'pino';
import { createFxProvider } from '../src/fxProvider';

const logger = { error: () => {}, info: () => {}, warn: () => {} } as unknown as Logger;
const TS = 1_700_000_000;

function mockFetch(body: unknown, ok = true, status = 200): void {
  global.fetch = vi.fn(async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

afterEach(() => vi.restoreAllMocks());

describe('fxProvider envelope validation (M-17)', () => {
  const p = () => createFxProvider('https://fx.example/latest', logger);

  it('rejects rates: [] — an array is not a rates OBJECT (was a silent success)', async () => {
    mockFetch({ result: 'success', rates: [], time_last_update_unix: TS });
    await expect(p().fetchUsdRates()).rejects.toThrow(/malformed rates object/);
  });

  it('rejects an EMPTY rate set', async () => {
    mockFetch({ result: 'success', rates: {}, time_last_update_unix: TS });
    await expect(p().fetchUsdRates()).rejects.toThrow(/empty rate set/);
  });

  it('rejects a MISSING provider timestamp (no silent local-now substitution)', async () => {
    mockFetch({ result: 'success', rates: { AED: 3.6725 } });
    await expect(p().fetchUsdRates()).rejects.toThrow(/did not provide an update timestamp/);
  });

  it('rejects a non-positive / non-finite rate', async () => {
    mockFetch({ result: 'success', rates: { AED: 0 }, time_last_update_unix: TS });
    await expect(p().fetchUsdRates()).rejects.toThrow(/invalid rate for AED/);
  });

  it('accepts a well-formed envelope and uses the PROVIDER timestamp', async () => {
    mockFetch({ result: 'success', rates: { AED: 3.6725 }, time_last_update_unix: TS });
    const r = await p().fetchUsdRates();
    expect(r.unitsPerUsd.AED).toBe(3.6725);
    expect(r.asOf).toBe(new Date(TS * 1000).toISOString());
  });
});
