import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SUNSET_FROZEN_DATA_FILES = [
  'packages/search-harness/src/registry/frozenManifest.json',
  'packages/search-harness/src/registry/frozenCoverageManifest.json',
] as const;

export type SunsetFrozenDataFile = (typeof SUNSET_FROZEN_DATA_FILES)[number];

const FROZEN_DATA_URLS: Readonly<Record<SunsetFrozenDataFile, URL>> = {
  'packages/search-harness/src/registry/frozenManifest.json': new URL(
    './frozenManifest.json',
    import.meta.url,
  ),
  'packages/search-harness/src/registry/frozenCoverageManifest.json': new URL(
    './frozenCoverageManifest.json',
    import.meta.url,
  ),
};

/**
 * Frozen values are deliberately excluded from the enforcement-tree hash to
 * avoid a self-hash cycle. Requiring canonical JSON keeps that exclusion
 * data-only: imports, calls, control flow, duplicate keys, comments, and other
 * executable or ambiguous source forms fail before any registry comparison.
 */
export function parseCanonicalFrozenJson(
  source: string,
  label: string,
): unknown {
  if (source.startsWith('\uFEFF')) {
    throw new Error(`Frozen sunset data is not canonical JSON: ${label}`);
  }
  const normalizedSource = source.replace(/\r\n/gu, '\n');
  if (normalizedSource.includes('\r')) {
    throw new Error(`Frozen sunset data is not canonical JSON: ${label}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedSource) as unknown;
  } catch {
    throw new Error(`Frozen sunset data is not valid JSON: ${label}`);
  }

  const canonicalSource = `${JSON.stringify(parsed, null, 2)}\n`;
  if (normalizedSource !== canonicalSource) {
    throw new Error(`Frozen sunset data is not canonical JSON: ${label}`);
  }
  return parsed;
}

export function serializeCanonicalFrozenJson(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new Error('Frozen sunset data cannot be serialized as JSON');
  }
  const source = `${serialized}\n`;
  parseCanonicalFrozenJson(source, 'generated frozen sunset data');
  return source;
}

export function readFrozenSunsetData(file: SunsetFrozenDataFile): unknown {
  const url = FROZEN_DATA_URLS[file];
  return parseCanonicalFrozenJson(
    readFileSync(fileURLToPath(url), 'utf8'),
    file,
  );
}

export function deepFreezeFrozenData<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreezeFrozenData(child);
    }
    Object.freeze(value);
  }
  return value;
}
