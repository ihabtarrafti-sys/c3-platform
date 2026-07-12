/**
 * fxProvider.ts — the outbound FX-rate source for auto-fetch (Track B). One
 * port, one real driver: a KEYLESS HTTP provider (no secret to manage). The
 * source returns rates as UNITS-PER-USD (e.g. AED: 3.6725 = 1 USD → 3.6725 AED);
 * the refresh use-case inverts them to the domain's `usdPerUnit` pivot.
 *
 * The provider is a `deps` property so tests swap in a deterministic stub — the
 * network is never touched under test, and a source outage is a clean upstream
 * error at the edge, never a corrupted rate.
 */
import type { Logger } from 'pino';

export interface FxFetchResult {
  /** The source host, for provenance ("as of X, from Y"). */
  readonly source: string;
  /** When the source last updated the rates (ISO). */
  readonly asOf: string;
  /** Units of each currency per 1 USD (the source's native shape). */
  readonly unitsPerUsd: Record<string, number>;
}

export interface FxProvider {
  fetchUsdRates(): Promise<FxFetchResult>;
}

export function createFxProvider(url: string, logger: Logger): FxProvider {
  return {
    async fetchUsdRates(): Promise<FxFetchResult> {
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
      } catch (err) {
        logger.error({ err, url }, 'FX source fetch failed');
        throw new Error('The FX rate source could not be reached.');
      }
      if (!res.ok) {
        logger.error({ status: res.status, url }, 'FX source non-200');
        throw new Error(`The FX rate source responded ${res.status}.`);
      }
      const json = (await res.json()) as {
        result?: string;
        rates?: Record<string, number>;
        time_last_update_unix?: number;
      };
      if (json.result && json.result !== 'success') throw new Error(`The FX rate source returned an error: ${json.result}.`);
      if (!json.rates || typeof json.rates !== 'object') throw new Error('The FX rate source returned no rates.');
      const asOf = json.time_last_update_unix ? new Date(json.time_last_update_unix * 1000).toISOString() : new Date().toISOString();
      let source = 'fx-source';
      try {
        source = new URL(url).host;
      } catch {
        /* keep the fallback */
      }
      return { source, asOf, unitsPerUsd: json.rates };
    },
  };
}
